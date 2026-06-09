// ============================================
// FILE: services/flowRouter.js
// ============================================
const Logger = require("../utils/logger");
const usersQueries = require("../database/databaseQueries/userQueries");
const whatsappService = require("./whatsappService");
const inactivityReminderService = require("./inactivityReminderService");
const userService = require("./userService");
const projectService = require("./projectService");
const registrationFlow = require("./registrationFlow");
const taskService = require("./taskService");
const storyService = require("./storyService");
const programService = require("./programService");
const projectSubmissionService = require("./projectSubmissionService");
const Project = require("../database/models/project");
const fileUploadService = require("./fileUploadService");
const aiService = require("./aiService2");
const languageService = require("./languageService");
const sessionService = require("./sessionService");
const storyPostSessionService = require("./storyPostSessionService");

class FlowRouter {
  constructor() {
    this.flowHandlers = {
      registration: registrationFlow,
      project_creation: projectService,
      project_update: projectService,
      project_tasks: taskService,
      improvement_project: taskService,
      analytics: programService,
      story_recording: storyService,
    };
  }

  //Main router function that takes in a WhatsApp message object and routes it to the correct handler based on user state, message content, and interactive responses.
  async route(message) {
    try {
      const phoneNumber = message.from;

      const keys = [
        "evidenceLimit",
        "requestNextPhoto",
        "done",
        "limitCount",
        "cancelEvidenceUpload",
        "lostSession",
        "cancelSession",
        "editStoryText",
        "voiceEditPrompt",
        "voiceRetryPrompt",
        "voiceSend",
        "voiceEdit",
        "voiceRetry",
        "voiceSent",
        "voiceSendFailed",
        "voiceNoPending",
        "voiceNoTranscript",
        "noWorries",
        "seeYouSoon",
      ];
      const selectedLanguageText = await languageService.tBatch(
        phoneNumber,
        keys,
      );

      // ============================================
      // STEP 0: Track user activity
      // ============================================
      await inactivityReminderService.trackUserActivity(phoneNumber);

      // ============================================
      // STEP 0.5: Handle media evidence upload (existing flow)
      // ============================================
      const lastMessage = await usersQueries.getLastMessage(phoneNumber);

      if (
        lastMessage?.context?.uploadingEvidence &&
        this.isMediaMessage(message)
      ) {
        return await this.handleMediaUpload(message, phoneNumber);
      }

      // ============================================
      // STEP 0.6: Handle image uploads during post-session photo flow
      // ============================================
      if (
        lastMessage?.flow === "post_session_upload" &&
        message.type === "image"
      ) {
        const lastMsg = await usersQueries.getLastMessage(phoneNumber);
        const ctx = lastMsg?.context || {};
        if (!ctx.expectedImageCount) {
          await usersQueries.updateLastMessage(phoneNumber, {
            ...lastMsg,
            context: { ...ctx, expectedImageCount: 1 },
          });
        }
        return await storyPostSessionService.handlePhotoUpload(
          phoneNumber,
          message,
        );
      }

      const messageText = message.text?.body?.trim() || "";


      // ============================================
      // STEP 1: Voice messages
      // ============================================
      if (message.type === "audio" || message.type === "voice") {
        usersQueries.incrementAudioUsage(phoneNumber).catch((err) =>
          Logger.warn("Failed to increment audio usage", {
            phoneNumber,
            error: err.message,
          }),
        );

        return await this.handleVoiceMessage(message, phoneNumber);
      }

      // ============================================
      // STEP 2: Extract interactive responses
      // ============================================
      const buttonResponse =
        message?.interactive?.buttons_reply?.id ||
        message?.reply?.buttons_reply?.id ||
        message?.buttons_reply?.id;

      const listResponse =
        message?.interactive?.list_reply?.id ||
        message?.reply?.list_reply?.id ||
        message?.list_reply?.id;

      let selectedAction = buttonResponse || listResponse;
      if (selectedAction) {
        selectedAction = selectedAction
          .replace(/^ButtonsV3:/, "")
          .replace(/^ListV3:/, "");
      }

      Logger.debug("Extracted actions", {
        buttonResponse,
        listResponse,
        selectedAction,
      });

      // ============================================
      // STEP 3: Route interactive actions
      // ============================================
      if (selectedAction) {
        // ── Session inactivity: user wants to CONTINUE ──────────────
        if (selectedAction === "session_continue") {
          return await this.handleSessionContinue(phoneNumber);
        }

        // ── Session inactivity / disconnect: user wants NEW session ─
        if (selectedAction === "session_new") {
          return await this.handleSessionNew(phoneNumber, message);
        }

        if (selectedAction === "change_language") {
          return userService.handleUserMessage(message, selectedAction);
        }

        if (selectedAction === "yes_new_session") {
          return userService.handleUserMessage(message, selectedAction);
        }

        if (selectedAction === "no_new_session") {
          await whatsappService.sendMessage(
            phoneNumber,
            `${selectedLanguageText.noWorries}\n\n` +
              `${selectedLanguageText.seeYouSoon}`,
          );
          return { success: true, handled: true };
        }
        // ── Voice: user approved transcript ─────────────────────────
        if (selectedAction === "voice_send") {
          const lastMsg = await usersQueries.getLastMessage(phoneNumber);
          const { pendingText, s3AudioUrl } = lastMsg?.context || {};

          if (!pendingText) {
         
            await whatsappService.sendMessage(
              phoneNumber,
              `❌ ${selectedLanguageText.voiceNoPending}`,
            );
            return { success: false, handled: true };
          }

          const sent = sessionService.sendMessage(phoneNumber, pendingText, {
            asrAudio: s3AudioUrl || "",
            context: "",
          });

          if (sent) {
            await usersQueries.updateLastMessage(phoneNumber, {
              flow: null,
              context: {},
              text: "voice_sent",
            });
            await whatsappService.sendMessage(
              phoneNumber,
              `✅ ${selectedLanguageText.voiceSent}`,
            );
           
          } else {
            await whatsappService.sendMessage(
              phoneNumber,
              `❌ ${selectedLanguageText.voiceSendFailed}`,
            );
          }

          return {
            success: sent,
            handled: true,
            route: sent ? "ws-voice-forwarded" : "ws-send-failed",
          };
        }

        // ── Voice: user wants to edit transcript ────────────────────
        if (selectedAction === "voice_edit") {
          const lastMsg = await usersQueries.getLastMessage(phoneNumber);

          if (!lastMsg?.context?.pendingText) {
            Logger.warn("voice_edit: no pendingText in context", {
              phoneNumber,
            });
            await whatsappService.sendMessage(
              phoneNumber,
              `❌ ${selectedLanguageText.voiceNoTranscript}`,
            );
            return { success: false, handled: true };
          }

          await usersQueries.updateLastMessage(phoneNumber, {
            flow: "voice_edit",
            context: lastMsg.context, // preserve pendingText for reference
            text: "voice_edit_pending",
          });

          await whatsappService.sendMessage(
            phoneNumber,
            `✏️ ${selectedLanguageText.voiceEditPrompt}`,
          );

          Logger.info("voice_edit: waiting for user to type correction", {
            phoneNumber,
          });
          return { success: true, handled: true, route: "ws-voice-edit" };
        }

        // ── Voice: retry recording ──────────────────────────────────
        if (selectedAction === "voice_retry") {
          await usersQueries.updateLastMessage(phoneNumber, {
            flow: null,
            context: {},
            text: "voice_retry",
          });

          await whatsappService.sendMessage(
            phoneNumber,
            `🔄 ${selectedLanguageText.voiceRetryPrompt}`,
          );

          Logger.info("voice_retry: user asked to resend voice note", {
            phoneNumber,
          });
          return { success: true, handled: true, route: "ws-voice-retry" };
        }

        // ── Post-session: user wants to upload photos ───────────────
        if (selectedAction === "post_upload_yes") {
          await whatsappService.sendMessage(
            phoneNumber,
            `📷 ${selectedLanguageText.evidenceLimit}\n\n` +
              `${selectedLanguageText.limitCount}`,
          );
          return { success: true, handled: true };
        }

        // ── Post-session: user adds more photos (acknowledged) ──────
        if (selectedAction === "post_upload_more") {
          await whatsappService.sendMessage(
            phoneNumber,
            `📷 ${selectedLanguageText.requestNextPhoto}`,
          );
          return { success: true, handled: true };
        }

        // ── Post-session: user finished uploading or skipped ────────
        if (
          selectedAction === "post_upload_done" ||
          selectedAction === "post_upload_skip"
        ) {
          return await storyPostSessionService.handleUploadDone(phoneNumber);
        }

        // ── Report: download ────────────────────────────────────────
        if (selectedAction === "download_report") {
          usersQueries.incrementReportDownloads(phoneNumber).catch((err) =>
            Logger.warn("Failed to increment report downloads", {
              phoneNumber,
              error: err.message,
            }),
          );
          return await storyPostSessionService.handleDownloadReport(
            phoneNumber,
          );
        }

        // ── Report: edit ────────────────────────────────────────────
        if (selectedAction === "edit_report") {
          return await storyPostSessionService.handleEditReport(phoneNumber);
        }

        // ── Language selection ──────────────────────────────────────
        if (languageService.isLanguageButton(selectedAction)) {
          return await this.handleLanguageSelection(
            phoneNumber,
            selectedAction,
          );
        }

        // ── Main menu session starters ──────────────────────────────
        if (selectedAction === "capture_discussion") {
          return await this.handleSessionStart(
            phoneNumber,
            "discussion",
            message,
          );
        }

        if (selectedAction === "record_story") {
          return await this.handleSessionStart(phoneNumber, "story", message);
        }

        // ── Forward Mohini option replies over WS ───────────────────
        if (selectedAction.startsWith("mohini_opt_")) {
          const value = selectedAction.split("_").slice(3).join("_");
          const sent = sessionService.sendMessage(phoneNumber, value);
          if (!sent) {
            await whatsappService.sendMessage(
              phoneNumber,
              `⚠️ ${selectedLanguageText.lostSession}`,
            );
          }
          return { success: true, handled: true };
        }
      }

      // ============================================
      // STEP 4: Text messages
      // ============================================
      if (messageText) {
        // ── "done"/"skip" text during post-session photo-upload flow ─
        if (
          lastMessage?.flow === "post_session_upload" &&
          /^(done|skip|finish|complete)$/i.test(messageText)
        ) {
          return await storyPostSessionService.handleUploadDone(phoneNumber);
        }

        // ── User is editing a voice transcription ────────────────────
        if (lastMessage?.flow === "voice_edit") {
          Logger.info(
            "voice_edit: corrected text received – forwarding to WS",
            {
              phoneNumber,
              text: messageText,
            },
          );

          const sent = sessionService.sendMessage(phoneNumber, messageText);

          await usersQueries.updateLastMessage(phoneNumber, {
            flow: null,
            context: {},
            text: "voice_edit_sent",
          });

          if (!sent) {
            Logger.warn("voice_edit: WS send failed – falling back", {
              phoneNumber,
            });
            const result = await flowRouter.route(message);
            return { ...result, route: "flowrouter-voice-edit-fallback" };
          }

          Logger.info("voice_edit: corrected text forwarded to Mohini WS", {
            phoneNumber,
          });
          return {
            success: true,
            handled: true,
            route: "ws-voice-edit-forwarded",
          };
        }

        // ── Forward text to active Mohini WS session ─────────────────
        if (sessionService.isConnected(phoneNumber)) {
          // Still honour cancel / exit even inside a session
          if (/^(cancel|exit|stop|quit|menu)$/i.test(messageText)) {
            Logger.info("Cancel keyword inside WS session", { phoneNumber });
            // fall through to cancel handler below
          } else {
            const sent = sessionService.sendMessage(phoneNumber, messageText);
            if (sent) {
              Logger.info("Text forwarded to Mohini WS", { phoneNumber });
              return { success: true, handled: true, route: "ws-forwarded" };
            }
          }
        }

        // ── Evidence upload flow ──────────────────────────────────────
        if (lastMessage?.context?.uploadingEvidence) {
          if (/^(done|finish|complete|next)$/i.test(messageText)) {
            return await this.handleEvidenceUploadComplete(phoneNumber);
          }
          if (/^(cancel|exit)$/i.test(messageText)) {
            await usersQueries.updateLastMessage(phoneNumber, {
              flow: "project_tasks",
              step: 2,
              context: {
                projectId: lastMessage.context.projectId,
                currentTaskIndex: lastMessage.context.currentTaskIndex,
                uploadingEvidence: false,
              },
              text: "cancel_evidence_upload",
            });
            await whatsappService.sendMessage(
              phoneNumber,
              `❌ ${selectedLanguageText.cancelEvidenceUpload}`,
            );
            return { success: true, handled: true };
          }
        }

        // ── Task number selection ─────────────────────────────────────
        if (
          lastMessage?.flow === "project_tasks" &&
          /^\d+$/.test(messageText)
        ) {
          const taskIndex = parseInt(messageText);
          const lastMsg = await usersQueries.getLastMessage(phoneNumber);
          const projectId = lastMsg?.context?.projectId;
          const projectData = await Project.findOne(
            { projectId, phoneNumber },
            { tasks: 1, projectName: 1, projectData: 1 },
          ).lean();
          if (!projectData) {
            await whatsappService.sendMessage(
              phoneNumber,
              "❌ Project not found. Please select project again.",
            );
            return { success: false, handled: true };
          }
          const tasks = projectData.tasks;
          if (taskIndex > 0 && taskIndex <= tasks.length) {
            await taskService.showTaskDetails(phoneNumber, taskIndex);
          } else {
            await whatsappService.sendMessage(
              phoneNumber,
              `❌ Invalid task number. Please select between 1-${tasks.length}.`,
            );
          }
          return { success: true, handled: true };
        }

        // ── Text commands ─────────────────────────────────────────────
        if (/^projects$/i.test(messageText)) {
          await projectService.listProjects(phoneNumber, 1);
          return { success: true, handled: true };
        }

        if (/^help$/i.test(messageText)) {
          await whatsappService.sendMessage(
            phoneNumber,
            "📋 Available commands:\n" +
              "• Type 'projects' to view all projects\n" +
              "• Type 'menu' for main menu\n" +
              "• Type 'cancel' to exit current flow",
          );
          return { success: true, handled: true };
        }

        if (/^menu$/i.test(messageText)) {
          await userService.handleUserMessage(message);
          return { success: true, handled: true };
        }

        if (/^(cancel|exit|stop|quit)$/i.test(messageText)) {
          await sessionService.closeConnection(phoneNumber);
          await usersQueries.clearLastMessage(phoneNumber);
          await usersQueries
            .update(
              { phoneNumber },
              { $unset: { "scope.activeSession": "", "scope.wsSession": "" } },
            )
            .catch(() => {});
          await whatsappService.sendMessage(
            phoneNumber,
            `❌ ${selectedLanguageText.cancelSession}`,
          );
          return { success: true, handled: true };
        }

        if (lastMessage?.flow === "improvement_project") {
          if (/^(submit|done|complete)$/i.test(messageText)) {
            await projectSubmissionService.submitImprovementProject(
              phoneNumber,
            );
            return { success: true, handled: true };
          }
        }
      }

      // ============================================
      // STEP 5: Fallback – user auth / registration check
      // ============================================
      return await userService.handleUserMessage(message);
    } catch (error) {
      Logger.error("Flow routing error", error);
      await usersQueries.clearLastMessage(message.from);
      return { success: false, handled: false, error: error.message };
    }
  }

  async handleSessionContinue(phoneNumber) {
  try {
    Logger.info("User chose to continue session", { phoneNumber });

    const keys = ["sessionLost"];
    const selectedLanguageText = await languageService.tBatch(phoneNumber, keys);

    await usersQueries.update(
      { phoneNumber },
      {
        $unset: {
          "scope.wsSession.awaitingInactivityResponse": "",
          "scope.wsSession.awaitingReconnectResponse":  "",
        },
      }
    ).catch(() => {});

    const result = await sessionService.reconnect(phoneNumber);

    if (result.success) {
      // Wait for Mohini auth ack before returning so the next
      // user message hits a ready WS
      const ws = sessionService.getActiveWs(phoneNumber);
      if (ws?._mohiniReady) {
        await Promise.race([
          ws._mohiniReady,
          new Promise((resolve) => setTimeout(resolve, 5000)),
        ]);
      }
    } else {
      // Could not reconnect – show main menu
      await whatsappService.sendMessage(
        phoneNumber,
        `⚠️ ${selectedLanguageText.sessionLost}`,
      );
      const message = {
        from: phoneNumber,
        type: "text",
        text: { body: "menu" },
      };
      await userService.handleUserMessage(message);
    }

    return {
      success: result.success,
      handled: true,
      route:   "session-reconnected",
    };
  } catch (error) {
    Logger.error("handleSessionContinue error", { phoneNumber, error: error.message });
    return { success: false, handled: true };
  }
}

  // ─────────────────────────────────────────────────────────────────
  // Handle "New Session" from inactivity / disconnect prompt (req #2)
  //
  // Terminates the old WS, clears session state, and shows the user
  // the main menu so they can pick a fresh session type.
  // ─────────────────────────────────────────────────────────────────
  async handleSessionNew(phoneNumber, originalMessage) {
  try {
    Logger.info("User chose to start a new session", { phoneNumber });

    const keys = ["newSessionStarted"];
    const selectedLanguageText = await languageService.tBatch(phoneNumber, keys);

    // Close the old WS without triggering post-session (not completed)
    await sessionService.closeConnection(phoneNumber);

    // ── Wipe everything — session data + both awaiting flags ──────
    await usersQueries.update(
      { phoneNumber },
      {
        $unset: {
          "scope.activeSession":                        "",
          "scope.wsSession":                            "",
          "scope.wsSession.awaitingInactivityResponse": "",
          "scope.wsSession.awaitingReconnectResponse":  "",
        },
      }
    ).catch(() => {});

    await usersQueries.clearLastMessage(phoneNumber);

    await whatsappService.sendMessage(
      phoneNumber,
      `🔄 ${selectedLanguageText.newSessionStarted}`,
    );

    // Route to main menu
    const menuMessage = {
      ...originalMessage,
      type: "text",
      text: { body: "menu" },
    };
    await userService.handleUserMessage(menuMessage);

    return { success: true, handled: true, route: "session-new" };
  } catch (error) {
    Logger.error("handleSessionNew error", { phoneNumber, error: error.message });
    return { success: false, handled: true };
  }
}

  // ─────────────────────────────────────────────────────────────────
  // Language selection handler
  // ─────────────────────────────────────────────────────────────────
  async handleLanguageSelection(phoneNumber, langButtonId) {
    try {
      Logger.info("Language selected", { phoneNumber, langButtonId });
      const keys = ["languageSetup"];
      const selectedLanguageText = await languageService.tBatch(
        phoneNumber,
        keys,
      );

      await whatsappService.sendMessage(
        phoneNumber,
        selectedLanguageText.languageSetup,
      );

      const { langLabel } = await languageService.fetchAndStore(
        phoneNumber,
        langButtonId,
      );

      Logger.info("Translations stored", { phoneNumber, langLabel });

      await usersQueries.updateLastMessage(phoneNumber, {
        flow: "main_menu",
        step: 0,
        context: { language: langLabel },
        text: langButtonId,
      });

      const mainMenuMsg =
        await languageService.buildMainMenuMessage(phoneNumber);
      await whatsappService.sendInteractiveMessage(mainMenuMsg);

      return { success: true, handled: true, stage: "main_menu" };
    } catch (error) {
      Logger.error("Language selection failed", {
        phoneNumber,
        error: error.message,
      });
      await whatsappService.sendMessage(
        phoneNumber,
        "❌ Could not load language. Please try again.",
      );
      return { success: false, handled: true };
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // Session start → WebSocket open
  // ─────────────────────────────────────────────────────────────────
  async handleSessionStart(phoneNumber, sessionType, message) {
    try {
      Logger.info("Starting Mohini session", { phoneNumber, sessionType });

      // 1. Create REST session (profile + generate-session)
      const sessionResult = await sessionService.createSession(
        phoneNumber,
        sessionType,
      );
      const keys = ["sessionDiscontinue"];
      const selectedLanguageText = await languageService.tBatch(
        phoneNumber,
        keys,
      );

      if (!sessionResult.success) {
        await whatsappService.sendMessage(
          phoneNumber,
          `❌ ${selectedLanguageText.sessionDiscontinue}`,
        );
        return { success: false, handled: true };
      }

      // 2. Open WebSocket – authenticate frame sent automatically on open
      const wsResult = await sessionService.openConnection(
        phoneNumber,
        false,
        sessionType,
      );

      if (!wsResult.success) {
        await whatsappService.sendMessage(
          phoneNumber,
          `❌ ${selectedLanguageText.sessionDiscontinue}`,
        );
        return { success: false, handled: true };
      }

      // 3. Persist flow state
      await usersQueries.updateLastMessage(phoneNumber, {
        flow:
          sessionType === "discussion"
            ? "capture_discussion"
            : "story_recording",
        step: 1,
        context: {
          sessionId: sessionResult.session.sessionId,
          profileId: sessionResult.session.profileId,
          sessionType,
        },
        text: sessionType,
      });

      Logger.info("Session + WS active", {
        phoneNumber,
        sessionType,
        sessionId: sessionResult.session.sessionId,
      });

      return { success: true, handled: true, stage: "session_active" };
    } catch (error) {
      Logger.error("Session start error", {
        phoneNumber,
        error: error.message,
      });
      await whatsappService.sendMessage(
        phoneNumber,
        `❌ ${selectedLanguageText.sessionDiscontinue}`,
      );
      return { success: false, handled: true };
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // Existing helpers
  // ─────────────────────────────────────────────────────────────────
  async handleMediaUpload(message, phoneNumber) {
    try {
      const result = await fileUploadService.handleEvidenceUpload(
        phoneNumber,
        message,
      );
      return { success: result.success, handled: true };
    } catch (error) {
      Logger.error("Media upload error", error);
      const keys = ["imageUploadFailed"];
      const selectedLanguageText = await languageService.tBatch(
        phoneNumber,
        keys,
      );
      await whatsappService.sendMessage(
        phoneNumber,
        `❌ ${selectedLanguageText.imageUploadFailed}`,
      );
      return { success: false, handled: true };
    }
  }

  async handleEvidenceUploadComplete(phoneNumber) {
    try {
      const result = await fileUploadService.finishEvidenceUpload(phoneNumber);
      return { success: result.success, handled: true };
    } catch (error) {
      Logger.error("Error completing evidence upload", error);
      return { success: false, handled: true };
    }
  }

  isMediaMessage(message) {
    return ["image", "video", "audio", "document"].includes(message.type);
  }

  async handleVoiceMessage(message, phoneNumber) {
    try {
      const keys = ["voiceProcessing"];
      const selectedLanguageText = await languageService.tBatch(
        phoneNumber,
        keys,
      );

      await whatsappService.sendMessage(
        phoneNumber,
        `🎤 ${selectedLanguageText.voiceProcessing}`,
      );

      if (sessionService.isConnected(phoneNumber)) {
        await whatsappService.sendMessage(
          phoneNumber,
          "Please type your response for now.",
        );
        return { success: true, handled: true };
      }

      return { success: true, handled: true };
    } catch (error) {
      Logger.error("Voice handling error", error);
      return { success: false, handled: true };
    }
  }
}

module.exports = new FlowRouter();
