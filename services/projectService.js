// ============================================
// FILE: services/projectService.js
// ============================================
const whatsappService = require("./whatsappService");
const usersQueries = require("../database/databaseQueries/userQueries");
const Logger = require("../utils/logger");
const config = require("../config/config");
const { makeApiRequest } = require("../generics/services/axios");
const Project = require("../database/models/project");
const taskService = require("./taskService");
class ProjectService {
  constructor() {
    this.apiBaseUrl = config.backend.apiUrl;
  }

  getHeaders() {
    return {
      "content-type": "application/json",
      "x-auth-token":
        process.env.ELEVATE_AUTH_TOKEN ||
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJkYXRhIjp7ImlkIjoyODU1LCJuYW1lIjoic2dmdW5jdGlvbmFyaWVzIHNnb2ZmaWNpYWwiLCJzZXNzaW9uX2lkIjoyMjM1NSwib3JnYW5pemF0aW9uX2lkcyI6WyIzOSJdLCJvcmdhbml6YXRpb25fY29kZXMiOlsidHJpcHVyYSJdLCJ0ZW5hbnRfY29kZSI6InNoaWtzaGFncmFoYW5ldyIsIm9yZ2FuaXphdGlvbnMiOlt7ImlkIjozOSwibmFtZSI6IlRyaXB1cmEiLCJjb2RlIjoidHJpcHVyYSIsImRlc2NyaXB0aW9uIjoidHJpcHVyYSBzdGF0ZSBhcyBhbiBvcmdhbml6YXRpb24gdGVzdCBpbiBTRyIsInN0YXR1cyI6IkFDVElWRSIsInJlbGF0ZWRfb3JncyI6W10sInRlbmFudF9jb2RlIjoic2hpa3NoYWdyYWhhbmV3IiwibWV0YSI6bnVsbCwiY3JlYXRlZF9ieSI6MSwidXBkYXRlZF9ieSI6Mzc3LCJyb2xlcyI6W3siaWQiOjc3LCJ0aXRsZSI6Im1lbnRlZSIsImxhYmVsIjoibWVudGVlIiwidXNlcl90eXBlIjowLCJzdGF0dXMiOiJBQ1RJVkUiLCJvcmdhbml6YXRpb25faWQiOjM1LCJ2aXNpYmlsaXR5IjoiUFVCTElDIiwidGVuYW50X2NvZGUiOiJzaGlrc2hhZ3JhaGFuZXciLCJ0cmFuc2xhdGlvbnMiOm51bGx9XX1dfSwiaWF0IjoxNzYyODQ2NjI3LCJleHAiOjE3NjI5MzMwMjd9.njm8kuA676wnDyVoJ1l9HxrOHECG_fiaj9fVKo6IHJw",
      origin: this.apiBaseUrl,
    };
  }

  /**
   * Start new project creation flow
   */
  async startNewProjectFlow(phoneNumber) {
    try {
      // Set flow state
      await usersQueries.updateLastMessage(phoneNumber, {
        flow: "project_creation",
        step: 1, // Ask for project name
        context: {},
        text: "start_new_project",
      });

      await whatsappService.sendMessage(
        phoneNumber,
        "🎯 *Let's create a new project!*\n\n" +
          "Please enter the *project name*:\n\n" +
          "_(Type 'cancel' anytime to exit)_"
      );

      Logger.info("Started project creation flow", { phoneNumber });
    } catch (error) {
      Logger.error("Error starting project flow", error);
      throw error;
    }
  }

  /**
   * Handle project browsing flow (when user selects a project number)
   */
  async handleProjectBrowseFlow(phoneNumber, messageText, lastMessage) {
    try {
      const step = lastMessage.step || 1;
      const context = lastMessage.context || {};

      Logger.info("Project browse flow", { phoneNumber, step, messageText });

      // User typed a project number
      if (step === 1 && /^\d+$/.test(messageText.trim())) {
        const projectNumber = parseInt(messageText.trim());
        const projectKey = `project_${projectNumber}`;
        const projectId = context.projectMap?.[projectKey];

        if (!projectId) {
          await whatsappService.sendMessage(
            phoneNumber,
            `❌ Invalid project number. Please select between 1-${
              context.totalProjects || 5
            }.`
          );
          return;
        }

        // Fetch project details
        await this.showProjectDetails(phoneNumber, projectId);
        return;
      }

      // If unrecognized input, prompt again
      await whatsappService.sendMessage(
        phoneNumber,
        "Please enter a valid project number or use the navigation buttons."
      );
    } catch (error) {
      Logger.error("Error in project browse flow", error);
      await usersQueries.clearLastMessage(phoneNumber);
      throw error;
    }
  }

  /**
   * Show detailed view of a single project
   */

  async showProjectDetails(phoneNumber, message) {
    try {
      let projectId, solutionId, projectType;

      // Extract the full selectedId from the message
      // Format: "ListV3:solutionWithProject_<id>" or "ListV3:solutionWithoutProject_<id>"
      let selectedId;
      console.log(message, "this is message");
      if (message.reply?.list_reply?.id) {
        selectedId = message.reply.list_reply.id;
      } else if (message.interactive?.list_reply?.id) {
        selectedId = message.interactive.list_reply.id;
      }

      if (!selectedId) {
        Logger.warn("Invalid project selection - no selectedId found", {
          phoneNumber,
        });
        await whatsappService.sendMessage(
          phoneNumber,
          `❌ Invalid project selection. Please try again.`
        );
        await this.listProjects(phoneNumber, 1);
        return;
      }

      // Remove "ListV3:" prefix if present
      const cleanId = selectedId.replace(/^ListV3:/, "");

      // Retrieve project data from the stored project mapping
      // const lastMessage = await usersQueries.getLastMessage(phoneNumber);
      // const projectMap = lastMessage?.context?.projectMap || {};
      // console.log(projectMap,"this is map")
      // const projectData = projectMap[cleanId];

      // if (!projectData) {
      //   Logger.warn("Project data not found in map", {
      //     phoneNumber,
      //     cleanId,
      //     mapKeys: Object.keys(projectMap),
      //   });
      //   await whatsappService.sendMessage(
      //     phoneNumber,
      //     `❌ Invalid project selection. Please try again.`
      //   );
      //   await this.listProjects(phoneNumber, 1);
      //   return;
      // }
      if (selectedId) {
        // Remove prefix like "ListV3:" if present
        const cleanedId = selectedId.replace(/^ListV3:/, "");

        // Split type and id
        const [type, id] = cleanedId.split("_");

        projectType = type;

        if (projectType === "solutionWithProject") {
          projectId = id;
        } else if (projectType === "solutionWithoutProject") {
          solutionId = id;
        } else {
          console.warn("Unknown project type:", projectType);
        }
      }

      // projectId = projectData.projectId;
      // solutionId = projectData.solutionId;
      // projectType = projectData.type; // "solutionWithProject" or "solutionWithoutProject"

      Logger.info("Project selected", {
        phoneNumber,
        projectId,
        solutionId,
        projectType,
        cleanId,
      });

      Logger.info("Fetching project details", {
        phoneNumber,
        projectId,
        solutionId,
        projectType,
      });

      // Determine endpoint based on project type
      let url;
      if (projectType === "solutionWithProject") {
        url = `${this.apiBaseUrl}/project/v1/userProjects/details/${projectId}`;
      } else if (projectType === "solutionWithoutProject") {
        url = `${this.apiBaseUrl}/project/v1/solutions/details/${solutionId}`;
      } else {
        throw new Error(`Unknown project type: ${projectType}`);
      }

      Logger.info("API endpoint determined", { projectType, url });

      const response = await makeApiRequest(
        "POST",
        url,
        process.env.ELEVATE_AUTH_TOKEN,
        {
          state: "6863a9941d52e30014093ad9",
          district: "6863aa5f1d52e30014093b48",
          block: "6863aaad1d52e30014093b8e",
          cluster: "6863ab011d52e30014093d27",
          school: "68650f6f633ad100153fdb4c",
          professional_role: "6867add70d8d24001465c3e4",
          professional_subroles:
            "6867b0530d8d24001465c409,6867b0530d8d24001465c40b,6867b0530d8d24001465c40d,6867b0530d8d24001465c40f,6867b0530d8d24001465c411,6867b0530d8d24001465c413,6867b0530d8d24001465c415,6867b0530d8d24001465c417,6867b0530d8d24001465c419,6867b0530d8d24001465c41b,6867b0530d8d24001465c41d,6867b0530d8d24001465c41f,6867b0530d8d24001465c421,6867b0530d8d24001465c423,6867b0530d8d24001465c425,6867b0530d8d24001465c427,6867b0530d8d24001465c429,6867b0530d8d24001465c42b,6867b0530d8d24001465c42d,6867b0530d8d24001465c42f,6867b0530d8d24001465c431,6867b0530d8d24001465c433,6867b0530d8d24001465c435,6867b0530d8d24001465c437,6867b0530d8d24001465c439,6867b0530d8d24001465c43b,6867b0530d8d24001465c43d,6867b0530d8d24001465c43f,6867b0530d8d24001465c441,6867b0530d8d24001465c443,6867b0530d8d24001465c445,6867b0530d8d24001465c447,6867b0530d8d24001465c449,6867b0530d8d24001465c44b",
          organizations: "[object Object]",
        }
      );

      const project = response?.data?.result || response?.data;

      if (!project) {
        await whatsappService.sendMessage(
          phoneNumber,
          "❌ Failed to load project details. Please try again."
        );
        await this.listProjects(phoneNumber, 1);
        await usersQueries.clearLastMessage(phoneNumber);
        return;
      }

      // Update flow state to project detail view
      await usersQueries.updateLastMessage(phoneNumber, {
        flow: "project_detail",
        step: 0,
        context: { projectId, solutionId, project },
        text: `view_project_${projectId}`,
      });

      console.log(project, "this is project");

      // Format project details message
      const detailsText =
        `*📁 ${project.title ?? project.name}*\n\n` +
        `${project.description ? `${project.description}\n\n` : ""}` +
        `*Duration:* ${project.duration || "N/A"}\n` +
        `*Status:* ${project.status || "Unknown"}\n` +
        `\nWhat would you like to do?`;

      // await whatsappService.sendInteractiveMessage({
      //   to: phoneNumber,
      //   type: "button",
      //   header: {
      //     text: "Project Details",
      //   },
      //   body: {
      //     text: detailsText,
      //   },
      //   footer: {
      //     text: "Powered by ShikshaLokam",
      //   },
      //   action: {
      //     buttons: [
      //       {
      //         type: "quick_reply",
      //         title: "Update_Task",
      //         id: "update_task",
      //       },
      //       {
      //         type: "quick_reply",
      //         title: "⬅️ Back to List",
      //         id: "back_to_list",
      //       },
      //       {
      //         type: "quick_reply",
      //         title: "🏠 Main Menu",
      //         id: "main_menu",
      //       },
      //     ],
      //   },
      // });

      if (projectType === "solutionWithoutProject") {
        await whatsappService.sendInteractiveMessage({
          to: phoneNumber,
          type: "button",
          header: {
            text: "Project Details",
          },
          body: {
            text: detailsText,
          },
          footer: {
            text: "Powered by ShikshaLokam",
          },
          action: {
            buttons: [
              {
                type: "quick_reply",
                title: "🚀 Start Improvement Project",
                id: `start_improvement_${projectId}`,
              },
              {
                type: "quick_reply",
                title: "⬅️ Back to List",
                id: "back_to_list",
              },
              {
                type: "quick_reply",
                title: "🏠 Main Menu",
                id: "main_menu",
              },
            ],
          },
        });
      } else {
        await this.syncProjectToDB(project, phoneNumber, 1);
        // For solutionWithProject, show normal buttons with task viewing
        // await whatsappService.sendInteractiveMessage({
        //   to: phoneNumber,
        //   type: "button",
        //   header: {
        //     text: "Project Details",
        //   },
        //   body: {
        //     text: detailsText,
        //   },
        //   footer: {
        //     text: "Powered by ShikshaLokam",
        //   },
        //   action: {
        //     buttons: [
        //       {
        //         type: "quick_reply",
        //         title: "📋 View Tasks",
        //         id: `view_tasks_${projectId}`,
        //       },
        //       {
        //         type: "quick_reply",
        //         title: "✏️ Update Task",
        //         id: `update_task_${projectId}`,
        //       },
        //       {
        //         type: "quick_reply",
        //         title: "⬅️ Back to List",
        //         id: "back_to_list",
        //       },
        //     ],
        //   },
        // });
        const projectStatus = project.status?.toLowerCase();

        // Build buttons based on project status
        const buttons = [];

        // For active/in-progress projects
        if (projectStatus !== "submitted" && projectStatus !== "completed") {
          buttons.push(
            {
              type: "quick_reply",
              title: "📋 View Tasks",
              id: `view_tasks_${projectId}`,
            },
            {
              type: "quick_reply",
              title: "✏️ Update Task",
              id: `update_task_${projectId}`,
            }
          );
        }

        // For submitted projects - show report button
        if (projectStatus === "submitted") {
          buttons.push({
            type: "quick_reply",
            title: "📊 View Report",
            id: `view_report_${projectId}`,
          });
        }

        // For completed projects - show both report and certificate
        if (projectStatus === "completed") {
          buttons.push(
            {
              type: "quick_reply",
              title: "📊 View Report",
              id: `view_report_${projectId}`,
            },
            {
              type: "quick_reply",
              title: "🏆 View Certificate",
              id: `view_certificate_${projectId}`,
            }
          );
        }

        // Always add back button
        buttons.push({
          type: "quick_reply",
          title: "⬅️ Back to List",
          id: "back_to_list",
        });

        // Limit to 3 buttons max for WhatsApp
        const displayButtons = buttons.slice(0, 3);

        await whatsappService.sendInteractiveMessage({
          to: phoneNumber,
          type: "button",
          header: { text: "Project Details" },
          body: { text: detailsText },
          footer: { text: "Powered by ShikshaLokam" },
          action: { buttons: displayButtons },
        });
      }
      Logger.info("Project details shown", { phoneNumber, projectId });
    } catch (error) {
      Logger.error("Error showing project details", error);

      await whatsappService.sendMessage(
        phoneNumber,
        "❌ Something went wrong. Showing your projects again..."
      );

      await this.listProjects(phoneNumber, 1);
      await usersQueries.clearLastMessage(phoneNumber);
    }
  }

  // Helper method to handle back to list action
  async handleBackToList(phoneNumber) {
    try {
      await usersQueries.clearLastMessage(phoneNumber);
      await this.listProjects(phoneNumber, 1);
    } catch (error) {
      Logger.error("Error going back to list", error);
      await whatsappService.sendMessage(
        phoneNumber,
        "❌ Failed to load projects list."
      );
    }
  }

  /**
   * Handle project creation flow steps
   */
  async handleProjectCreationFlow(phoneNumber, messageText, lastMessage) {
    try {
      const step = lastMessage.step || 1;
      const context = lastMessage.context || {};

      Logger.info("Project creation flow", { phoneNumber, step, messageText });

      switch (step) {
        case 1: // Received project name
          context.projectName = messageText.trim();

          await usersQueries.updateLastMessage(phoneNumber, {
            flow: "project_creation",
            step: 2, // Ask for description
            context,
            text: messageText,
          });

          await whatsappService.sendMessage(
            phoneNumber,
            `✅ Great! Project name: *${context.projectName}*\n\n` +
              "Now, please provide a *description* for your project:"
          );
          break;

        case 2: // Received description
          context.projectDescription = messageText.trim();

          await usersQueries.updateLastMessage(phoneNumber, {
            flow: "project_creation",
            step: 3, // Ask for start date
            context,
            text: messageText,
          });

          await whatsappService.sendMessage(
            phoneNumber,
            "📅 When does the project start?\n\n" +
              "Please provide the date in format: *DD/MM/YYYY*\n" +
              "Example: 15/12/2024"
          );
          break;

        case 3: // Received start date
          // Validate date format
          if (!/^\d{2}\/\d{2}\/\d{4}$/.test(messageText)) {
            await whatsappService.sendMessage(
              phoneNumber,
              "❌ Invalid date format. Please use *DD/MM/YYYY*\n" +
                "Example: 15/12/2024"
            );
            return;
          }

          context.startDate = messageText.trim();

          await usersQueries.updateLastMessage(phoneNumber, {
            flow: "project_creation",
            step: 4, // Confirmation
            context,
            text: messageText,
          });

          // Show confirmation
          await whatsappService.sendInteractiveMessage({
            to: phoneNumber,
            type: "button",
            body: {
              text:
                "📋 *Project Summary*\n\n" +
                `*Name:* ${context.projectName}\n` +
                `*Description:* ${context.projectDescription}\n` +
                `*Start Date:* ${context.startDate}\n\n` +
                "Is this correct?",
            },
            action: {
              buttons: [
                {
                  type: "reply",
                  reply: { id: "confirm_project", title: "✅ Confirm" },
                },
                {
                  type: "reply",
                  reply: { id: "cancel_project", title: "❌ Cancel" },
                },
              ],
            },
          });
          break;

        default:
          Logger.warn("Unknown project creation step", { step });
          await usersQueries.clearLastMessage(phoneNumber);
          break;
      }
    } catch (error) {
      Logger.error("Error in project creation flow", error);
      await usersQueries.clearLastMessage(phoneNumber);
      throw error;
    }
  }

  /**
   * List user's projects with pagination
   */
  /**
   * List user's projects with pagination
   */
  async listProjects(phoneNumber, page = 1) {
    try {
      const url = `${this.apiBaseUrl}/project/v1/solutions/targetedSolutions?type=improvementProject&page=1&limit=30&filter=assignedToMe`;
      const response = await makeApiRequest(
        "POST",
        url,
        process.env.ELEVATE_AUTH_TOKEN ??
          "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJkYXRhIjp7ImlkIjoxNzU4LCJuYW1lIjoic2wgZWxlZm8iLCJzZXNzaW9uX2lkIjoyMjYzNiwib3JnYW5pemF0aW9uX2lkcyI6WyIzMyJdLCJvcmdhbml6YXRpb25fY29kZXMiOlsidGFuOTAiXSwidGVuYW50X2NvZGUiOiJzaGlrc2hhbG9rYW0iLCJvcmdhbml6YXRpb25zIjpbeyJpZCI6MzMsIm5hbWUiOiJ0YW45MCIsImNvZGUiOiJ0YW45MCIsImRlc2NyaXB0aW9uIjoiVGFuOTAgc3BlY2lhbGl6ZXMgaW4gcHJvdmlkaW5nIGVkdWNhdGlvbmFsIFNURUFNIiwic3RhdHVzIjoiQUNUSVZFIiwicmVsYXRlZF9vcmdzIjpbMzRdLCJ0ZW5hbnRfY29kZSI6InNoaWtzaGFsb2thbSIsIm1ldGEiOm51bGwsImNyZWF0ZWRfYnkiOjEsInVwZGF0ZWRfYnkiOjE3MDksInJvbGVzIjpbeyJpZCI6MjMsInRpdGxlIjoibWVudGVlIiwibGFiZWwiOiJtZW50ZWUiLCJ1c2VyX3R5cGUiOjAsInN0YXR1cyI6IkFDVElWRSIsIm9yZ2FuaXphdGlvbl9pZCI6MTAsInZpc2liaWxpdHkiOiJQVUJMSUMiLCJ0ZW5hbnRfY29kZSI6InNoaWtzaGFsb2thbSIsInRyYW5zbGF0aW9ucyI6bnVsbH1dfV19LCJpYXQiOjE3NjMwMjEyMjcsImV4cCI6MTc2MzEwNzYyN30.sn2EVlhcpfEJOnbnOOjGSmKjzNFCsN0MEqgE8z2MSoI",
          {
            state: "6863a9941d52e30014093ad9",
            district: "6863aa5f1d52e30014093b48",
            block: "6863aaad1d52e30014093b8e",
            cluster: "6863ab011d52e30014093d27",
            school: "68650f6f633ad100153fdb4c",
            professional_role: "6867add70d8d24001465c3e4",
            professional_subroles:
              "6867b0530d8d24001465c409,6867b0530d8d24001465c40b,6867b0530d8d24001465c40d,6867b0530d8d24001465c40f,6867b0530d8d24001465c411,6867b0530d8d24001465c413,6867b0530d8d24001465c415,6867b0530d8d24001465c417,6867b0530d8d24001465c419,6867b0530d8d24001465c41b,6867b0530d8d24001465c41d,6867b0530d8d24001465c41f,6867b0530d8d24001465c421,6867b0530d8d24001465c423,6867b0530d8d24001465c425,6867b0530d8d24001465c427,6867b0530d8d24001465c429,6867b0530d8d24001465c42b,6867b0530d8d24001465c42d,6867b0530d8d24001465c42f,6867b0530d8d24001465c431,6867b0530d8d24001465c433,6867b0530d8d24001465c435,6867b0530d8d24001465c437,6867b0530d8d24001465c439,6867b0530d8d24001465c43b,6867b0530d8d24001465c43d,6867b0530d8d24001465c43f,6867b0530d8d24001465c441,6867b0530d8d24001465c443,6867b0530d8d24001465c445,6867b0530d8d24001465c447,6867b0530d8d24001465c449,6867b0530d8d24001465c44b",
            organizations: "[object Object]",
          }
      );

      const projects = response?.data?.result?.data;
      console.log("this is projects", projects);
      const itemsPerPage = 10;
      const totalPages = Math.ceil(projects.length / itemsPerPage);
      const start = (page - 1) * itemsPerPage;
      const paginatedProjects = projects.slice(start, start + itemsPerPage);

      if (paginatedProjects.length === 0) {
        await whatsappService.sendMessage(
          phoneNumber,
          "📂 You don't have any projects yet.\n\n" +
            "Would you like to create one?"
        );
        await usersQueries.clearLastMessage(phoneNumber);
        return;
      }

      // Create a mapping of projectId to full project data (including solutionId)
      const projectMap = {};
      const listItems = paginatedProjects.map((project) => {
        // Determine if this is a project with solution or solution without project
        const hasProjectId = project?._id && project._id.trim() !== "";
        const projectId = hasProjectId ? project._id : project?.solutionId;

        // Determine the type for endpoint routing
        const type = hasProjectId
          ? "solutionWithProject"
          : "solutionWithoutProject";

        // Store the full project data for later retrieval
        projectMap[`${type}_${projectId}`] = {
          projectId: project._id,
          solutionId: project.solutionId,
          name: project.name,
          description: project.description,
          type, // Store type for routing
        };

        return {
          id: `${type}_${projectId}`,
          title: project.name,
          description: `Status: ${project.description}`,
        };
      });
      console.log(projectMap, "this is mapin listing");
      // Set flow state with project mapping stored in context
      await usersQueries.updateLastMessage(phoneNumber, {
        flow: "project_browse",
        step: 1,
        // context: {
        //   page,
        //   action: "list",
        //   totalPages,
        //   projectMap, // Store the entire project mapping
        // },
        text: "list_projects",
      });

      // Add pagination buttons if needed
      const buttons = [];
      if (page > 1) {
        buttons.push({
          type: "reply",
          reply: { id: `prev_page_${page - 1}`, title: "⬅️ Previous" },
        });
      }
      if (page < totalPages) {
        buttons.push({
          type: "reply",
          reply: { id: `next_page_${page + 1}`, title: "Next ➡️" },
        });
      }

      // Create list payload
      const listPayload = {
        to: `${phoneNumber}@s.whatsapp.net`,
        type: "list",
        header: { text: "Available Projects" },
        body: {
          text: `📋 *Your Projects* (Page ${page}/${totalPages})\n\nSelect a project to view or update:`,
        },
        footer: { text: "Powered by ShikshaLokam" },
        action: {
          list: {
            label: "View Projects",
            sections: [
              {
                title: "Projects",
                rows: listItems,
              },
            ],
          },
        },
      };

      await whatsappService.sendInteractiveMessage(listPayload);

      // Send pagination buttons separately if needed
      if (buttons.length > 0) {
        await whatsappService.sendInteractiveMessage({
          to: phoneNumber,
          type: "button",
          body: { text: "Navigate pages:" },
          action: { buttons },
        });
      }

      Logger.info("Listed projects", { phoneNumber, page, totalPages });
    } catch (error) {
      Logger.error("Error listing projects", error);
      throw error;
    }
  }

  /**
   * Search for projects by name
   * Returns project details if single match, or list if multiple matches
   */
  async searchProjectByName(phoneNumber, projectName) {
    try {
      Logger.info("Searching for project by name", {
        phoneNumber,
        projectName,
      });

      // Call the API with search parameter
      const url = `${
        this.apiBaseUrl
      }/project/v1/solutions/targetedSolutions?type=improvementProject&page=1&limit=10&filter=assignedToMe&search=${encodeURIComponent(
        projectName
      )}`;

      const response = await makeApiRequest(
        "POST",
        url,
        process.env.ELEVATE_AUTH_TOKEN,
        {
          state: "6863a9941d52e30014093ad9",
          district: "6863aa5f1d52e30014093b48",
          block: "6863aaad1d52e30014093b8e",
          cluster: "6863ab011d52e30014093d27",
          school: "68650f6f633ad100153fdb4c",
          professional_role: "6867add70d8d24001465c3e4",
          professional_subroles:
            "6867b0530d8d24001465c409,6867b0530d8d24001465c40b,6867b0530d8d24001465c40d,6867b0530d8d24001465c40f,6867b0530d8d24001465c411,6867b0530d8d24001465c413,6867b0530d8d24001465c415,6867b0530d8d24001465c417,6867b0530d8d24001465c419,6867b0530d8d24001465c41b,6867b0530d8d24001465c41d,6867b0530d8d24001465c41f,6867b0530d8d24001465c421,6867b0530d8d24001465c423,6867b0530d8d24001465c425,6867b0530d8d24001465c427,6867b0530d8d24001465c429,6867b0530d8d24001465c42b,6867b0530d8d24001465c42d,6867b0530d8d24001465c42f,6867b0530d8d24001465c431,6867b0530d8d24001465c433,6867b0530d8d24001465c435,6867b0530d8d24001465c437,6867b0530d8d24001465c439,6867b0530d8d24001465c43b,6867b0530d8d24001465c43d,6867b0530d8d24001465c43f,6867b0530d8d24001465c441,6867b0530d8d24001465c443,6867b0530d8d24001465c445,6867b0530d8d24001465c447,6867b0530d8d24001465c449,6867b0530d8d24001465c44b",
          organizations: "[object Object]",
        }
      );

      const projects = response?.data?.result?.data || [];

      Logger.info("Search results", {
        phoneNumber,
        projectName,
        matchCount: projects.length,
      });

      // No projects found
      if (projects.length === 0) {
        await whatsappService.sendMessage(
          phoneNumber,
          `❌ No project found with name: "${projectName}"\n\n` +
            `Please check the spelling or try "list projects" to see all your projects.`
        );

        return {
          success: false,
          message: "No projects found",
        };
      }

      // Single project found - show details directly
      if (projects.length === 1) {
        const project = projects[0];
        const hasProjectId = project?._id && project._id.trim() !== "";
        const projectId = hasProjectId ? project._id : null;
        const solutionId = project.solutionId;
        const projectType = hasProjectId
          ? "solutionWithProject"
          : "solutionWithoutProject";

        Logger.info("Single project found, showing details", {
          phoneNumber,
          projectId,
          solutionId,
          projectType,
        });

        // Update flow state
        await usersQueries.updateLastMessage(phoneNumber, {
          flow: "project_detail",
          step: 0,
          context: { projectId, solutionId, project },
          text: `view_project_${projectId || solutionId}`,
        });

        // Show project details
        await this.showProjectDetailsFromData(
          phoneNumber,
          project,
          projectType,
          projectId,
          solutionId
        );

        return {
          success: true,
          projectFound: true,
          projectId,
          solutionId,
          projectType,
        };
      }

      // Multiple projects found - show selection list
      Logger.info("Multiple projects found, showing selection list", {
        phoneNumber,
        matchCount: projects.length,
      });

      await this.showProjectSelectionList(phoneNumber, projects, projectName);

      return {
        success: true,
        multipleMatches: true,
        matchCount: projects.length,
      };
    } catch (error) {
      Logger.error("Error searching project by name", error);

      await whatsappService.sendMessage(
        phoneNumber,
        "❌ Failed to search for project. Please try again."
      );

      throw error;
    }
  }

  /**
   * Show project details from already fetched data
   * (Extracted from showProjectDetails to avoid duplicate API call)
   */
  async showProjectDetailsFromData(
    phoneNumber,
    project,
    projectType,
    projectId,
    solutionId
  ) {
    try {
      // Fetch full details if needed
      let fullProject = project;

      // If we only have basic info, fetch full details
      // if (!project.description || !project.status) {
      const url =
        projectType === "solutionWithProject"
          ? `${this.apiBaseUrl}/project/v1/userProjects/details/${projectId}`
          : `${this.apiBaseUrl}/project/v1/solutions/details/${solutionId}`;

      const response = await makeApiRequest(
        "POST",
        url,
        process.env.ELEVATE_AUTH_TOKEN,
        {
          state: "6863a9941d52e30014093ad9",
          district: "6863aa5f1d52e30014093b48",
          block: "6863aaad1d52e30014093b8e",
          cluster: "6863ab011d52e30014093d27",
          school: "68650f6f633ad100153fdb4c",
          professional_role: "6867add70d8d24001465c3e4",
          professional_subroles:
            "6867b0530d8d24001465c409,6867b0530d8d24001465c40b,6867b0530d8d24001465c40d,6867b0530d8d24001465c40f,6867b0530d8d24001465c411,6867b0530d8d24001465c413,6867b0530d8d24001465c415,6867b0530d8d24001465c417,6867b0530d8d24001465c419,6867b0530d8d24001465c41b,6867b0530d8d24001465c41d,6867b0530d8d24001465c41f,6867b0530d8d24001465c421,6867b0530d8d24001465c423,6867b0530d8d24001465c425,6867b0530d8d24001465c427,6867b0530d8d24001465c429,6867b0530d8d24001465c42b,6867b0530d8d24001465c42d,6867b0530d8d24001465c42f,6867b0530d8d24001465c431,6867b0530d8d24001465c433,6867b0530d8d24001465c435,6867b0530d8d24001465c437,6867b0530d8d24001465c439,6867b0530d8d24001465c43b,6867b0530d8d24001465c43d,6867b0530d8d24001465c43f,6867b0530d8d24001465c441,6867b0530d8d24001465c443,6867b0530d8d24001465c445,6867b0530d8d24001465c447,6867b0530d8d24001465c449,6867b0530d8d24001465c44b",
          organizations: "[object Object]",
        }
      );

      fullProject = response?.data?.result || response?.data || project;
      // }

      // Sync to DB if it's a solutionWithProject
      if (projectType === "solutionWithProject") {
        await this.syncProjectToDB(fullProject, phoneNumber, 1);
      }

      // Format project details message
      const detailsText =
        `*📁 ${fullProject.title ?? fullProject.name}*\n\n` +
        `${fullProject.description ? `${fullProject.description}\n\n` : ""}` +
        `*Duration:* ${fullProject.duration || "N/A"}\n` +
        `*Status:* ${fullProject.status || "Unknown"}\n` +
        `\nWhat would you like to do?`;

      const projectStatus = fullProject.status?.toLowerCase();

      // Build buttons based on project type and status
      const buttons = [];

      if (projectType === "solutionWithoutProject") {
        // For solutions without project - show start project button
        buttons.push(
          {
            type: "quick_reply",
            title: "🚀 Start Project",
            id: `start_improvement_${projectId || solutionId}`,
          },
          {
            type: "quick_reply",
            title: "⬅️ Back to List",
            id: "back_to_list",
          }
        );
      } else {
        // For active/in-progress projects
        if (projectStatus !== "submitted" && projectStatus !== "completed") {
          buttons.push(
            {
              type: "quick_reply",
              title: "📋 View Tasks",
              id: `view_tasks_${projectId}`,
            },
            {
              type: "quick_reply",
              title: "✏️ Update Task",
              id: `update_task_${projectId}`,
            }
          );
        }

        // For submitted projects - show report button
        if (projectStatus === "submitted") {
          buttons.push({
            type: "quick_reply",
            title: "📊 View Report",
            id: `view_report_${projectId}`,
          });
        }

        // For completed projects - show both report and certificate
        if (projectStatus === "completed") {
          buttons.push(
            {
              type: "quick_reply",
              title: "📊 View Report",
              id: `view_report_${projectId}`,
            },
            {
              type: "quick_reply",
              title: "🏆 View Certificate",
              id: `view_certificate_${projectId}`,
            }
          );
        }

        // Always add back button
        buttons.push({
          type: "quick_reply",
          title: "⬅️ Back to List",
          id: "back_to_list",
        });
      }

      // Limit to 3 buttons max for WhatsApp
      const displayButtons = buttons.slice(0, 3);

      await whatsappService.sendInteractiveMessage({
        to: phoneNumber,
        type: "button",
        header: { text: "Project Details" },
        body: { text: detailsText },
        footer: { text: "Powered by ShikshaLokam" },
        action: { buttons: displayButtons },
      });

      Logger.info("Project details shown from search", {
        phoneNumber,
        projectId,
        solutionId,
      });
    } catch (error) {
      Logger.error("Error showing project details from data", error);
      throw error;
    }
  }

  /**
   * Show project selection list when multiple matches found
   */
  async showProjectSelectionList(phoneNumber, projects, searchTerm) {
    try {
      Logger.info("Showing project selection list", {
        phoneNumber,
        projectCount: projects.length,
      });

      // Create list items from search results
      const listItems = projects.map((project) => {
        const hasProjectId = project?._id && project._id.trim() !== "";
        const projectId = hasProjectId ? project._id : project?.solutionId;
        const type = hasProjectId
          ? "solutionWithProject"
          : "solutionWithoutProject";

        return {
          id: `${type}_${projectId}`,
          title: project.name,
          description: `Status: ${project.status || "Not Started"}`,
        };
      });

      // Update flow state
      await usersQueries.updateLastMessage(phoneNumber, {
        flow: "project_browse",
        step: 1,
        context: {
          searchTerm,
          action: "search_results",
        },
        text: `search_results_${searchTerm}`,
      });

      // Send interactive list
      const listPayload = {
        to: `${phoneNumber}@s.whatsapp.net`,
        type: "list",
        header: { text: "Multiple Projects Found" },
        body: {
          text: `🔍 Found ${projects.length} projects matching "${searchTerm}"\n\nSelect the project you want to view:`,
        },
        footer: { text: "Powered by ShikshaLokam" },
        action: {
          list: {
            label: "Select Project",
            sections: [
              {
                title: "Matching Projects",
                rows: listItems,
              },
            ],
          },
        },
      };

      await whatsappService.sendInteractiveMessage(listPayload);

      Logger.info("Project selection list sent", {
        phoneNumber,
        projectCount: projects.length,
      });
    } catch (error) {
      Logger.error("Error showing project selection list", error);
      throw error;
    }
  }

  /**
   * Handle project update flow
   */
  async handleProjectUpdateFlow(phoneNumber, messageText, lastMessage) {
    try {
      const step = lastMessage.step || 1;
      const context = lastMessage.context || {};

      Logger.info("Project update flow", { phoneNumber, step });

      // Add your project update logic here
      // Similar to creation flow but for updating existing projects
    } catch (error) {
      Logger.error("Error in project update flow", error);
      throw error;
    }
  }

  /**
   * Handle interactive responses (pagination, confirmations)
   */
  async handleInteractiveResponse(phoneNumber, action) {
    try {
      Logger.info("Handling interactive response", { phoneNumber, action });

      // Handle project confirmation
      if (action === "confirm_project") {
        const lastMessage = await usersQueries.getLastMessage(phoneNumber);
        const projectData = lastMessage.context;

        // TODO: Save project to database
        Logger.info("Saving project", { phoneNumber, projectData });

        await whatsappService.sendMessage(
          phoneNumber,
          "🎉 *Project created successfully!*\n\n" +
            `Project: ${projectData.projectName}\n\n` +
            "What would you like to do next?"
        );

        // Clear flow state
        await usersQueries.clearLastMessage(phoneNumber);
        return;
      }

      if (action === "cancel_project") {
        await usersQueries.clearLastMessage(phoneNumber);
        await whatsappService.sendMessage(
          phoneNumber,
          "❌ Project creation cancelled."
        );
        return;
      }

      // Handle pagination
      if (/^next_page_(\d+)$/.test(action)) {
        const page = parseInt(action.match(/\d+/)[0]);
        await this.listProjects(phoneNumber, page);
        return;
      }

      if (/^prev_page_(\d+)$/.test(action)) {
        const page = parseInt(action.match(/\d+/)[0]);
        await this.listProjects(phoneNumber, page);
        return;
      }

      // Handle project selection
      if (/^project_(\d+)$/.test(action)) {
        const projectId = action.match(/\d+/)[0];
        Logger.info("Project selected", { phoneNumber, projectId });

        // TODO: Load project details and start update flow
        await whatsappService.sendMessage(
          phoneNumber,
          `📂 Loading project #${projectId}...`
        );
      }
    } catch (error) {
      Logger.error("Error handling interactive response", error);
      throw error;
    }
  }

  // ============================================
  // ADD: Handle Start Improvement Project
  // ============================================

  /**
   * Handle start improvement project flow (for solutionWithoutProject)
   */
  async handleStartImprovementProject(phoneNumber, solutionId, projectData) {
    try {
      Logger.info("Starting improvement project", {
        phoneNumber,
        solutionId,
      });

      // Call details endpoint with solutionId and templateId (external_id)
      const templateId = projectData.externalId; // From the response

      const url = `${this.apiBaseUrl}/project/v1/userProjects/details?solutionId=${solutionId}&templateId=${templateId}`;

      Logger.info("Fetching improvement project details", {
        phoneNumber,
        url,
      });

      const response = await makeApiRequest(
        "POST",
        url,
        process.env.ELEVATE_AUTH_TOKEN,
        {
          state: "6863a9941d52e30014093ad9",
          district: "6863aa5f1d52e30014093b48",
          block: "6863aaad1d52e30014093b8e",
          cluster: "6863ab011d52e30014093d27",
          school: "68650f6f633ad100153fdb4c",
          professional_role: "6867add70d8d24001465c3e4",
          professional_subroles:
            "6867b0530d8d24001465c409,6867b0530d8d24001465c40b,6867b0530d8d24001465c40d,6867b0530d8d24001465c40f,6867b0530d8d24001465c411,6867b0530d8d24001465c413,6867b0530d8d24001465c415,6867b0530d8d24001465c417,6867b0530d8d24001465c419,6867b0530d8d24001465c41b,6867b0530d8d24001465c41d,6867b0530d8d24001465c41f,6867b0530d8d24001465c421,6867b0530d8d24001465c423,6867b0530d8d24001465c425,6867b0530d8d24001465c427,6867b0530d8d24001465c429,6867b0530d8d24001465c42b,6867b0530d8d24001465c42d,6867b0530d8d24001465c42f,6867b0530d8d24001465c431,6867b0530d8d24001465c433,6867b0530d8d24001465c435,6867b0530d8d24001465c437,6867b0530d8d24001465c439,6867b0530d8d24001465c43b,6867b0530d8d24001465c43d,6867b0530d8d24001465c43f,6867b0530d8d24001465c441,6867b0530d8d24001465c443,6867b0530d8d24001465c445,6867b0530d8d24001465c447,6867b0530d8d24001465c449,6867b0530d8d24001465c44b",
          organizations: "[object Object]",
        }
      );

      if (!response.success) {
        throw new Error("Failed to fetch improvement project details");
      }

      const improvementProject = response.data.result;

      Logger.info("Improvement project details fetched", {
        phoneNumber,
        taskCount: improvementProject.tasks?.length || 0,
      });

      await this.syncProjectToDB(improvementProject, phoneNumber, 1);

      // Store project data and show tasks
      await usersQueries.updateLastMessage(phoneNumber, {
        flow: "improvement_project",
        step: 0,
        context: {
          projectData: improvementProject,
          solutionId,
          templateId,
        },
        text: "view_improvement_project",
      });

      // Show tasks menu
      await taskService.showTasksMenu(phoneNumber, improvementProject);
    } catch (error) {
      Logger.error("Error starting improvement project", error);
      await whatsappService.sendMessage(
        phoneNumber,
        "❌ Error loading improvement project. Please try again."
      );
    }
  }
  async handleProjectPagination(phoneNumber, action) {
    try {
      Logger.info("Handling project pagination", { phoneNumber, action });

      let page = 1;

      if (action.startsWith("next_projects_")) {
        page = parseInt(action.replace("next_projects_", ""));
      } else if (action.startsWith("prev_projects_")) {
        page = parseInt(action.replace("prev_projects_", ""));
      }

      if (isNaN(page) || page < 1) page = 1;

      // Fetch next/previous page
      await this.listProjects(phoneNumber, page);
    } catch (error) {
      Logger.error("Error handling project pagination", error);
      await whatsappService.sendMessage(
        phoneNumber,
        "❌ Error loading projects. Please try again."
      );
    }
  }
  async syncProjectToDB(projectData, userPhone, userId) {
    const projectId = projectData._id;

    // Map tasks including type in storage ⚡
    const mappedTasks = (projectData.tasks || []).map((task) => ({
      taskId: task.referenceId || task._id,
      taskName: task.name,
      type: task.type || "simple", // 👈 Store type also
      status: task.status || "notStarted",
      endDate: task.updatedAt ? new Date(task.updatedAt) : null,
      evidence: [],
    }));

    const payload = {
      projectId,
      projectName: projectData.title,
      solutionId: projectData.solutionId,
      programId: projectData.programId,
      phoneNumber: userPhone,
      userId: userId,
      projectData: {
        status: projectData.status,
        description: projectData.description,
        duration: projectData.duration,
        syncedAt: projectData.syncedAt,
      },
      tasks: mappedTasks,
      submissionStatus:
        projectData.status === "submitted" ? "submitted" : "draft",
      submittedAt: projectData.completedDate || null,
    };

    // 🔍 Check if project exists for user

    let result = await Project.findOne({ projectId, userId });

    if (!result) {
      result = await Project.create(payload);
    }

    return result;
  }

  // Update these methods in projectService.js

  /**
   * Generate and send project report
   */
  async generateProjectReport(phoneNumber, projectId) {
    try {
      Logger.info("Generating project report", { phoneNumber, projectId });

      const url = `${this.apiBaseUrl}/project/v1/userProjects/share/${projectId}`;

      const response = await makeApiRequest(
        "GET",
        url,
        process.env.ELEVATE_AUTH_TOKEN
      );
      console.log(response, "this is res");
      if (!response.success || !response.data?.result?.downloadUrl) {
        throw new Error("Failed to generate report");
      }

      const reportUrl = response.data.result.downloadUrl;

      Logger.info("Report generated successfully", { phoneNumber, reportUrl });

      // Send PDF document via WhatsApp using existing sendMediaMessage
      await whatsappService.sendMediaMessage(
        phoneNumber,
        "document",
        reportUrl,
        "📊 *Your Project Report*\n\nHere is your detailed project report."
      );

      // Send success message with option to go back
      await whatsappService.sendInteractiveMessage({
        to: phoneNumber,
        type: "button",
        body: {
          text: "✅ Report sent successfully!\n\nWhat would you like to do next?",
        },
        action: {
          buttons: [
            {
              type: "quick_reply",
              title: "⬅️ Back to Project",
              id: `back_to_project_${projectId}`,
            },
            {
              type: "quick_reply",
              title: "📋 My Projects",
              id: "back_to_list",
            },
            {
              type: "quick_reply",
              title: "🏠 Main Menu",
              id: "main_menu",
            },
          ],
        },
      });

      Logger.info("Report sent successfully", { phoneNumber, projectId });
    } catch (error) {
      Logger.error("Error generating project report", error);
      await whatsappService.sendMessage(
        phoneNumber,
        "❌ Failed to generate report. Please try again later."
      );
    }
  }

  /**
   * Show certificate options (PDF or SVG)
   */
  async showCertificateOptions(phoneNumber, project) {
    try {
      Logger.info("Showing certificate options", {
        phoneNumber,
        projectId: project._id,
      });

      const certificate = project.certificate;

      if (!certificate || !certificate.pdfUrl || !certificate.svgUrl) {
        await whatsappService.sendMessage(
          phoneNumber,
          "❌ Certificate not available for this project."
        );
        return;
      }

      // Store certificate URLs in context
      await usersQueries.updateLastMessage(phoneNumber, {
        flow: "certificate_selection",
        step: 1,
        context: {
          projectId: project._id,
          pdfUrl: certificate.pdfUrl,
          svgUrl: certificate.svgUrl,
          project: project,
        },
        text: "select_certificate_format",
      });

      // Send format selection buttons
      await whatsappService.sendInteractiveMessage({
        to: phoneNumber,
        type: "button",
        header: {
          text: "🏆 Certificate Available",
        },
        body: {
          text: "Your certificate is ready!\n\nPlease select your preferred format:",
        },
        footer: {
          text: "Powered by ShikshaLokam",
        },
        action: {
          buttons: [
            {
              type: "quick_reply",
              title: "📄 PDF Format",
              id: `cert_pdf_${project._id}`,
            },
            {
              type: "quick_reply",
              title: "🎨 SVG Format",
              id: `cert_svg_${project._id}`,
            },
            {
              type: "quick_reply",
              title: "⬅️ Back",
              id: `back_to_project_${project._id}`,
            },
          ],
        },
      });

      Logger.info("Certificate options shown", {
        phoneNumber,
        projectId: project._id,
      });
    } catch (error) {
      Logger.error("Error showing certificate options", error);
      await whatsappService.sendMessage(
        phoneNumber,
        "❌ Failed to load certificate options. Please try again."
      );
    }
  }

  /**
   * Send certificate in selected format
   */
  async sendCertificate(phoneNumber, projectId, format) {
    try {
      Logger.info("Sending certificate", { phoneNumber, projectId, format });

      const lastMessage = await usersQueries.getLastMessage(phoneNumber);
      const context = lastMessage?.context || {};

      if (!context.pdfUrl || !context.svgUrl) {
        await whatsappService.sendMessage(
          phoneNumber,
          "❌ Certificate data not found. Please try again."
        );
        return;
      }

      const url = format === "pdf" ? context.pdfUrl : context.svgUrl;
      const caption = `🏆 *Congratulations!*\n\nHere is your project completion certificate in ${format.toUpperCase()} format.`;

      // Determine media type based on format
      const mediaType = format === "pdf" ? "document" : "image"; // SVG will be sent as image

      // Send certificate using existing sendMediaMessage
      await whatsappService.sendMediaMessage(
        phoneNumber,
        mediaType,
        url,
        caption
      );

      // Clear flow state
      await usersQueries.clearLastMessage(phoneNumber);

      // Send success message with navigation
      await whatsappService.sendInteractiveMessage({
        to: phoneNumber,
        type: "button",
        body: {
          text: "✅ Certificate sent successfully!\n\nWhat would you like to do next?",
        },
        action: {
          buttons: [
            {
              type: "quick_reply",
              title: "⬅️ Back to Project",
              id: `back_to_project_${projectId}`,
            },
            {
              type: "quick_reply",
              title: "📋 My Projects",
              id: "back_to_list",
            },
            {
              type: "quick_reply",
              title: "🏠 Main Menu",
              id: "main_menu",
            },
          ],
        },
      });

      Logger.info("Certificate sent successfully", { phoneNumber, format });
    } catch (error) {
      Logger.error("Error sending certificate", error);
      await whatsappService.sendMessage(
        phoneNumber,
        "❌ Failed to send certificate. Please try again later."
      );
    }
  }
}

module.exports = new ProjectService();
