// ============================================
// FILE: services/programService.js
// ============================================
const Logger = require("../utils/logger");
const { makeApiRequest } = require("../generics/services/axios");
const usersQueries = require("../database/databaseQueries/userQueries");
const whatsappService = require("./whatsappService");

const API_BASE_URL =
  process.env.BACKEND_API_URL ?? "https://qa.elevate-apis.shikshalokam.org";
const PROGRAMS_ENDPOINT = "/project/v1/reports/getProgramsByEntity";
const REPORTS_ENDPOINT = "/project/v1/reports/entity";

const REPORT_TYPES = {
  0: "📊 Weekly Report",
  1: "📈 Monthly Report",
  2: "📉 Quarterly Report",
};

class ProgramService {
  /**
   * Show analytics menu - Start the analytics flow
   */
  static async showAnalyticsMenu(phoneNumber) {
    try {
      Logger.info("Showing analytics menu", { phoneNumber });

      await usersQueries.updateLastMessage(phoneNumber, {
        flow: "analytics",
        step: 0,
        context: {},
        text: "view_analytics",
      });

      await whatsappService.sendInteractiveMessage({
        to: phoneNumber,
        type: "button",
        body: {
          text: "📊 *Analytics & Reports*\n\nWhat would you like to do?",
        },
        action: {
          buttons: [
            {
              type: "quick_reply",
              title: "📋 View Program Report",
              id: "view_program_report",
            },
            {
              type: "quick_reply",
              title: "❌ Back to Menu",
              id: "main_menu",
            },
          ],
        },
      });
    } catch (error) {
      Logger.error("Error showing analytics menu", error);
      await whatsappService.sendMessage(
        phoneNumber,
        "❌ Error loading analytics menu. Please try again."
      );
    }
  }

  /**
   * Fetch all programs and show as list
   */
  //   static async listPrograms(phoneNumber) {
  //     try {
  //       Logger.info("Fetching programs list", { phoneNumber });

  //       const url = `${API_BASE_URL}${PROGRAMS_ENDPOINT}?page=1&limit=10&search=`;
  //       console.log(process.env.ELEVATE_AUTH_TOKEN,"before api call")
  //       // Use makeApiRequest helper
  //       const response = await makeApiRequest(
  //         "POST",
  //         url,
  //         process.env.ELEVATE_AUTH_TOKEN,
  //         {}
  //       );

  //       if (!response.success) {
  //         throw new Error(response.error?.message || "Failed to fetch programs");
  //       }

  //       if (!response.data.result || !response.data.result.data) {
  //         throw new Error("Invalid response format from API");
  //       }

  //       const programs = response.data.result.data;

  //       if (programs.length === 0) {
  //         await whatsappService.sendMessage(
  //           phoneNumber,
  //           "📋 No programs available at the moment."
  //         );
  //         return;
  //       }

  //       Logger.info("Programs fetched successfully", {
  //         phoneNumber,
  //         count: programs.length,
  //       });

  //       // Update user flow state
  //       await usersQueries.updateLastMessage(phoneNumber, {
  //         flow: "analytics",
  //         step: 1,
  //         context: {
  //           programs: programs.map((p) => ({ name: p.name, id: p._id })),
  //         },
  //         text: "list_programs",
  //       });

  //       // Build interactive list message with program buttons
  //       const buttons = programs.slice(0, 10).map((program) => ({
  //         type: "quick_reply",
  //         title: program.name.substring(0, 24), // WhatsApp button limit
  //         id: `program_${program._id}`,
  //       }));

  //       await whatsappService.sendInteractiveMessage({
  //         to: phoneNumber,
  //         type: "button",
  //         body: {
  //           text: "📋 *Select a Program*\n\nChoose a program to view its report:",
  //         },
  //         action: {
  //           buttons: buttons,
  //         },
  //       });
  //     } catch (error) {
  //       Logger.error("Error fetching programs", error);
  //       await whatsappService.sendMessage(
  //         phoneNumber,
  //         "❌ Error fetching programs. Please try again."
  //       );
  //       await usersQueries.clearLastMessage(phoneNumber);
  //     }
  //   }

  /**
   * Fetch programs with pagination
   */
  static async listPrograms(phoneNumber, page = 1) {
    try {
      Logger.info("Fetching programs list", { phoneNumber, page });

      const limit = 10;
      const url = `${API_BASE_URL}${PROGRAMS_ENDPOINT}?page=${page}&limit=${limit}&search=`;
      console.log(process.env.ELEVATE_AUTH_TOKEN, "before api call");

      // Use makeApiRequest helper
      const response = await makeApiRequest(
        "POST",
        url,
        process.env.ELEVATE_AUTH_TOKEN,
        {}
      );

      if (!response.success) {
        throw new Error(response.error?.message || "Failed to fetch programs");
      }

      if (!response.data.result || !response.data.result.data) {
        throw new Error("Invalid response format from API");
      }

      const programs = response.data.result.data;
      const totalCount = response.data.result.count || 0;
      const totalPages = Math.ceil(totalCount / limit);

      if (programs.length === 0) {
        await whatsappService.sendMessage(
          phoneNumber,
          "📋 No programs available at the moment."
        );
        return;
      }

      Logger.info("Programs fetched successfully", {
        phoneNumber,
        count: programs.length,
        totalCount,
        totalPages,
        currentPage: page,
      });

      // Update user flow state with pagination info
      await usersQueries.updateLastMessage(phoneNumber, {
        flow: "analytics",
        step: 1,
        context: {
          programs: programs.map((p) => ({ name: p.name, id: p._id })),
          totalCount,
          totalPages,
          currentPage: page,
        },
        text: "list_programs",
      });

      // Build interactive list message with program buttons
      const buttons = programs.slice(0, 9).map((program) => ({
        type: "quick_reply",
        title: program.name.substring(0, 20), // WhatsApp button limit
        id: `program_${program._id}`,
      }));

      // Add pagination button if there are more pages
      if (totalPages > 1) {
        if (page < totalPages) {
          buttons.push({
            type: "quick_reply",
            title: `📄 Next (${page}/${totalPages})`,
            id: `next_programs_${page + 1}`,
          });
        }

        if (page > 1) {
          buttons.push({
            type: "quick_reply",
            title: `⬅️ Previous (${page}/${totalPages})`,
            id: `prev_programs_${page - 1}`,
          });
        }
      }

      // If only one button slot left and we have pagination, show only pagination
      if (buttons.length > 10) {
        buttons.pop(); // Remove last button to stay within limit
      }

      const pageInfo =
        totalPages > 1 ? `\n\n*Page ${page} of ${totalPages}*` : "";

      await whatsappService.sendInteractiveMessage({
        to: phoneNumber,
        type: "button",
        body: {
          text: `📋 *Select a Program*\n\nChoose a program to view its report:${pageInfo}`,
        },
        action: {
          buttons: buttons,
        },
      });
    } catch (error) {
      Logger.error("Error fetching programs", error);
      await whatsappService.sendMessage(
        phoneNumber,
        "❌ Error fetching programs. Please try again."
      );
      await usersQueries.clearLastMessage(phoneNumber);
    }
  }

  /**
   * Handle pagination navigation (next/previous)
   */
  static async handleProgramPagination(phoneNumber, action) {
    try {
      Logger.info("Handling program pagination", { phoneNumber, action });

      let page = 1;

      // Extract page number from action (e.g., "next_programs_2" or "prev_programs_1")
      if (action.startsWith("next_programs_")) {
        page = parseInt(action.replace("next_programs_", ""));
      } else if (action.startsWith("prev_programs_")) {
        page = parseInt(action.replace("prev_programs_", ""));
      }

      if (isNaN(page) || page < 1) {
        page = 1;
      }

      // Fetch the next/previous page
      await this.listPrograms(phoneNumber, page);
    } catch (error) {
      Logger.error("Error handling program pagination", error);
      await whatsappService.sendMessage(
        phoneNumber,
        "❌ Error loading page. Please try again."
      );
    }
  }

  /**
   * Handle program selection and show report type options
   */
  static async handleProgramSelection(phoneNumber, programId, message) {
    try {
      const lastMessage = await usersQueries.getLastMessage(phoneNumber);
      const programs = lastMessage?.context?.programs || [];
      const selectedProgram = programs.find((p) => p.id === programId);

      if (!selectedProgram) {
        await whatsappService.sendMessage(
          phoneNumber,
          "❌ Program not found. Please select again."
        );
        return;
      }

      Logger.info("Program selected", {
        phoneNumber,
        programId,
        name: selectedProgram.name,
      });

      // Update user flow state with selected program
      await usersQueries.updateLastMessage(phoneNumber, {
        flow: "analytics",
        step: 2,
        context: {
          programs,
          selectedProgramId: programId,
          selectedProgramName: selectedProgram.name,
        },
        text: "program_selected",
      });

      // Show report type options
      await whatsappService.sendInteractiveMessage({
        to: phoneNumber,
        type: "button",
        body: {
          text: `📊 *${selectedProgram.name}*\n\nSelect report type:`,
        },
        action: {
          buttons: [
            {
              type: "quick_reply",
              title: "📊 Weekly",
              id: "report_type_0",
            },
            {
              type: "quick_reply",
              title: "📈 Monthly",
              id: "report_type_1",
            },
            {
              type: "quick_reply",
              title: "📉 Quarterly",
              id: "report_type_2",
            },
          ],
        },
      });
    } catch (error) {
      Logger.error("Error handling program selection", error);
      await whatsappService.sendMessage(
        phoneNumber,
        "❌ Error processing selection. Please try again."
      );
    }
  }

  /**
   * Handle report type selection and generate PDF
   */
  static async handleReportTypeSelection(phoneNumber, reportType) {
    try {
      const lastMessage = await usersQueries.getLastMessage(phoneNumber);
      const programId = lastMessage?.context?.selectedProgramId;
      const programName = lastMessage?.context?.selectedProgramName;

      if (!programId) {
        await whatsappService.sendMessage(
          phoneNumber,
          "❌ Program not selected. Please start over."
        );
        return;
      }

      Logger.info("Generating report", {
        phoneNumber,
        programId,
        reportType,
      });

      // Show loading message
      await whatsappService.sendMessage(
        phoneNumber,
        `⏳ *Generating ${REPORT_TYPES[reportType]}*\n\nPlease wait...`
      );

      // Update user flow state
      await usersQueries.updateLastMessage(phoneNumber, {
        flow: "analytics",
        step: 3,
        context: {
          selectedProgramId: programId,
          selectedProgramName: programName,
          selectedReportType: reportType,
        },
        text: "report_generating",
      });

      // Generate report
      await this.generateAndSendReport(
        phoneNumber,
        programId,
        reportType,
        programName
      );
    } catch (error) {
      Logger.error("Error handling report type selection", error);
      await whatsappService.sendMessage(
        phoneNumber,
        "❌ Error generating report. Please try again."
      );
      await usersQueries.clearLastMessage(phoneNumber);
    }
  }

  /**
   * Generate report and send as PDF to user
   */
  static async generateAndSendReport(
    phoneNumber,
    programId,
    reportType,
    programName
  ) {
    try {
      Logger.info("Calling report generation API", {
        phoneNumber,
        programId,
        reportType,
      });

      const url = `${API_BASE_URL}${REPORTS_ENDPOINT}?requestPdf=true&reportType=${reportType}&programId=${programId}`;

      // Use makeApiRequest helper
      const response = await makeApiRequest(
        "GET",
        url,
        process.env.ELEVATE_AUTH_TOKEN
      );

      if (!response.success) {
        throw new Error(response.error?.message || "Failed to generate report");
      }

      if (!response.data.result?.downloadUrl) {
        throw new Error("No download URL in response");
      }

      const downloadUrl = response.data.result.downloadUrl;

      Logger.info("Report generated, sending to user", {
        phoneNumber,
        downloadUrl,
      });

      // Send PDF to user
      const fileName = `${programName}_${REPORT_TYPES[reportType]}_${
        new Date().toISOString().split("T")[0]
      }.pdf`;

      await whatsappService.sendMediaMessage(
        phoneNumber,
        "document",
        downloadUrl,
        fileName
      );

      Logger.info("Report sent successfully", { phoneNumber });

      // Wait 1 minute before sending next message
      setTimeout(async () => {
        try {
          await whatsappService.sendMessage(
            phoneNumber,
            "✅ Report sent! Would you like to view another report?"
          );
          await this.showAnalyticsMenu(phoneNumber);
        } catch (error) {
          Logger.error("Error showing menu after delay", error);
        }
      }, 10000); // 1 minute
    } catch (error) {
      Logger.error("Error generating or sending report", error);
      await whatsappService.sendMessage(
        phoneNumber,
        "❌ Error generating report. Please try again."
      );
      await usersQueries.clearLastMessage(phoneNumber);
    }
  }

  /**
   * Handle analytics flow continuation (from text input in flow)
   */
  static async handleAnalyticsFlow(phoneNumber, messageText, lastMessage) {
    try {
      const step = lastMessage?.step || 0;

      if (step === 0) {
        // User confirmed viewing program report
        await this.listPrograms(phoneNumber);
      } else if (step === 1) {
        // User typed program name/number to search
        await this.listPrograms(phoneNumber); // Could implement search here
      }
    } catch (error) {
      Logger.error("Error in analytics flow", error);
      await whatsappService.sendMessage(
        phoneNumber,
        "❌ Error in analytics flow. Please try again."
      );
    }
  }
}

module.exports = ProgramService;
