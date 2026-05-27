

// ============================================
// FILE: services/fileUploadService.js
// ============================================
// ============================================
// FILE: services/fileUploadService.js
// ============================================
const fs = require("fs").promises;
const path = require("path");
const Logger = require("../utils/logger");
const {
  makeApiRequest,
  downloadBinaryFile,
} = require("../generics/services/axios");
const usersQueries = require("../database/databaseQueries/userQueries");
const whatsappService = require("./whatsappService");
const Project = require("../database/models/project");
const { randomUUID } = require("crypto");

const API_BASE_URL = process.env.BACKEND_API_URL ;
const PRE_SIGNED_URLS_ENDPOINT =
  "/project/v1/cloud-services/files/preSignedUrls";
const SYNC_ENDPOINT = "/project/v1/userProjects/sync";
const axios = require("axios");

class FileUploadService {
  constructor() {
    this.tempDir = process.env.TEMP_DIR || path.join(__dirname, "..", "temp");
    this.maxFileSize = 25 * 1024 * 1024; // 25MB
  }

  // ============================================
  // CORE FILE UPLOAD FUNCTIONS
  // ============================================

  /**
   * Get pre-signed URLs for file upload
   */
  static async getPreSignedUrls(projectId, fileNames) {
    try {
      Logger.info("Requesting pre-signed URLs", {
        projectId,
        fileCount: fileNames.length,
      });

      const url = `${API_BASE_URL}${PRE_SIGNED_URLS_ENDPOINT}`;

      const requestBody = {
        request: {
          [projectId]: {
            files: fileNames,
          },
        },
      };

      const response = await makeApiRequest(
        "POST",
        url,
        process.env.ELEVATE_AUTH_TOKEN,
        requestBody
      );

      if (!response.success) {
        throw new Error(
          response.error?.message || "Failed to get pre-signed URLs"
        );
      }

      Logger.info("Pre-signed URLs received", {
        projectId,
        urlCount: Object.keys(response.data?.result || {}).length,
      });

      return response.data?.result;
    } catch (error) {
      Logger.error("Error getting pre-signed URLs", error);
      throw error;
    }
  }

  /**
   * Upload file to cloud storage using pre-signed URL (binary PUT)
   */
  static async uploadFileToCloud(preSignedUrl, fileData, fileType) {
    try {
      Logger.info("Uploading file to cloud storage", { fileType });

      const headers = {
        "Content-Type": "multipart/form-data",
        "Content-Length": fileData.length,
      };

      // IMPORTANT FOR AZURE
      if (process.env.CLOUD_STORAGE_PROVIDER === "azure") {
        headers["x-ms-blob-type"] = "BlockBlob";
      }

      const response = await axios.put(preSignedUrl, fileData, {
        headers,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        validateStatus: () => true, // Handle cloud vendor edge-case statuses
      });

      if (![200, 201].includes(response.status)) {
        throw new Error(
          `Cloud upload failed. Status: ${
            response.status
          }, Body: ${JSON.stringify(response.data)}`
        );
      }

      Logger.info("File uploaded successfully", {
        status: response.status,
      });

      return {
        success: true,
        status: response.status,
        fileUrl: preSignedUrl.split("?")[0],
      };
    } catch (error) {
      Logger.error("Error uploading file to cloud", error);
      return {
        success: false,
        message: error.message,
      };
    }
  }

  /**
   * Store task evidence in database
   */
  static async storeTaskEvidence(phoneNumber, taskId, projectId, fileInfo) {
    try {
      const lastMessage = await usersQueries.getLastMessage(phoneNumber);
      const tasks = lastMessage?.context?.tasks || [];

      // Find the task and add evidence
      const taskIndex = tasks.findIndex((t) => t.id === taskId);
      if (taskIndex !== -1) {
        if (!tasks[taskIndex].evidence) {
          tasks[taskIndex].evidence = [];
        }
        tasks[taskIndex].evidence.push(fileInfo);
      }

      // Update context with evidence
      await usersQueries.updateLastMessage(phoneNumber, {
        flow: lastMessage.flow,
        step: lastMessage.step,
        context: {
          ...lastMessage.context,
          tasks,
        },
        text: lastMessage.text,
      });

      Logger.info("Task evidence stored", {
        phoneNumber,
        taskId,
        fileName: fileInfo.name,
      });
    } catch (error) {
      Logger.error("Error storing task evidence", error);
      throw error;
    }
  }

  // ============================================
  // EVIDENCE UPLOAD FUNCTIONS
  // ============================================

  /**
   * Download media from WhatsApp and save to temp location
   */
  static async downloadWhatsAppMedia(mediaUrl, fileName) {
    try {
      Logger.info("Downloading WhatsApp media", { fileName });

      const response = await downloadBinaryFile(mediaUrl);

      // if (!response.success) {
      //   throw new Error(`Download failed: ${response.error}`);
      // }

      // const buffer = Buffer.isBuffer(response.data)
      //   ? response.data
      //   : Buffer.from(response.data);

      if (!response.success) {
        throw new Error(`Download failed: ${response.error}`);
      }

      const buffer = Buffer.isBuffer(response.data)
        ? response.data
        : Buffer.from(response.data);
      // Validate file size
      const instance = new FileUploadService();
      if (buffer.length > instance.maxFileSize) {
        throw new Error("File size exceeds maximum limit of 25MB");
      }

      // Ensure temp directory exists
      await fs.mkdir(instance.tempDir, { recursive: true });

      // Save to temp location
      const filePath = path.join(instance.tempDir, fileName);
      await fs.writeFile(filePath, buffer);

      Logger.info("Media downloaded successfully", {
        fileName,
        size: buffer.length,
        path: filePath,
      });

      return { filePath, buffer, size: buffer.length };
    } catch (error) {
      Logger.error("Error downloading WhatsApp media", error);
      throw error;
    }
  }

  /**
   * Process evidence upload from WhatsApp message
   */
  static async handleEvidenceUpload(phoneNumber, message) {
    const mediaType = message.type; // "image", "document", "video", "audio"
    const mediaId = message[mediaType]?.id;
    const mediaUrl = message[mediaType]?.link;

    if (!mediaId) {
      await whatsappService.sendMessage(
        phoneNumber,
        "❌ Invalid media. Please try uploading again."
      );
      return { success: false };
    }

    try {
      // Step 1: Get last message context
      const lastMessage = await usersQueries.getLastMessage(phoneNumber);

      if (!lastMessage?.context?.uploadingEvidence) {
        await whatsappService.sendMessage(
          phoneNumber,
          "❌ Not in evidence upload mode. Please select a task first."
        );
        return { success: false };
      }

      const { projectId, currentTaskIndex } = lastMessage.context;

      if (!projectId || !currentTaskIndex) {
        await whatsappService.sendMessage(
          phoneNumber,
          "❌ Task context not found. Please select a task again."
        );
        return { success: false };
      }

      // Step 2: Fetch project and task
      const project = await Project.findOne(
        { projectId, phoneNumber },
        { tasks: 1, projectName: 1 }
      ).lean();

      if (!project) {
        await whatsappService.sendMessage(phoneNumber, "❌ Project not found.");
        return { success: false };
      }

      const task = project.tasks?.[currentTaskIndex - 1];
      if (!task) {
        await whatsappService.sendMessage(phoneNumber, "❌ Task not found.");
        return { success: false };
      }

      // Step 3: Download media from WhatsApp
      const uniqueId = randomUUID().slice(0, 8);

      const fileName = `${Date.now()}_${uniqueId}.${this.getFileExtension(mediaType)}`;
      const downloadedFile = await this.downloadWhatsAppMedia(
        mediaUrl,
        fileName
      );

      // Step 4: Generate cloud file name
      const cloudFileName = `${Date.now()}_${randomUUID().slice(0, 8)}.${this.getFileExtension(mediaType)}`;

      // Step 5: Get pre-signed URLs
      const preSignedUrls = await this.getPreSignedUrls(projectId, [
        cloudFileName,
      ]);

      // if (!preSignedUrls || !preSignedUrls[cloudFileName]) {
      //   throw new Error("Failed to get pre-signed URL for upload");
      // }

      const filesObj = preSignedUrls?.[projectId]?.files;

      if (!filesObj || !filesObj.length) {
        throw new Error("Files not found in pre-signed url response");
      }

      const fileEntry = filesObj.find((f) => f.file === cloudFileName);
      if (!fileEntry || !fileEntry.url) {
        throw new Error("Pre-signed URL missing for file: " + cloudFileName);
      }

      // const preSignedUrl = preSignedUrls[cloudFileName];
      const preSignedUrl = fileEntry.url;

      const fileType = this.getContentType(mediaType, fileName);

      // Step 6: Upload to cloud storage
      await this.uploadFileToCloud(
        preSignedUrl,
        downloadedFile.buffer,
        fileType
      );

      // Step 7: Generate source path
      const sourcePath = `project/${projectId}/${
        task.taskId
      }/${randomUUID()}/${cloudFileName}`;


      // Step 8: Create evidence object
      const evidenceObject = {
        name: cloudFileName,
        type: fileType,
        sourcePath: sourcePath,
        url: preSignedUrl.split("?")[0], // Remove query params from pre-signed URL
        uploadedAt: new Date(),
      };

      // Step 9: Update project with evidence in MongoDB
      await Project.findOneAndUpdate(
        {
          projectId,
          phoneNumber,
          "tasks._id": task._id,
        },
        {
          $push: {
            "tasks.$.evidence": evidenceObject,
          },
        },
        { new: true }
      );

      Logger.info("Evidence uploaded successfully", {
        phoneNumber,
        projectId,
        taskId: task.taskId,
        fileName: cloudFileName,
      });

      // Step 10: Clean up temp file
      await this.cleanupTempFile(downloadedFile.filePath);

      // Step 11: Store in user context for sync later
      // await this.storeEvidenceInContext(phoneNumber, task._id, evidenceObject);

      // Send confirmation message
      // await whatsappService.sendMessage(
      //   phoneNumber,
      //   `✅ Evidence uploaded successfully for "${task.taskName}"!\n\n` +
      //     `You can upload more files or type 'done' when finished.`
      // );

      // Prepare buttons
      const buttons = [
        {
          type: "quick_reply",
          title: "⬅️ Back to Tasks",
          id: "back_to_tasks",
        },
      ];

      // Prepare text (keep or customize)
      const successText =
        `📁 Evidence uploaded successfully!\n\n` +
        `Task: *${task.taskName}*\n\n` +
        `You can upload more files or click below:`;

      await whatsappService.sendInteractiveMessage({
        to: phoneNumber,
        type: "button",
        body: { text: successText },
        action: { buttons },
      });

      // Update user lastMessage context to allow next step routing
      // await usersQueries.updateLastMessage(phoneNumber, {
      //   flow: "evidence_upload",
      //   step: "success",
      //   context: {
      //     projectId,
      //     taskId: task._id,
      //   },
      // });

      return {
        success: true,
        evidence: evidenceObject,
        taskId: task.taskId,
      };
    } catch (error) {
      Logger.error("Error handling evidence upload", error);
      await whatsappService.sendMessage(
        phoneNumber,
        "❌ Failed to upload evidence. Please try again later."
      );
      return { success: false, error: error.message };
    }
  }

  /**
   * Store evidence in user context for later sync
   */
  static async storeEvidenceInContext(phoneNumber, taskId, evidenceObject) {
    try {
      const lastMessage = await usersQueries.getLastMessage(phoneNumber);
      const tasks = lastMessage?.context?.tasks || [];

      // Find task in context and add evidence
      const taskIndex = tasks.findIndex(
        (t) => t.id === taskId || t._id === taskId
      );
      if (taskIndex !== -1) {
        if (!tasks[taskIndex].evidence) {
          tasks[taskIndex].evidence = [];
        }
        tasks[taskIndex].evidence.push(evidenceObject);
      }

      // Update context
      await usersQueries.updateLastMessage(phoneNumber, {
        flow: lastMessage.flow,
        step: lastMessage.step,
        context: {
          ...lastMessage.context,
          tasks,
        },
        text: lastMessage.text,
      });

      Logger.info("Evidence stored in context", {
        phoneNumber,
        taskId,
      });
    } catch (error) {
      Logger.error("Error storing evidence in context", error);
      // Don't throw - this is secondary operation
    }
  }

  /**
   * Finish evidence upload and return to task menu
   */
  static async finishEvidenceUpload(phoneNumber) {
    try {
      const lastMessage = await usersQueries.getLastMessage(phoneNumber);
      const { projectId, currentTaskIndex } = lastMessage?.context || {};

      if (!projectId || !currentTaskIndex) {
        await whatsappService.sendMessage(phoneNumber, "❌ Context not found.");
        return { success: false };
      }

      const project = await Project.findOne(
        { projectId, phoneNumber },
        { tasks: 1, projectName: 1 }
      ).lean();

      const task = project?.tasks?.[currentTaskIndex - 1];
      if (!task) {
        await whatsappService.sendMessage(phoneNumber, "❌ Task not found.");
        return { success: false };
      }

      // Update user context to remove upload mode
      await usersQueries.updateLastMessage(phoneNumber, {
        flow: "project_tasks",
        step: 2,
        context: {
          projectId,
          currentTaskIndex,
          uploadingEvidence: false,
        },
        text: "evidence_uploaded",
      });

      const evidenceCount = task.evidence?.length || 0;
      await whatsappService.sendMessage(
        phoneNumber,
        `✅ Evidence upload complete!\n\n` +
          `Total files uploaded: ${evidenceCount}\n\n` +
          `What would you like to do next?`
      );

      return { success: true };
    } catch (error) {
      Logger.error("Error finishing evidence upload", error);
      await whatsappService.sendMessage(
        phoneNumber,
        "❌ Error completing upload."
      );
      return { success: false, error: error.message };
    }
  }

  /**
   * Get evidence for a specific task
   */
  static async getTaskEvidence(phoneNumber, projectId, taskIndex) {
    try {
      const project = await Project.findOne(
        { projectId, phoneNumber },
        { tasks: 1 }
      ).lean();

      const task = project?.tasks?.[taskIndex - 1];
      return task?.evidence || [];
    } catch (error) {
      Logger.error("Error fetching task evidence", error);
      return [];
    }
  }

  /**
   * Delete evidence file from task
   */
  static async deleteEvidence(
    phoneNumber,
    projectId,
    taskIndex,
    evidenceIndex
  ) {
    try {
      const project = await Project.findOne(
        { projectId, phoneNumber },
        { tasks: 1 }
      ).lean();

      const task = project?.tasks?.[taskIndex - 1];
      if (!task) {
        return { success: false, error: "Task not found" };
      }

      const evidence = task.evidence?.[evidenceIndex];
      if (!evidence) {
        return { success: false, error: "Evidence not found" };
      }

      // Remove evidence from array
      await Project.findOneAndUpdate(
        {
          projectId,
          phoneNumber,
          "tasks._id": task._id,
        },
        {
          $unset: { "tasks.$.evidence": evidenceIndex },
        }
      );

      // Clean array to remove null values
      await Project.findOneAndUpdate(
        {
          projectId,
          phoneNumber,
          "tasks._id": task._id,
        },
        {
          $pull: { "tasks.$.evidence": null },
        }
      );

      Logger.info("Evidence deleted", {
        phoneNumber,
        projectId,
        evidenceIndex,
      });

      return { success: true };
    } catch (error) {
      Logger.error("Error deleting evidence", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Cleanup temporary file
   */
  static async cleanupTempFile(filePath) {
    try {
      await fs.unlink(filePath);
      Logger.info("Temp file cleaned up", { filePath });
    } catch (error) {
      Logger.warn("Failed to cleanup temp file", { filePath, error });
    }
  }

  /**
   * Get file extension based on media type
   */
  static getFileExtension(mediaType) {
    const extensions = {
      image: "jpg",
      document: "pdf",
      video: "mp4",
      audio: "mp3",
    };
    return extensions[mediaType] || "bin";
  }

  /**
   * Get content type based on media type
   */
  // static getContentType(mediaType) {
  //   if (extension === "png") return "image/png";
  //   const contentTypes = {
  //     image: "image/jpeg",
  //     document: "application/pdf",
  //     video: "video/mp4",
  //     audio: "audio/mpeg",
  //   };
  //   return contentTypes[mediaType] || "application/octet-stream";
  // }

  static getContentType(mediaType, fileName = "") {
    const extension = fileName.split(".").pop()?.toLowerCase();

    if (extension === "png") return "image/png";
    if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
    if (extension === "pdf") return "application/pdf";
    if (extension === "mp4") return "video/mp4";
    if (extension === "mp3") return "audio/mpeg";

    const contentTypes = {
      image: "image/jpeg",
      document: "application/pdf",
      video: "video/mp4",
      audio: "audio/mpeg",
    };

    return contentTypes[mediaType] || "application/octet-stream";
  }

  // ============================================
  // SYNC FUNCTIONS
  // ============================================

  /**
   * Sync project data to server
   */
  static async syncProjectToServer(phoneNumber, projectData) {
    try {
      Logger.info("Syncing project to server", {
        phoneNumber,
        projectId: projectData._id,
      });

      const projectId = projectData._id;
      const lastDownloadedAt = projectData.lastDownloadedAt;

      const url = `${API_BASE_URL}${SYNC_ENDPOINT}/${projectId}?lastDownloadedAt=${lastDownloadedAt}`;

      Logger.info("Calling sync API", { url });

      const response = await makeApiRequest(
        "POST",
        url,
        process.env.ELEVATE_AUTH_TOKEN,
        projectData
      );

      if (!response.success) {
        throw new Error(response.error?.message || "Sync failed");
      }

      Logger.info("Project synced successfully", {
        phoneNumber,
        projectId,
      });

      return response.data.result;
    } catch (error) {
      Logger.error("Error syncing project", error);
      throw error;
    }
  }

  /**
   * Prepare project data for sync with evidence
   */
  static async prepareProjectForSync(phoneNumber, projectData) {
    try {
      const lastMessage = await usersQueries.getLastMessage(phoneNumber);
      const tasks = lastMessage?.context?.tasks || [];
      const projectTasks = projectData.tasks || [];

      Logger.info("Preparing project for sync", {
        phoneNumber,
        taskCount: tasks.length,
      });

      // Update task statuses, evidence and other data in projectData
      const updatedTasks = projectTasks.map((projectTask) => {
        const updatedTask = tasks.find((t) => t.id === projectTask._id);

        if (updatedTask) {
          // Prepare evidence/attachments for sync
          const evidence = updatedTask.evidence || [];
          const attachments = evidence.map((ev) => ({
            name: ev.name,
            type: ev.type,
            sourcePath: ev.sourcePath,
            url: ev.url,
          }));

          return {
            ...projectTask,
            status: updatedTask.status || projectTask.status,
            endDate: updatedTask.endDate || projectTask.endDate,
            attachments:
              attachments.length > 0
                ? attachments
                : projectTask.attachments || [],
          };
        }

        return projectTask;
      });

      const syncPayload = {
        ...projectData,
        tasks: updatedTasks,
        status: "submitted", // Mark as submitted
        lastDownloadedAt: new Date().toISOString(),
      };

      Logger.info("Project prepared for sync", { phoneNumber });

      return syncPayload;
    } catch (error) {
      Logger.error("Error preparing project for sync", error);
      throw error;
    }
  }

  /**
   * Prepare evidence for sync - convert to attachments format
   */
  static async prepareEvidenceForSync(projectData) {
    try {
      const tasks = projectData.tasks || [];

      const updatedTasks = tasks.map((task) => {
        const evidence = task.evidence || [];

        // Convert evidence to attachments format for sync
        const attachments = evidence.map((ev) => ({
          name: ev.name,
          type: ev.type,
          sourcePath: ev.sourcePath,
          url: ev.url,
        }));

        return {
          ...task,
          attachments:
            attachments.length > 0 ? attachments : task.attachments || [],
        };
      });

      return {
        ...projectData,
        tasks: updatedTasks,
      };
    } catch (error) {
      Logger.error("Error preparing evidence for sync", error);
      throw error;
    }
  }
}

module.exports = FileUploadService;
