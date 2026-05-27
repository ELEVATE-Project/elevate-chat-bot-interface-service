// ============================================
// FILE: controllers/messageController.js
// ============================================
const Logger = require("../utils/logger");
const flowRouter = require("../services/flowRouter");
const aiService = require("../services/aiService");
const whatsappService = require("../services/whatsappService");
const usersQueries = require("../database/databaseQueries/userQueries");
const sessionService = require("../services/sessionService");
const Project = require("../database/models/project");
const axios = require("axios");
const storyPostSessionService = require("../services/storyPostSessionService");
const languageService = require("../services/languageService");
const MOHINI_BASE_URL =process.env.BACKEND_API_URL;
class MessageController {
  /**
   * Main entry point for all WhatsApp messages.
   *
   * Priority order:
   *  0.  Auto-reconnect (server restart recovery)   ← NEW
   *  1.  Interactive (buttons / lists)    → flowRouter
   *  2.  Active Mohini WS session exists  → forward directly to WS
   *  3.  Audio / voice                    → transcribe → WS or NLP
   *  4.  Text – simple command            → flowRouter
   *  5.  Text – natural language          → NLP / Claude
   *  6.  Media                            → flowRouter
   */
  static async handleWhatsAppMessage(message, phoneNumber) {
    try {
      Logger.info("MessageController: Received", {
        phoneNumber,
        type: message.type,
      });
      whatsappService.sendTyping(phoneNumber);

      const keys = ["whatsappNotSupported", "notUnderstood"];
      const selectedLanguageText = await languageService.tBatch(
        phoneNumber,
        keys,
      );

      // ──────────────────────────────────────────────────────────────
      // STEP 0 : Auto-reconnect after server restar
      //
      // We skip this for interactive messages (button taps) because:
      //  a) flowRouter handles session_continue / session_new itself, and
      //  b) reconnecting before processing "session_new" would be wrong.
      // ──────────────────────────────────────────────────────────────
      if (
        !this.isInteractiveMessage(message) &&
        !sessionService.isConnected(phoneNumber)
      ) {
        await this.autoReconnectIfNeeded(phoneNumber);
      }

      // ──────────────────────────────────────────────────────────────
      // STEP 1: Interactive messages → always go to flowRouter
      // ──────────────────────────────────────────────────────────────
      if (this.isInteractiveMessage(message)) {
        Logger.info("MessageController: Interactive → flowRouter", {
          phoneNumber,
        });
        const result = await flowRouter.route(message);
        return { ...result, route: "flowrouter-interactive" };
      }

      // ──────────────────────────────────────────────────────────────
      // STEP 2: If a Mohini WS session is active, short-circuit
      //         ALL non-interactive messages straight to the WS.
      // ──────────────────────────────────────────────────────────────
      if (sessionService.isConnected(phoneNumber)) {
        Logger.info("MessageController: Active WS session – forwarding", {
          phoneNumber,
          type: message.type,
        });
        return await this.forwardToActiveSession(message, phoneNumber);
      }

      // ──────────────────────────────────────────────────────────────
      // STEP 3: Audio / voice (no active WS)
      // ──────────────────────────────────────────────────────────────
      if (message.type === "audio" || message.type === "voice") {
        Logger.info("MessageController: Audio → transcribe → NLP", {
          phoneNumber,
        });
        return await this.handleAudioMessage(message, phoneNumber);
      }

      // ──────────────────────────────────────────────────────────────
      // STEP 4 & 5: Text messages
      // ──────────────────────────────────────────────────────────────
      if (message.type === "text") {
        const messageText = message.text?.body?.trim() || "";
        Logger.info("MessageController: Text", {
          phoneNumber,
          preview: messageText.substring(0, 50),
        });

        if (this.isSimpleCommand(messageText)) {
          Logger.info("MessageController: Simple command → flowRouter", {
            phoneNumber,
          });
          const result = await flowRouter.route(message);
          return { ...result, route: "flowrouter-command" };
        }

        await whatsappService.sendMessage(
          phoneNumber,
          `❌ ${selectedLanguageText.notUnderstood}`,
        );

        // Logger.info("MessageController: Natural language → NLP", { phoneNumber });
        // return await this.handleNaturalLanguage(message, phoneNumber, messageText);
      }

      // ──────────────────────────────────────────────────────────────
      // STEP 6: Media
      // ──────────────────────────────────────────────────────────────
      if (message.type === "image" || message.type === "document") {
        Logger.info("MessageController: Media → flowRouter", { phoneNumber });
        const result = await flowRouter.route(message);
        return { ...result, route: "flowrouter-media" };
      }

      // Fallback
      await whatsappService.sendMessage(
        phoneNumber,
        `❌ ${selectedLanguageText.whatsappNotSupported}`,
      );
      return { success: false, handled: true, route: "unsupported" };
    } catch (error) {
      Logger.error("MessageController: Fatal error", error);
      return {
        success: false,
        handled: false,
        error: error.message,
        route: "error",
      };
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // STEP 0 impl: Auto-reconnect when server restarted
  //
  // Conditions to attempt a reconnect:
  //   • scope.activeSession.sessionId exists in MongoDB   (session in flight)
  //   • scope.wsSession.status !== "disconnected"         (not intentionally closed)
  //     — OR — scope.wsSession is missing entirely        (first message after crash
  //             where close handler never ran)
  //
  // After a clean WS close (network drop, etc.) the close handler sets
  // status = "disconnected" AND sends the user a reconnect/new-session
  // prompt. If the user replies with text instead of tapping a button we
  // still auto-reconnect here so they're not left hanging.
  //
  // After a crash (SIGKILL / OOM) the close handler never runs, so
  // wsSession.status is still "connected" → we reconnect unconditionally.
  // ──────────────────────────────────────────────────────────────────
  static async autoReconnectIfNeeded(phoneNumber) {
    try {
      const user = await usersQueries.findOne({ phoneNumber });
      const storedSession = user?.scope?.activeSession;

      // No stored session → nothing to reconnect to
      if (!storedSession?.sessionId) return;

      const wsStatus = user?.scope?.wsSession?.status;

      Logger.info("MessageController: Stored session found but no live WS", {
        phoneNumber,
        sessionId: storedSession.sessionId,
        wsStatus: wsStatus ?? "none",
      });

      // Reconnect for any status except an explicit user-initiated cancel
      // (we unset activeSession on cancel, so this guard rarely fires)
      Logger.info("MessageController: Auto-reconnecting after restart", {
        phoneNumber,
        sessionId: storedSession.sessionId,
      });

      const result = await sessionService.reconnect(phoneNumber);

      if (result.success) {
        Logger.info("MessageController: Auto-reconnect succeeded", {
          phoneNumber,
        });

        // Give Mohini 800 ms to process the authenticate frame before
        // the caller forwards the user's actual message over the WS.
        await new Promise((resolve) => setTimeout(resolve, 800));
      } else {
        Logger.warn("MessageController: Auto-reconnect failed", {
          phoneNumber,
          error: result.error,
        });
        // Don't block the message — flowRouter will handle it normally
      }
    } catch (error) {
      Logger.error("MessageController: autoReconnectIfNeeded error", {
        phoneNumber,
        error: error.message,
      });
      // Non-fatal: let the message fall through to normal routing
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // Forward message to the active Mohini WS session
  // ──────────────────────────────────────────────────────────────────
 static async forwardToActiveSession(message, phoneNumber) {
  try {
    const keys = [
      "voiceProcessing",
      "wsSessionRequired",
      "audioDownloadError",
      "notUnderstood",
      "voiceHeard",
      "voiceSendConfirm",
      "voiceEditPrompt",
      "voiceRetryPrompt",
      "voiceSend",
      "voiceEdit",
      "voiceRetry",
    ];
    const selectedLanguageText = await languageService.tBatch(phoneNumber, keys);

    // ── Voice / audio during an active session ───────────────────
    if (message.type === "audio" || message.type === "voice") {
      let audioUrl = message.audio?.link || message.voice?.link;
      await whatsappService.sendMessage(
        phoneNumber,
        `🎤 ${selectedLanguageText.voiceProcessing}`,
      );

      // ── Download audio from WhatsApp ──────────────────────────
      // const audioBuffer = await this.downloadWhatsAppAudio(message);
      // if (!audioBuffer) {
      //   await whatsappService.sendMessage(
      //     phoneNumber,
      //     `❌ ${selectedLanguageText.audioDownloadError}`,
      //   );
      //   return { success: false, handled: true, route: "ws-audio-failed" };
      // }

      // ── Get session context ───────────────────────────────────
      const user = await usersQueries.findOne({ phoneNumber });
      const session = user?.scope?.wsSession;

      if (!session?.sessionId) {
        Logger.warn("forwardToActiveSession: no wsSession found", { phoneNumber });
        await whatsappService.sendMessage(
          phoneNumber,
          `⚠️ ${selectedLanguageText.wsSessionRequired}`,
        );
        return { success: false, handled: true, route: "ws-no-session" };
      }

      const language = session?.language || user?.scope?.language || "en";
      const flowName = session?.flowName || "guest-discussion";

      // ── Transcribe ────────────────────────────────────────────
      const transcript = await this._transcribeAudio(
        phoneNumber,
        audioUrl,
        session.sessionId,
        language,
        flowName,
      );

      if (!transcript) {
        await whatsappService.sendMessage(
          phoneNumber,
          `❌ ${selectedLanguageText.notUnderstood}`,
        );
        return { success: false, handled: true, route: "ws-transcription-failed" };
      }

      // ── Store transcript, ask user to confirm ─────────────────
      await usersQueries.updateLastMessage(phoneNumber, {
        flow: "voice_confirm",
        context: { pendingText: transcript, sessionActive: true },
        text: "voice_transcribed",
      });

      await whatsappService.sendInteractiveMessage({
        to: phoneNumber,
        type: "button",
        body: {
          text: `🎤 *${selectedLanguageText.voiceHeard}*\n\n_"${transcript}"_\n\n${selectedLanguageText.voiceSendConfirm}`,
        },
        action: {
          buttons: [
            { type: "quick_reply", title: selectedLanguageText.voiceSend,  id: "voice_send"  },
            { type: "quick_reply", title: selectedLanguageText.voiceEdit,  id: "voice_edit"  },
            { type: "quick_reply", title: selectedLanguageText.voiceRetry, id: "voice_retry" },
          ],
        },
      });

      return { success: true, handled: true, route: "ws-voice-pending-confirm" };
    }

    // ── Text during an active session ─────────────────────────────
    if (message.type === "text") {
      const text = message.text?.body?.trim() || "";

      // ── Cancel / exit keywords ────────────────────────────────
      if (/^(cancel|exit|stop|quit|menu)$/i.test(text)) {
        Logger.info("MessageController: Cancel inside WS session", { phoneNumber });
        const result = await flowRouter.route(message);
        return { ...result, route: "flowrouter-cancel-in-session" };
      }

      // ── User is editing a voice transcription ─────────────────
      const lastMsg = await usersQueries.getLastMessage(phoneNumber);
      if (lastMsg?.flow === "voice_edit") {
        Logger.info("MessageController: Voice edit text received – forwarding to WS", {
          phoneNumber,
          text,
        });

        const sent = sessionService.sendMessage(phoneNumber, text);

        await usersQueries.updateLastMessage(phoneNumber, {
          flow: null,
          context: {},
          text: "voice_edit_sent",
        });

        if (!sent) {
          Logger.warn("MessageController: WS send failed during voice edit", { phoneNumber });
          const result = await flowRouter.route(message);
          return { ...result, route: "flowrouter-voice-edit-fallback" };
        }

        Logger.info("MessageController: Voice edit forwarded to Mohini WS", { phoneNumber });
        return { success: true, handled: true, route: "ws-voice-edit-forwarded" };
      }

      // ── Normal text forward ───────────────────────────────────
      const sent = sessionService.sendMessage(phoneNumber, text);
      if (!sent) {
        // WS dropped between isConnected() check and here – fall back to flowRouter
        Logger.warn("MessageController: WS send failed – falling back", { phoneNumber });
        const result = await flowRouter.route(message);
        return { ...result, route: "flowrouter-ws-fallback" };
      }

      Logger.info("MessageController: Text forwarded to Mohini WS", { phoneNumber });
      return { success: true, handled: true, route: "ws-text-forwarded" };
    }

    // ── Anything else (image/doc) during a session ────────────────
    await whatsappService.sendMessage(
      phoneNumber,
      `⚠️ ${selectedLanguageText.wsSessionRequired}`,
    );
    return { success: true, handled: true, route: "ws-unsupported-type" };

  } catch (error) {
    Logger.error("MessageController: forwardToActiveSession error", error);
    return { success: false, handled: true, error: error.message };
  }
}

  static async _transcribeAudio(
    phoneNumber,
    audioUrl,
    sessionId,
    language = "en",
    flowName = "guest-discussion",
  ) {
    try {
      // ── 1. Get presigned URL ─────────────────────────────────────
      // const fileName = `${Date.now()}`;
      // const fileType = "audio/ogg;codecs=opus"; // WhatsApp sends ogg
      // const folder_structure = `chatbot/companychat/${sessionId}/`;

      // const presignResp = await axios.post(
      //   `${MOHINI_BASE_URL}/api/get-presigned-url/`,
      //   { fileName, fileType, folder_structure },
      //   {
      //     headers: {
      //       "Content-Type": "application/json",
      //       Origin: process.env.ORIGIN_URL,
      //     },
      //     timeout: 15000,
      //   },
      // );

      // const { uploadUrl, s3Url } = presignResp.data;
      // if (!uploadUrl || !s3Url) {
      //   Logger.error("_transcribeAudio: no uploadUrl/s3Url", {
      //     presignResp: presignResp.data,
      //   });
      //   return null;
      // }

      // ── 2. Upload audio buffer to S3 ─────────────────────────────
      // await axios.put(uploadUrl, audioBuffer, {
      //   headers: {
      //     "Content-Type": fileType,
      //     "Content-Length": audioBuffer.length,
      //   },
      //   timeout: 60000,
      //   maxBodyLength: Infinity,
      //   maxContentLength: Infinity,
      // });

      Logger.info("_transcribeAudio: audio uploaded to S3", { audioUrl });

      // ── 3. Call ASR API ──────────────────────────────────────────
      const asrResp = await axios.post(
        `${MOHINI_BASE_URL}/api/asr/`,
        {
           s3Url:audioUrl, 
          source_language: language,
          route: `/${flowName}`,
        },
        {
          headers: {
            "Content-Type": "application/json",
            Origin: process.env.ORIGIN_URL,
          },
          timeout: 30000,
        },
      );

      const transcript = asrResp.data?.transcript?.trim();
      Logger.info("_transcribeAudio: transcript received", {
        phoneNumber,
        transcript,
      });
      return transcript || null;
    } catch (error) {
      Logger.error("_transcribeAudio failed", {
        phoneNumber,
        error: error.message,
        status: error.response?.status,
        data: error.response?.data,
      });
      return null;
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // Check if message is interactive (buttons / lists)
  // ──────────────────────────────────────────────────────────────────
  static isInteractiveMessage(message) {
    return !!(
      message?.interactive?.buttons_reply?.id ||
      message?.reply?.buttons_reply?.id ||
      message?.buttons_reply?.id ||
      message?.interactive?.list_reply?.id ||
      message?.reply?.list_reply?.id ||
      message?.list_reply?.id
    );
  }

  // ──────────────────────────────────────────────────────────────────
  // Simple keyword commands that don't need AI
  // ──────────────────────────────────────────────────────────────────
  static isSimpleCommand(text) {
    return /^(projects|help|menu|cancel|exit|stop|quit|done|finish|complete|next|mainmenu|hi|hello)$/i.test(
      text,
    );
  }

  // ──────────────────────────────────────────────────────────────────
  // Audio → transcribe → NLP  (no active WS)
  // ──────────────────────────────────────────────────────────────────
  static async handleAudioMessage(message, phoneNumber) {
    try {
      await whatsappService.sendMessage(
        phoneNumber,
        "🎤 Processing your voice message...",
      );

      const audioBuffer = await this.downloadWhatsAppAudio(message);
      if (!audioBuffer) {
        await whatsappService.sendMessage(
          phoneNumber,
          "❌ Failed to download voice message. Please type your message.",
        );
        return { success: false, handled: true, route: "audio-failed" };
      }

      const transcription = await aiService.transcribeVoice(
        audioBuffer,
        "audio/ogg",
      );
      if (!transcription.success || !transcription.text) {
        await whatsappService.sendMessage(
          phoneNumber,
          "❌ Could not understand voice message. Please type your message.",
        );
        return { success: false, handled: true, route: "transcription-failed" };
      }

      const transcribedText = transcription.text.trim();
      Logger.info("MessageController: Transcribed", {
        phoneNumber,
        preview: transcribedText.substring(0, 100),
      });

      await whatsappService.sendMessage(
        phoneNumber,
        `📝 *You said:*\n"${transcribedText}"\n\n⏳ Processing...`,
      );

      return await this.handleNaturalLanguage(
        message,
        phoneNumber,
        transcribedText,
      );
    } catch (error) {
      Logger.error("MessageController: Audio error", error);
      await whatsappService.sendMessage(
        phoneNumber,
        "❌ Error processing voice. Please type instead.",
      );
      return { success: false, handled: true, route: "audio-error" };
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // Download audio from WhatsApp via Whapi
  // ──────────────────────────────────────────────────────────────────
  static async downloadWhatsAppAudio(message) {
    try {
      const audioId = message.audio?.id || message.voice?.id;
      if (!audioId) {
        Logger.error("No audio ID in message", { type: message.type });
        return null;
      }

      const config = require("../config/config");
      const mediaResp = await axios.get(
        `${config.whapi.baseUrl}/media/${audioId}`,
        {
          headers: { Authorization: `Bearer ${config.whapi.token}` },
          timeout: 15000,
        },
      );

      const buffer = Buffer.from(mediaResp.data);
      Logger.info("Audio downloaded", { size: buffer.length });
      return buffer;
    } catch (error) {
      Logger.error("downloadWhatsAppAudio error", error);
      return null;
    }
  }
}

module.exports = MessageController;
