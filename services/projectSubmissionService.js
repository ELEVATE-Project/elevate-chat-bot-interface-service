// ============================================
// FILE: services/projectSubmissionService.js - UPDATED
// ============================================
const Logger = require("../utils/logger");
const usersQueries = require("../database/databaseQueries/userQueries");
const whatsappService = require("./whatsappService");
const fileUploadService = require("./fileUploadService");
const Project = require("../database/models/project");

const TASK_STATUS = {
  notStarted: "❌ Not Started",
  inProgress: "🔄 In Progress",
  completed: "✅ Completed",
};

class ProjectSubmissionService {
  /**
   * Check and show submit button when all tasks are completed
   */
  static async checkAndShowSubmitButton(phoneNumber) {
    try {
      const lastMessage = await usersQueries.getLastMessage(phoneNumber);
      const projectId =
        lastMessage?.context?.projectId ||
        lastMessage?.context?.project?._id;

      if (!projectId) {
        Logger.warn("No project ID found", { phoneNumber });
        return;
      }

      const projectRecord = await Project.findOne({
        projectId,
        phoneNumber,
      });

      if (!projectRecord) {
        Logger.warn("Project not found in DB", { phoneNumber, projectId });
        return;
      }

      const tasks = projectRecord.tasks || [];

      // Check if all tasks are completed
      const allTasksCompleted = tasks.every((t) => t.status === "completed");

      if (!allTasksCompleted) {
        const completedCount = tasks.filter(
          (t) => t.status === "completed"
        ).length;
        await whatsappService.sendMessage(
          phoneNumber,
          `📋 *Progress: ${completedCount}/${tasks.length} tasks completed*\n\n` +
            `Complete all tasks to submit the project.`
        );
        return;
      }

      Logger.info("All tasks completed, showing submit button", { phoneNumber });

      // Update lastMessage to reflect completion state
      await usersQueries.updateLastMessage(phoneNumber, {
        flow: "project_tasks",
        step: 4,
        context: {
          projectId,
          allTasksCompleted: true,
        },
        text: "ready_for_submission",
      });

      // Show submit button
      await whatsappService.sendInteractiveMessage({
        to: phoneNumber,
        type: "button",
        body: {
          text: `🎉 *All Tasks Completed!*\n\n` +
            `You have successfully completed all ${tasks.length} tasks.\n\n` +
            `Ready to submit your improvement project?`,
        },
        action: {
          buttons: [
            {
              type: "quick_reply",
              title: "✅ Submit Project",
              id: "submit_improvement_project",
            },
            {
              type: "quick_reply",
              title: "📋 Review Tasks",
              id: "back_to_tasks",
            },
          ],
        },
      });
    } catch (error) {
      Logger.error("Error checking submit eligibility", error);
      await whatsappService.sendMessage(
        phoneNumber,
        "❌ Error checking project status."
      );
    }
  }

  /**
   * Prepare submission request body
   */
  static async prepareSubmissionPayload(phoneNumber, projectRecord) {
    try {
      const tasks = projectRecord.tasks || [];
      const projectData = projectRecord.projectData || {};

      // Build task submission payload
      const taskSubmissions = tasks.map((task, index) => ({
        taskId: task._id || task.taskId,
        taskName: task.taskName || task.name,
        type: task.type || task.taskType,
        sequenceNumber: task.sequenceNumber || index + 1,
        status: task.status,
        startDate: task.createdAt,
        endDate: task.endDate || new Date(),
        attachments: task.attachments || [],
        evidence: task.evidence || [],
      }));

      // Build submission payload
      const submissionPayload = {
        // Project Info
        projectId: projectRecord.projectId || projectData._id,
        projectName: projectRecord.projectName,
        solutionId: projectRecord.solutionId || projectData.solutionId,
        programId: projectRecord.programId || projectData.programId,
        
        // User Info
        phoneNumber: phoneNumber,
        userId: projectData.userId,
        
        // Submission Details
        submissionStatus: "submitted",
        submittedAt: new Date().toISOString(),
        
        // Tasks
        tasks: taskSubmissions,
        totalTasksCount: tasks.length,
        completedTasksCount: tasks.filter(t => t.status === "completed").length,
        
        // Metadata
        projectMetadata: {
          title: projectData.title,
          description: projectData.description,
          goal: projectData.goal,
          duration: projectData.duration,
        },
        
        // User Profile
        userProfile: projectData.userProfile || {},
        
        // Sync timestamp
        lastSyncedAt: new Date().toISOString(),
      };

      Logger.info("Submission payload prepared", {
        phoneNumber,
        projectId: submissionPayload.projectId,
        tasksCount: taskSubmissions.length,
      });

      return submissionPayload;
    } catch (error) {
      Logger.error("Error preparing submission payload", error);
      throw error;
    }
  }

  /**
   * Handle project submission
   */
  static async submitImprovementProject(phoneNumber) {
    try {
      const lastMessage = await usersQueries.getLastMessage(phoneNumber);
      const projectId =
        lastMessage?.context?.projectId ||
        lastMessage?.context?.project?._id;

      if (!projectId) {
        await whatsappService.sendMessage(
          phoneNumber,
          "❌ Project not found. Please try again."
        );
        return;
      }

      const projectRecord = await Project.findOne({
        projectId,
        phoneNumber,
      });

      if (!projectRecord) {
        await whatsappService.sendMessage(
          phoneNumber,
          "❌ Project data not found. Please try again."
        );
        return;
      }

      Logger.info("Submitting improvement project", {
        phoneNumber,
        projectId: projectRecord.projectId,
      });

      // Show loading message
      await whatsappService.sendMessage(
        phoneNumber,
        `⏳ *Submitting your project...*\n\nPlease wait while we process your submission.`
      );

      // ✅ NEW: Prepare correct submission payload
      const submissionPayload = await this.prepareSubmissionPayload(
        phoneNumber,
        projectRecord
      );

      // Sync to server
      const syncResult = await fileUploadService.syncProjectToServer(
        phoneNumber,
        submissionPayload
      );

      if (!syncResult) {
        throw new Error("Sync returned no result");
      }

      Logger.info("Project synced successfully", {
        phoneNumber,
        projectId: projectRecord.projectId,
      });

      // Update in MongoDB
      const updatedRecord = await Project.findOneAndUpdate(
        { projectId: projectRecord.projectId, phoneNumber },
        {
          submissionStatus: "submitted",
          submittedAt: new Date(),
          lastSyncedAt: new Date(),
          // Merge sync result with project data
          projectData: {
            ...projectRecord.projectData,
            ...syncResult,
          },
        },
        { new: true }
      );

      Logger.info("Project record updated in DB", {
        phoneNumber,
        recordId: updatedRecord._id,
      });

      // Show success message
      await whatsappService.sendMessage(
        phoneNumber,
        `✅ *Project Submitted Successfully!*\n\n` +
          `Your improvement project has been submitted.\n\n` +
          `📊 *Summary:*\n` +
          `• Tasks Completed: ${submissionPayload.completedTasksCount}/${submissionPayload.totalTasksCount}\n` +
          `• Submitted At: ${new Date().toLocaleDateString()}\n\n` +
          `📜 *Certificate Status:* ` +
          `${syncResult.certificate?.status === "active" ? "Available" : "Pending"}\n\n` +
          `Reference: ${projectRecord.projectId}`
      );

      // Show certificate and share options
      setTimeout(async () => {
        await this.showCertificateAndShareOptions(phoneNumber, updatedRecord);
      }, 1500);
    } catch (error) {
      Logger.error("Error submitting project", error);
      await whatsappService.sendMessage(
        phoneNumber,
        `❌ Error submitting project: ${error.message}\n\nPlease try again.`
      );
    }
  }

  /**
   * Show certificate and share options after submission
   */
  static async showCertificateAndShareOptions(phoneNumber, projectRecord) {
    try {
      Logger.info("Showing certificate options", { phoneNumber });

      const hasCertificate =
        projectRecord.projectData?.certificate?.status === "active";

      let messageText = `🎓 *Your Improvement Project Completion*\n\n`;
      messageText += `Project: ${projectRecord.projectName}\n`;
      messageText += `Status: ✅ Submitted\n`;

      if (hasCertificate) {
        messageText += `Certificate: 📜 Available\n\n`;
        messageText += `Would you like to share your certificate or download it?`;
      } else {
        messageText += `Certificate: 🔄 Processing\n\n`;
        messageText += `Your certificate is being generated and will be available soon.`;
      }

      const buttons = [];

      if (hasCertificate) {
        buttons.push({
          type: "quick_reply",
          title: "📜 View Certificate",
          id: "view_certificate",
        });

        buttons.push({
          type: "quick_reply",
          title: "🔗 Share Certificate",
          id: "share_certificate",
        });
      }

      buttons.push({
        type: "quick_reply",
        title: "🏠 Main Menu",
        id: "main_menu",
      });

      await whatsappService.sendInteractiveMessage({
        to: phoneNumber,
        type: "button",
        body: { text: messageText },
        action: { buttons },
      });
    } catch (error) {
      Logger.error("Error showing certificate options", error);
    }
  }

  /**
   * Handle view certificate
   */
  static async handleViewCertificate(phoneNumber) {
    try {
      const projectRecord = await Project.findOne({
        phoneNumber,
        submissionStatus: "submitted",
      }).sort({ submittedAt: -1 });

      if (
        !projectRecord ||
        !projectRecord.projectData?.certificate
      ) {
        await whatsappService.sendMessage(
          phoneNumber,
          "❌ Certificate not found."
        );
        return;
      }

      const certificateUrl =
        projectRecord.projectData.certificate.downloadUrl ||
        projectRecord.projectData.certificate.url;

      Logger.info("Sending certificate to user", { phoneNumber });

      await whatsappService.sendMessage(
        phoneNumber,
        `📜 *Your Certificate*\n\n` +
          `Project: ${projectRecord.projectName}\n` +
          `Issued: ${new Date(projectRecord.submittedAt).toLocaleDateString()}`
      );

      if (certificateUrl) {
        await whatsappService.sendMediaMessage(
          phoneNumber,
          "document",
          certificateUrl,
          `${projectRecord.projectName}_Certificate.pdf`
        );
      }
    } catch (error) {
      Logger.error("Error viewing certificate", error);
      await whatsappService.sendMessage(
        phoneNumber,
        "❌ Error retrieving certificate."
      );
    }
  }

  /**
   * Handle share certificate
   */
  static async handleShareCertificate(phoneNumber) {
    try {
      const projectRecord = await Project.findOne({
        phoneNumber,
        submissionStatus: "submitted",
      }).sort({ submittedAt: -1 });

      if (!projectRecord) {
        await whatsappService.sendMessage(
          phoneNumber,
          "❌ Project record not found."
        );
        return;
      }

      const certificateUrl =
        projectRecord.projectData?.certificate?.downloadUrl ||
        projectRecord.projectData?.certificate?.url;

      const shareMessage =
        `🎓 I have successfully completed an Improvement Project!\n\n` +
        `Project: ${projectRecord.projectName}\n` +
        `Completed: ${new Date(projectRecord.submittedAt).toLocaleDateString()}\n` +
        `Program: ${projectRecord.projectData?.programName || "N/A"}\n\n` +
        `Certificate: ${certificateUrl || "Available in ShikshaLokam"}`;

      Logger.info("Sharing certificate", { phoneNumber });

      await whatsappService.sendMessage(
        phoneNumber,
        `📤 *Share Your Certificate*\n\n` +
          `Here's a message you can share:\n\n` +
          `"${shareMessage}"\n\n` +
          `Share this with your network! 🎉`
      );

      await whatsappService.sendInteractiveMessage({
        to: phoneNumber,
        type: "button",
        body: {
          text: `Ready to celebrate your achievement? Share it with others! 🎊`,
        },
        action: {
          buttons: [
            {
              type: "quick_reply",
              title: "✅ Done",
              id: "main_menu",
            },
            {
              type: "quick_reply",
              title: "📋 View More Projects",
              id: "view_projects",
            },
          ],
        },
      });
    } catch (error) {
      Logger.error("Error sharing certificate", error);
      await whatsappService.sendMessage(
        phoneNumber,
        "❌ Error sharing certificate."
      );
    }
  }

  /**
   * Get project completion status
   */
  static async getProjectCompletionStatus(phoneNumber) {
    try {
      const projectRecord = await Project.findOne({ phoneNumber }).sort({
        submittedAt: -1,
      });

      if (!projectRecord) {
        return null;
      }

      return {
        projectName: projectRecord.projectName,
        submissionStatus: projectRecord.submissionStatus,
        submittedAt: projectRecord.submittedAt,
        certificateEarned:
          projectRecord.projectData?.certificate?.status === "active",
        taskCount: projectRecord.tasks?.length || 0,
        completedTaskCount:
          projectRecord.tasks?.filter((t) => t.status === "completed")
            .length || 0,
      };
    } catch (error) {
      Logger.error("Error getting project status", error);
      return null;
    }
  }
}

module.exports = ProjectSubmissionService;