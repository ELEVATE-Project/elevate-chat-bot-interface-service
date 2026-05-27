// ============================================
// FILE: services/taskService.js - CORRECTED
// ============================================
const Logger = require("../utils/logger");
const { makeApiRequest } = require("../generics/services/axios");
const usersQueries = require("../database/databaseQueries/userQueries");
const whatsappService = require("./whatsappService");
const Project = require("../database/models/project"); // ✅ ADDED: Import Project model
const projectSubmissionService = require("./projectSubmissionService");

const TASK_TYPES = {
  content: "📚 Learning Resource",
  simple: "✅ Simple Task",
  reflection: "💭 Reflection Task",
};

const TASK_STATUS = {
  notStarted: "❌ Not Started",
  inProgress: "🔄 In Progress",
  completed: "✅ Completed",
};

class TaskService {
  /**
   * Helper: fetch project by projectId + phoneNumber from DB
   */
  static async fetchProjectFromDB(phoneNumber, projectId) {
    if (!projectId || !phoneNumber) return null;
    try {
      const proj = await Project.findOne(
        { projectId, phoneNumber },
        {
          projectId: 1,
          projectName: 1,
          solutionId: 1,
          programId: 1,
          projectData: 1,
          tasks: 1,
        }
      ).lean();
      return proj;
    } catch (err) {
      Logger.error("Error fetching project from DB", {
        phoneNumber,
        projectId,
        err,
      });
      return null;
    }
  }

  /**
   * Show list of tasks for a project
   */
  static async showTasksMenu(phoneNumber, projectData) {
    try {
      const projectId =
        (projectData &&
          (projectData.projectId ||
            projectData._id ||
            projectData.project?.projectId)) ||
        null;

      // If projectData already contains tasks, still refresh from DB to keep source-of-truth
      const project = projectId
        ? await this.fetchProjectFromDB(phoneNumber, projectId)
        : projectData && projectData.project
        ? projectData.project
        : projectData;

      if (!project) {
        const lastMessage = await usersQueries.getLastMessage(phoneNumber);
        const ctxProjectId =
          lastMessage?.context?.projectId ||
          lastMessage?.context?.project?._id;
        if (ctxProjectId) {
          const projFromDb = await this.fetchProjectFromDB(
            phoneNumber,
            ctxProjectId
          );
          if (projFromDb) {
            return await this._showTasksMenuWithProject(phoneNumber, projFromDb);
          }
        }

        Logger.warn("Project not found for showTasksMenu", {
          phoneNumber,
          provided: !!projectData,
        });
        await whatsappService.sendMessage(
          phoneNumber,
          "❌ Project data not found. Please select project again."
        );
        return;
      }

      await this._showTasksMenuWithProject(phoneNumber, project);
    } catch (error) {
      Logger.error("Error showing tasks menu", error);
      await whatsappService.sendMessage(
        phoneNumber,
        "❌ Error loading tasks. Please try again."
      );
    }
  }

  static async _showTasksMenuWithProject(phoneNumber, project) {
    try {
      Logger.info("Showing tasks menu (DB)", {
        phoneNumber,
        projectId: project.projectId || project._id,
        solutionId: project.solutionId,
      });

      const tasks = project.tasks || [];

      if (tasks.length === 0) {
        await whatsappService.sendMessage(
          phoneNumber,
          "📋 No tasks available in this project."
        );
        return;
      }

      // Update lastMessage context (only projectId, rest from DB)
      await usersQueries.updateLastMessage(phoneNumber, {
        flow: "project_tasks",
        step: 0,
        context: {
          projectId: project.projectId || project._id,
          solutionId: project.solutionId,
        },
        text: "view_tasks",
      });

      await this.showTaskSummary(phoneNumber, tasks);
    } catch (err) {
      Logger.error("Error in _showTasksMenuWithProject", { err });
      await whatsappService.sendMessage(
        phoneNumber,
        "❌ Error loading tasks. Please try again."
      );
    }
  }

  /**
   * Show summary of all tasks with pagination
   */
//   static async showTaskSummary(phoneNumber, tasksOrProjectId, page = 1) {
//     try {
//       let tasks = [];

//       // Normalize input: could be array, string (projectId), or object (project)
//       if (Array.isArray(tasksOrProjectId)) {
//         tasks = tasksOrProjectId;
//       } else if (typeof tasksOrProjectId === "string") {
//         // tasksOrProjectId is projectId
//         const project = await this.fetchProjectFromDB(
//           phoneNumber,
//           tasksOrProjectId
//         );
//         tasks = project?.tasks || [];
//       } else if (tasksOrProjectId && tasksOrProjectId.tasks) {
//         tasks = tasksOrProjectId.tasks;
//       } else {
//         // Fallback: try to get projectId from context
//         const lastMessage = await usersQueries.getLastMessage(phoneNumber);
//         const ctxProjectId =
//           lastMessage?.context?.projectId ||
//           lastMessage?.context?.project?._id;
//         if (ctxProjectId) {
//           const project = await this.fetchProjectFromDB(
//             phoneNumber,
//             ctxProjectId
//           );
//           tasks = project?.tasks || [];
//         }
//       }

//       const tasksPerPage = 5;
//       const totalPages = Math.max(1, Math.ceil(tasks.length / tasksPerPage));
//       if (page < 1) page = 1;
//       if (page > totalPages) page = totalPages;

//       const start = (page - 1) * tasksPerPage;
//       const paginatedTasks = tasks.slice(start, start + tasksPerPage);

//       let summary = `📋 *Project Tasks* (Page ${page}/${totalPages})\n\n`;

//       paginatedTasks.forEach((task, index) => {
//         const taskNum = start + index + 1;
//         const taskIcon =
//           task.type === "content" || task.taskType === "content"
//             ? "📚"
//             : task.type === "reflection" || task.taskType === "reflection"
//             ? "💭"
//             : "✅";
//         const statusIcon =
//           task.status === "notStarted"
//             ? "❌"
//             : task.status === "inProgress"
//             ? "🔄"
//             : "✅";

//         const name = task.taskName || task.name || "Untitled Task";

//         summary += `${taskNum}. ${taskIcon} ${name}\n`;
//         summary += `   ${statusIcon} ${TASK_STATUS[task.status] || task.status || "Unknown"}\n\n`;
//       });

//       summary += `\nType task number (${start + 1}-${Math.min(start + tasksPerPage, tasks.length)}) to view details`;

//       const buttons = [];
//       if (page > 1) {
//         buttons.push({
//           type: "quick_reply",
//           title: "⬅️ Previous",
//           id: `tasks_prev_${page - 1}`,
//         });
//       }
//       if (page < totalPages) {
//         buttons.push({
//           type: "quick_reply",
//           title: "Next ➡️",
//           id: `tasks_next_${page + 1}`,
//         });
//       }

//       buttons.push({
//         type: "quick_reply",
//         title: "🏠 Back to Project",
//         id: "back_to_project",
//       });

//       if (buttons.length > 0) {
//         await whatsappService.sendInteractiveMessage({
//           to: phoneNumber,
//           type: "button",
//           body: { text: summary },
//           action: { buttons },
//         });
//       } else {
//         await whatsappService.sendMessage(phoneNumber, summary);
//       }

//       Logger.info("Task summary shown", { phoneNumber, page, totalPages });
//     } catch (error) {
//       Logger.error("Error showing task summary", error);
//       await whatsappService.sendMessage(
//         phoneNumber,
//         "❌ Error loading task summary."
//       );
//     }
//   }

static async showTaskSummary(phoneNumber, tasksOrProjectId, page = 1) {
    try {
      let tasks = [];
      let projectId = null;
  
      // Normalize input: could be array, string (projectId), or object (project)
      if (Array.isArray(tasksOrProjectId)) {
        tasks = tasksOrProjectId;
        // Try to get projectId from context
        const lastMessage = await usersQueries.getLastMessage(phoneNumber);
        projectId = lastMessage?.context?.projectId;
      } else if (typeof tasksOrProjectId === "string") {
        // tasksOrProjectId is projectId
        projectId = tasksOrProjectId;
        const project = await this.fetchProjectFromDB(
          phoneNumber,
          tasksOrProjectId
        );
        tasks = project?.tasks || [];
      } else if (tasksOrProjectId && tasksOrProjectId.tasks) {
        tasks = tasksOrProjectId.tasks;
        projectId = tasksOrProjectId.projectId || tasksOrProjectId._id;
      } else {
        // Fallback: try to get projectId from context
        const lastMessage = await usersQueries.getLastMessage(phoneNumber);
        const ctxProjectId =
          lastMessage?.context?.projectId ||
          lastMessage?.context?.project?._id;
        projectId = ctxProjectId;
        if (ctxProjectId) {
          const project = await this.fetchProjectFromDB(
            phoneNumber,
            ctxProjectId
          );
          tasks = project?.tasks || [];
        }
      }
  
      const tasksPerPage = 5;
      const totalPages = Math.max(1, Math.ceil(tasks.length / tasksPerPage));
      if (page < 1) page = 1;
      if (page > totalPages) page = totalPages;
  
      const start = (page - 1) * tasksPerPage;
      const paginatedTasks = tasks.slice(start, start + tasksPerPage);
  
      // ✅ NEW: Check if all tasks are completed
      const completedCount = tasks.filter(t => t.status === "completed").length;
      const totalTasksCount = tasks.length;
      const allTasksCompleted = completedCount === totalTasksCount && totalTasksCount > 0;
  
      let summary = `📋 *Project Tasks* (Page ${page}/${totalPages})\n`;
      summary += `📊 Progress: ${completedCount}/${totalTasksCount} completed\n\n`;
  
      paginatedTasks.forEach((task, index) => {
        const taskNum = start + index + 1;
        const taskIcon =
          task.type === "content" || task.taskType === "content"
            ? "📚"
            : task.type === "reflection" || task.taskType === "reflection"
            ? "💭"
            : "✅";
        const statusIcon =
          task.status === "notStarted"
            ? "❌"
            : task.status === "inProgress"
            ? "🔄"
            : "✅";
  
        const name = task.taskName || task.name || "Untitled Task";
  
        summary += `${taskNum}. ${taskIcon} ${name}\n`;
        summary += `   ${statusIcon} ${TASK_STATUS[task.status] || task.status || "Unknown"}\n\n`;
      });
  
      summary += `\nType task number (${start + 1}-${Math.min(start + tasksPerPage, tasks.length)}) to view details`;
  
      const buttons = [];
      
      if (page > 1) {
        buttons.push({
          type: "quick_reply",
          title: "⬅️ Previous",
          id: `tasks_prev_${page - 1}`,
        });
      }
      
      if (page < totalPages) {
        buttons.push({
          type: "quick_reply",
          title: "Next ➡️",
          id: `tasks_next_${page + 1}`,
        });
      }
  
      // ✅ NEW: Add submit button if all tasks are completed
      if (allTasksCompleted) {
        buttons.push({
          type: "quick_reply",
          title: "🎉 Submit Project",
          id: "submit_improvement_project",
        });
      }
  
      buttons.push({
        type: "quick_reply",
        title: "🏠 Back to Project",
        id: "back_to_project",
      });
  
      // ✅ NEW: Show completion message if all done
      if (allTasksCompleted) {
        await whatsappService.sendMessage(
          phoneNumber,
          `🎉 *Congratulations!*\n\n` +
            `You have successfully completed all ${totalTasksCount} tasks! 🌟\n\n` +
            `Ready to submit your improvement project?`
        );
  
        // Add delay before showing summary with submit button
        setTimeout(async () => {
          await whatsappService.sendInteractiveMessage({
            to: phoneNumber,
            type: "button",
            body: { text: summary },
            action: { buttons },
          });
        }, 1000);
      } else {
        // Show regular summary without submit button
        if (buttons.length > 0) {
          await whatsappService.sendInteractiveMessage({
            to: phoneNumber,
            type: "button",
            body: { text: summary },
            action: { buttons },
          });
        } else {
          await whatsappService.sendMessage(phoneNumber, summary);
        }
      }
  
      Logger.info("Task summary shown", { 
        phoneNumber, 
        page, 
        totalPages,
        completedCount,
        totalTasksCount,
        allCompleted: allTasksCompleted 
      });
    } catch (error) {
      Logger.error("Error showing task summary", error);
      await whatsappService.sendMessage(
        phoneNumber,
        "❌ Error loading task summary."
      );
    }
  }

  /**
   * Show detailed view of a specific task
   */
  static async showTaskDetails(phoneNumber, taskIndex) {
    try {
      // ✅ FIXED: Get projectId from lastMessage ONLY
      const lastMessage = await usersQueries.getLastMessage(phoneNumber);
      const projectId =
        lastMessage?.context?.projectId ||
        lastMessage?.context?.project?._id;

      if (!projectId) {
        Logger.warn("showTaskDetails: projectId not found in context", {
          phoneNumber,
        });
        await whatsappService.sendMessage(
          phoneNumber,
          "❌ Project not found. Please select a project first."
        );
        return;
      }

      // ✅ FIXED: Get everything else from DB
      const project = await this.fetchProjectFromDB(phoneNumber, projectId);

      if (!project) {
        await whatsappService.sendMessage(
          phoneNumber,
          "❌ Project not found. Please select a project again."
        );
        return;
      }

      const tasks = project.tasks || [];
      const task = tasks[taskIndex - 1];

      if (!task) {
        await whatsappService.sendMessage(
          phoneNumber,
          "❌ Task not found. Please select a valid task number."
        );
        return;
      }

      Logger.info("Showing task details (DB)", {
        phoneNumber,
        taskId: task._id || task.taskId,
        taskName: task.taskName || task.name,
      });

      // Update context with projectId only
      await usersQueries.updateLastMessage(phoneNumber, {
        flow: "project_tasks",
        step: 1,
        context: {
          projectId,
          currentTaskIndex: taskIndex,
        },
        text: "view_task_details",
      });

      let detailsText = `📋 *Task ${taskIndex}: ${task.taskName || task.name}*\n\n`;
      detailsText += `Type: ${TASK_TYPES[task.type] || TASK_TYPES[task.taskType] || task.type || ""}\n`;
      detailsText += `Status: ${TASK_STATUS[task.status] || task.status || ""}\n`;
      detailsText += `Sequence: ${task.sequenceNumber || task.sequenceNo || ""}\n\n`;

      const buttons = [];

      if ((task.type || task.taskType) === "content") {
        buttons.push({
          type: "quick_reply",
          title: "📚 View Resources",
          id: `view_resources_${taskIndex}`,
        });
      }

      buttons.push({
        type: "quick_reply",
        title: "✏️ Update Status",
        id: `updated_task_status_${taskIndex}`,
      });

      buttons.push({
        type: "quick_reply",
        title: "📤 Upload Evidence",
        id: `upload_evidence_${taskIndex}`,
      });

      buttons.push({
        type: "quick_reply",
        title: "⬅️ Back to Tasks",
        id: "back_to_tasks",
      });

      await whatsappService.sendInteractiveMessage({
        to: phoneNumber,
        type: "button",
        body: { text: detailsText },
        action: { buttons },
      });
    } catch (error) {
      Logger.error("Error showing task details", error);
      await whatsappService.sendMessage(
        phoneNumber,
        "❌ Error loading task details."
      );
    }
  }

  /**
   * Show learning resources for a task
   */
  static async showTaskResources(phoneNumber, taskIndex) {
    try {
      const lastMessage = await usersQueries.getLastMessage(phoneNumber);
      const projectId =
        lastMessage?.context?.projectId ||
        lastMessage?.context?.project?._id;

      if (!projectId) {
        await whatsappService.sendMessage(phoneNumber, "❌ Project not found.");
        return;
      }

      const project = await this.fetchProjectFromDB(phoneNumber, projectId);
      const task = project?.tasks?.[taskIndex - 1];

      if (!task) {
        await whatsappService.sendMessage(phoneNumber, "❌ Task not found.");
        return;
      }

      const resources = task.learningResources || [];
      if (!resources.length) {
        await whatsappService.sendMessage(
          phoneNumber,
          "📚 No learning resources available for this task."
        );
        return;
      }

      Logger.info("Showing task resources", {
        phoneNumber,
        taskId: task._id || task.taskId,
        resourceCount: resources.length,
      });

      let resourcesText = `📚 *Learning Resources: ${task.taskName || task.name}*\n\n`;
      resources.forEach((resource, index) => {
        resourcesText += `${index + 1}. *${resource.name || resource.title || "Resource"}*\n`;
        if (resource.link)
          resourcesText += `Link: ${resource.link}\n\n`;
        else if (resource.url)
          resourcesText += `Link: ${resource.url}\n\n`;
      });

      resourcesText += `\n_Tap the links above to access the resources_`;

      await whatsappService.sendMessage(phoneNumber, resourcesText);

      setTimeout(async () => {
        await whatsappService.sendInteractiveMessage({
          to: phoneNumber,
          type: "button",
          body: {
            text: "Would you like to update this task status?",
          },
          action: {
            buttons: [
              {
                type: "quick_reply",
                title: "✏️ Update Status",
                id: `updated_task_status_${taskIndex}`,
              },
              {
                type: "quick_reply",
                title: "⬅️ Back to Tasks",
                id: "back_to_tasks",
              },
            ],
          },
        });
      }, 1000);
    } catch (error) {
      Logger.error("Error showing task resources", error);
      await whatsappService.sendMessage(
        phoneNumber,
        "❌ Error loading resources."
      );
    }
  }

  /**
   * Show status update options for a task
   */
   static async showStatusUpdateMenu(phoneNumber, taskIndex) {
    try {
      // ✅ FIXED: Get projectId from lastMessage ONLY
      const lastMessage = await usersQueries.getLastMessage(phoneNumber);
      const projectId =
        lastMessage?.context?.projectId ||
        lastMessage?.context?.project?._id;

      if (!projectId) {
        await whatsappService.sendMessage(
          phoneNumber,
          "❌ Project not found. Please select project again."
        );
        return;
      }

      // ✅ FIXED: Get project from DB
      const project = await this.fetchProjectFromDB(phoneNumber, projectId);
      console.log(project,"fromDB")
      if (!project) {
        await whatsappService.sendMessage(
          phoneNumber,
          "❌ Project not found. Please select project again."
        );
        return;
      }

      const task = project.tasks?.[taskIndex - 1];
      if (!task) {
        await whatsappService.sendMessage(phoneNumber, "❌ Task not found.");
        return;
      }

      Logger.info("Showing status update menu (DB)", {
        phoneNumber,
        taskId: task._id || task.taskId,
        currentStatus: task.status,
      });

      // ✅ FIXED: Store only projectId
      await usersQueries.updateLastMessage(phoneNumber, {
        flow: "project_tasks",
        step: 2,
        context: {
          projectId,
          currentTaskIndex: taskIndex,
          updatingTaskStatus: true,
        },
        text: "update_task_status",
      });

      await whatsappService.sendInteractiveMessage({
        to: phoneNumber,
        type: "button",
        body: {
          text: `📋 *Update Task Status*\n\nTask: ${task.taskName || task.name}\n\nSelect new status:`,
        },
        action: {
          buttons: [
            {
              type: "quick_reply",
              title: "❌ Not Started",
              id: `set_status_notStarted_${taskIndex}`,
            },
            {
              type: "quick_reply",
              title: "🔄 In Progress",
              id: `set_status_inProgress_${taskIndex}`,
            },
            {
              type: "quick_reply",
              title: "✅ Completed",
              id: `set_status_completed_${taskIndex}`,
            },
          ],
        },
      });
    } catch (error) {
      Logger.error("Error showing status update menu", error);
      await whatsappService.sendMessage(
        phoneNumber,
        "❌ Error loading status options."
      );
    }
  }

  /**
   * Handle task status update
   */
  static async handleStatusUpdate(phoneNumber, taskIndex, newStatus) {
    try {
      const lastMessage = await usersQueries.getLastMessage(phoneNumber);
      const projectId =
        lastMessage?.context?.projectId ||
        lastMessage?.context?.project?._id;

      if (!projectId) {
        await whatsappService.sendMessage(phoneNumber, "❌ Invalid task data.ProjectId is missing");
        return;
      }

      const project = await this.fetchProjectFromDB(phoneNumber, projectId);
      if (!project) {
        await whatsappService.sendMessage(phoneNumber, "❌ Invalid task data.project not found");
        return;
      }

      const tasks = project.tasks || [];
      const task = tasks[taskIndex - 1];
      if (!task) {
        await whatsappService.sendMessage(phoneNumber, "❌ Task not found.");
        return;
      }

      Logger.info("Updating task status (DB)", {
        phoneNumber,
        projectId,
        taskId: task.taskId || task._id,
        newStatus,
      });

      // Update MongoDB
      const updateKey = `tasks.${taskIndex - 1}.status`;
      const endDateKey = `tasks.${taskIndex - 1}.endDate`;

      await Project.updateOne(
        { projectId, phoneNumber },
        {
          $set: {
            [updateKey]: newStatus,
            [endDateKey]: new Date(),
          },
        }
      );

      // Update lastMessage context
      await usersQueries.updateLastMessage(phoneNumber, {
        flow: "project_tasks",
        step: 1,
        context: {
          projectId,
          currentTaskIndex: taskIndex,
        },
        text: "task_status_updated",
      });

      await whatsappService.sendMessage(
        phoneNumber,
        `✅ Task status updated to: ${TASK_STATUS[newStatus] || newStatus}\n\n` +
          `📋 Task: ${task.taskName || task.name}`
      );

      // ✅ NEW: Check if all tasks are now completed
      const updatedProject = await this.fetchProjectFromDB(phoneNumber, projectId);
      const allCompleted = await this.checkAllTasksCompleted(updatedProject);

      if (allCompleted) {
        // Auto-trigger submission check with a slight delay
        setTimeout(async () => {
          await projectSubmissionService.checkAndShowSubmitButton(phoneNumber);
        }, 1500);
      } else {
        // Show evidence upload prompt if not all completed
        setTimeout(async () => {
          await whatsappService.sendInteractiveMessage({
            to: phoneNumber,
            type: "button",
            body: {
              text: "Upload evidence (documents/images) for this task?",
            },
            action: {
              buttons: [
                {
                  type: "quick_reply",
                  title: "📤 Upload Evidence",
                  id: `upload_evidence_${taskIndex}`,
                },
                {
                  type: "quick_reply",
                  title: "⬅️ Back to Tasks",
                  id: "back_to_tasks",
                },
              ],
            },
          });
        }, 1000);
      }
    } catch (error) {
      Logger.error("Error updating task status", error);
      await whatsappService.sendMessage(phoneNumber, "❌ Error updating status.");
    }
  }

  /**
   * Check if all tasks are completed
   */
  static async checkAllTasksCompleted(project) {
    try {
      if (!project || !project.tasks) return false;
      
      const tasks = project.tasks;
      const completedTasks = tasks.filter(t => t.status === "completed").length;
      const totalTasks = tasks.length;
      
      Logger.info("Task completion check", {
        completed: completedTasks,
        total: totalTasks,
        allCompleted: completedTasks === totalTasks,
      });

      return completedTasks === totalTasks && totalTasks > 0;
    } catch (error) {
      Logger.error("Error checking task completion", error);
      return false;
    }
  }


  /**
   * Handle evidence upload prompt
   */
  static async handleEvidenceUploadPrompt(phoneNumber, taskIndex) {
    try {
        console.log("==============================================")
      const lastMessage = await usersQueries.getLastMessage(phoneNumber);
      const projectId =
        lastMessage?.context?.projectId ||
        lastMessage?.context?.project?._id;

      if (!projectId) {
        await whatsappService.sendMessage(phoneNumber, "❌ Task not found.");
        return;
      }

      const project = await this.fetchProjectFromDB(phoneNumber, projectId);
      const task = project?.tasks?.[taskIndex - 1];

      if (!task) {
        await whatsappService.sendMessage(phoneNumber, "❌ Task not found.");
        return;
      }

      Logger.info("Prompting evidence upload", {
        phoneNumber,
        taskId: task.taskId || task._id,
      });

      await usersQueries.updateLastMessage(phoneNumber, {
        flow: "project_tasks",
        step: 3,
        context: {
          projectId,
          currentTaskIndex: taskIndex,
          uploadingEvidence: true,
        },
        text: "upload_evidence",
      });

      await whatsappService.sendMessage(
        phoneNumber,
        `📤 *Upload Evidence for Task: ${task.taskName || task.name}*\n\n` +
          `Please share documents or images as evidence for this task.\n\n` +
          `You can send:\n` +
          `• Photos (images)\n` +
          `• Documents (PDFs)\n` +
          `• Multiple files\n\n` +
          `_Note: Store the file details, we'll upload them later_`
      );
    } catch (error) {
      Logger.error("Error in evidence upload prompt", error);
      await whatsappService.sendMessage(
        phoneNumber,
        "❌ Error processing evidence upload."
      );
    }
  }

  /**
   * Handle pagination for task list
   */
  static async handleTaskPagination(phoneNumber, direction, page) {
    try {
      const lastMessage = await usersQueries.getLastMessage(phoneNumber);
      const projectId =
        lastMessage?.context?.projectId ||
        lastMessage?.context?.project?._id;

      if (!projectId) {
        await whatsappService.sendMessage(
          phoneNumber,
          "❌ Project data not found."
        );
        return;
      }

      const project = await this.fetchProjectFromDB(phoneNumber, projectId);
      if (!project || !project.tasks) {
        await whatsappService.sendMessage(
          phoneNumber,
          "❌ Project data not found."
        );
        return;
      }

      await this.showTaskSummary(phoneNumber, project.tasks, page);
    } catch (error) {
      Logger.error("Error handling task pagination", error);
      await whatsappService.sendMessage(phoneNumber, "❌ Error loading tasks.");
    }
  }

  /**
   * Sync task updates to server
   */
  static async syncTaskUpdates(phoneNumber, taskIndex, updateData) {
    try {
      Logger.info("Preparing task sync", {
        phoneNumber,
        taskIndex,
        updateData,
      });

      Logger.info("Task sync prepared (pending API integration)", {
        phoneNumber,
      });

      return {
        success: true,
        message: "Task updates queued for sync",
      };
    } catch (error) {
      Logger.error("Error syncing task updates", error);
      return {
        success: false,
        error: error.message,
      };
    }
  }
}

module.exports = TaskService;