// ============================================
// FILE: services/sessionService.js
// ============================================
const axios = require("axios");
const WebSocket = require("ws");
const Logger = require("../utils/logger");
const usersQueries = require("../database/databaseQueries/userQueries");
const whatsappService = require("./whatsappService");
const languageService = require("./languageService");

const MOHINI_BASE_URL = process.env.BACKEND_API_URL;

const MOHINI_WS_URL = process.env.MOHINI_WS_URL;

const MOHINI_COMPANY = process.env.MOHINI_COMPANY;
const MOHINI_CAPTURE_BOT_ROUTE = process.env.MOHINI_CAPTURE_BOT_ROUTE;
const MOHINI_PROJECT_BOT_ROUTE = process.env.MOHINI_PROJECT_BOT_ROUTE;
// Address fields sent in the authenticate frame.
// For WhatsApp users we don't have real IP – use env-configured defaults
// that represent the organisation's primary location.
const MOHINI_IP_CITY = process.env.MOHINI_IP_CITY || "Bengaluru";
const MOHINI_IP_STATE = process.env.MOHINI_IP_STATE || "Karnataka";
const MOHINI_IP_ZIP = process.env.MOHINI_IP_ZIP || "562130";

// ── Inactivity window before prompting the user ──────────────────────────────
const INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

// phoneNumber → WebSocket (in-memory; lost on server restart)
const activeConnections = new Map();

// phoneNumber → NodeJS.Timeout  (inactivity timers)
const inactivityTimers = new Map();

const LANGUAGE_ROUTE = { en: "en", hi: "hi", kn: "kn", te: "te" };
const FLOW_NAME = { discussion: "guest-discussion", story: "guest-mi-story" };

// ─────────────────────────────────────────────────────────────────────────────
// Helpers shared across the class (module-scope so they're accessible in
// arrow-function callbacks without `this` binding issues)
// ─────────────────────────────────────────────────────────────────────────────

/** Clear any running inactivity timer for a phone number. */
function clearInactivityTimer(phoneNumber) {
  if (inactivityTimers.has(phoneNumber)) {
    clearTimeout(inactivityTimers.get(phoneNumber));
    inactivityTimers.delete(phoneNumber);
  }
}

class SessionService {
  constructor() {
    // Tracks phones where a post-session flow is already in progress.
    // Prevents duplicate triggers when multiple bot messages arrive
    // close together and all fire _handleSessionEnd concurrently.
    this._sessionEndInProgress = new Set();
  }

  // ─────────────────────────────────────────────────────────────────
  // 1.  Create a Mohini session and store sessionId
  // ─────────────────────────────────────────────────────────────────
  async createSession(phoneNumber, sessionType) {
    try {
      Logger.info("Creating Mohini session", { phoneNumber, sessionType });

      const user = await usersQueries.findOne({ phoneNumber });
      const language = user?.scope?.language || "en";
      const flowName = FLOW_NAME[sessionType] || "guest-discussion";

      // ── A. Upsert profile ────────────────────────────────────────
      const profileResp = await axios.post(
        `${MOHINI_BASE_URL}/api/profile/`,
        {
          email: `${phoneNumber}@shikshalokam.org`,
          latest_flow_used: flowName,
          company: MOHINI_COMPANY,
        },
        { headers: { "Content-Type": "application/json" }, timeout: 15000 },
      );

      const profileId = profileResp.data?.id ?? profileResp.data?.profileid;
      Logger.info("Profile upserted", { phoneNumber, profileId });

      // ── B. Generate session ──────────────────────────────────────
      const sessionResp = await axios.get(
        `${MOHINI_BASE_URL}/api/generate-session/`,
        { headers: { "Content-Type": "application/json" }, timeout: 15000 },
      );

      const sessionData = sessionResp.data;
      const sessionId = sessionData?.sessionid;
      Logger.info("Session generated", { phoneNumber, sessionId });

      // ── C. Persist on user ───────────────────────────────────────
      await usersQueries.update(
        { phoneNumber },
        {
          $set: {
            "scope.activeSession": {
              sessionId,
              profileId,
              sessionType,
              language,
              flowName,
              createdAt: new Date(),
            },
          },
        },
      );

      return {
        success: true,
        session: { sessionId, profileId, ...sessionData },
      };
    } catch (error) {
      Logger.error("Failed to create Mohini session", {
        phoneNumber,
        error: error.message,
        status: error.response?.status,
      });
      return { success: false, error: error.message };
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // 2.  Open (or RE-open) a WebSocket to wss://…/ws/common/
  //
  //     isReconnect = true  → session already in progress; skip the
  //     "enter your name" prompt and show a "reconnected" notice instead.
  // ─────────────────────────────────────────────────────────────────

  async openConnection(phoneNumber, isReconnect = false, sessionType) {
    await this.closeConnection(phoneNumber); // kill any stale socket

    const user = await usersQueries.findOne({ phoneNumber });
    const session = user?.scope?.activeSession;

    if (!session?.sessionId) {
      Logger.error("openConnection: no active session", { phoneNumber });
      return { success: false, error: "No active session" };
    }

    return new Promise((resolve) => {
      Logger.info("Opening WebSocket", {
        phoneNumber,
        url: MOHINI_WS_URL,
        isReconnect,
      });

      const ws = new WebSocket(MOHINI_WS_URL, {
        headers: {
          Origin: process.env.ORIGIN_URL,
          "Cache-Control": "no-cache",
          Pragma: "no-cache",
          "Accept-Language": "en-GB,en-US;q=0.9,en;q=0.8",
          "User-Agent":
            "Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) " +
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36",
        },
        perMessageDeflate: true,
      });

      // so the first user message only goes to Mohini AFTER the WS is
      // actually ready to accept it.
      let _authResolve;
      ws._mohiniReady = new Promise((res) => {
        _authResolve = res;
      });

      // ── OPEN: send authenticate immediately ──────────────────────
      ws.on("open", async () => {
        Logger.info("WS open – authenticating", { phoneNumber, isReconnect });
        activeConnections.set(phoneNumber, ws);

        const authFrame = {
          type: "authenticate",
          sessionid: session.sessionId,
          profileid: session.profileId,
          projectid: "",
          taskid: null,
          access_token: null,
          route: LANGUAGE_ROUTE[session.language] || "en",
          bot_route:
            session.flowName === "guest-discussion"
              ? MOHINI_CAPTURE_BOT_ROUTE
              : MOHINI_PROJECT_BOT_ROUTE,
          flow_name: session.flowName || "guest-discussion",
          address: {
            ipCity: MOHINI_IP_CITY,
            ipState: MOHINI_IP_STATE,
            ipZipCode: MOHINI_IP_ZIP,
          },
        };

        ws.send(JSON.stringify(authFrame));
        Logger.info("Auth frame sent", {
          phoneNumber,
          sessionId: session.sessionId,
          profileId: session.profileId,
          flowName: session.flowName,
          isReconnect,
        });

        // Persist WS connection metadata in MongoDB
        try {
          await usersQueries.update(
            { phoneNumber },
            {
              $set: {
                "scope.wsSession": {
                  sessionId: session.sessionId,
                  profileId: session.profileId,
                  language: session.language || "en",
                  flowName: session.flowName || "guest-discussion",
                  connectedAt: new Date(),
                  lastActivityAt: new Date(),
                  status: "connected",
                  isReconnect,
                },
              },
            },
          );
        } catch (dbErr) {
          Logger.error("Failed to persist wsSession", {
            phoneNumber,
            dbErr: dbErr.message,
          });
        }

        // Start the inactivity watchdog
        this.resetInactivityTimer(phoneNumber);

        const keys = [
          "conversationStartMessage",
          "conversationStartMessageForCaptureDiscussion",
          "sessionReconnected",
        ];
        const selectedLanguageText = await languageService.tBatch(
          phoneNumber,
          keys,
        );

        if (!isReconnect) {
          await whatsappService.sendMessage(
            phoneNumber,
            `👩‍💻 ${
              sessionType === "discussion"
                ? selectedLanguageText.conversationStartMessageForCaptureDiscussion
                : selectedLanguageText.conversationStartMessage
            }`,
          );
        }

        resolve({ success: true });
      });

      // ── MESSAGE: Mohini → WhatsApp ───────────────────────────────
      ws.on("message", async (rawData) => {
        const raw = rawData.toString();
        Logger.debug("WS ← Mohini", {
          phoneNumber,
          raw: raw.substring(0, 300),
        });

        let payload;
        try {
          payload = JSON.parse(raw);
        } catch {
          if (raw.trim()) await whatsappService.sendMessage(phoneNumber, raw);
          return;
        }

        // ─  ──────────
        // Mohini sends { type: "authenticated" } or { type: "auth_success" }
        // signal that the WS is genuinely ready to accept user messages.
        if (
          payload?.type === "authenticated" ||
          payload?.type === "auth_success"
        ) {
          Logger.info("Mohini WS authenticated ✓ – ready signal fired", {
            phoneNumber,
          });
          _authResolve?.();
          // Fall through so _handleMohiniMessage also logs it via its own switch case
        }

        try {
          await this._handleMohiniMessage(phoneNumber, payload);
        } catch (err) {
          Logger.error("Error dispatching Mohini message", {
            phoneNumber,
            err: err.message,
          });
        }
      });

      // ── ERROR ────────────────────────────────────────────────────
      ws.on("error", (err) => {
        Logger.error("WebSocket error", { phoneNumber, error: err.message });
        activeConnections.delete(phoneNumber);
        clearInactivityTimer(phoneNumber);
        _authResolve?.(); // unblock any awaiter so it doesn't hang forever
        resolve({ success: false, error: err.message });
      });

      // ── CLOSE ────────────────────────────────────────────────────
      ws.on("close", async (code, reason) => {
        Logger.info("WebSocket closed", {
          phoneNumber,
          code,
          reason: reason.toString(),
        });
        activeConnections.delete(phoneNumber);
        clearInactivityTimer(phoneNumber);
        _authResolve?.();

        try {
          await usersQueries.update(
            { phoneNumber },
            { $set: { "scope.wsSession.status": "disconnected" } },
          );
        } catch (_) {}

        // ── Intentional close by _handleSessionEnd or closeConnection ─
        if (ws._intentionalClose) {
          return;
        }

        try {
          const user = await usersQueries.findOne({ phoneNumber });

          // Clean session end
          if (!user?.scope?.activeSession?.sessionId) {
            Logger.info(
              "WS closed after clean session end – no prompt needed",
              { phoneNumber },
            );
            return;
          }

          // Already showing a prompt — don't send another
          if (
            user?.scope?.wsSession?.awaitingReconnectResponse ||
            user?.scope?.wsSession?.awaitingInactivityResponse
          ) {
            return;
          }
        } catch (_) {}

        await this._sendReconnectPrompt(phoneNumber).catch(() => {});
      });

      // Timeout guard – if WS never opens within 20s
      setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) {
          ws.terminate();
          _authResolve?.(); // unblock any awaiter
          resolve({ success: false, error: "WebSocket timed out" });
        }
      }, 20000);
    });
  }

  // ─────────────────────────────────────────────────────────────────
  // 3.  Send user text over the open WS
  //     Resets the inactivity timer on every outgoing user message.
  // ─────────────────────────────────────────────────────────────────
  // sendMessage(phoneNumber, text) {
  //   const ws = activeConnections.get(phoneNumber);
  //   if (!ws || ws.readyState !== WebSocket.OPEN) {
  //     Logger.warn("sendMessage: no open WS", { phoneNumber });
  //     return false;
  //   }
  //   // User is active – reset the 15-min watchdog
  //   this.resetInactivityTimer(phoneNumber);

  //   const frame = JSON.stringify({ type: "message", text });
  //   ws.send(frame);
  //   Logger.debug("WS → Mohini", { phoneNumber, frame });
  //   return true;
  // }

  sendMessage(phoneNumber, text, { asrAudio = null, context = "" } = {}) {
    const ws = activeConnections.get(phoneNumber);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      Logger.warn("sendMessage: no open WS", { phoneNumber });
      return false;
    }

    this.resetInactivityTimer(phoneNumber);

    // Build frame — include asr_audio only when provided (audio messages)
    const frameObj = { type: "message", text, context };
    if (asrAudio) {
      frameObj.asr_audio = asrAudio;
    }

    const frame = JSON.stringify(frameObj);
    ws.send(frame);
    Logger.debug("WS → Mohini", { phoneNumber, frame });
    return true;
  }

  // ─────────────────────────────────────────────────────────────────
  // 4.  Send audio buffer over WS
  // ─────────────────────────────────────────────────────────────────
  sendAudio(phoneNumber, audioBuffer, mimeType = "audio/ogg") {
    const ws = activeConnections.get(phoneNumber);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      Logger.warn("sendAudio: no open WS", { phoneNumber });
      return false;
    }
    this.resetInactivityTimer(phoneNumber);
    ws.send(JSON.stringify({ type: "audio_start", mime_type: mimeType }));
    ws.send(audioBuffer);
    return true;
  }

  // ─────────────────────────────────────────────────────────────────
  // 5.  Close / terminate
  // ─────────────────────────────────────────────────────────────────
  async closeConnection(phoneNumber) {
    clearInactivityTimer(phoneNumber);
    const ws = activeConnections.get(phoneNumber);
    if (ws) {
      ws._intentionalClose = true; // ← tells close handler not to prompt
      ws.terminate();
      activeConnections.delete(phoneNumber);
      Logger.info("WS terminated", { phoneNumber });
    }
    try {
      await usersQueries.update(
        { phoneNumber },
        { $set: { "scope.wsSession.status": "disconnected" } },
      );
    } catch (_) {}
  }

  // ─────────────────────────────────────────────────────────────────
  // 6.  Guard used by flowRouter and messageController
  // ─────────────────────────────────────────────────────────────────
  isConnected(phoneNumber) {
    const ws = activeConnections.get(phoneNumber);
    return !!ws && ws.readyState === WebSocket.OPEN;
  }

  // ─────────────────────────────────────────────────────────────────
  // 7.  Reconnect to an existing Mohini session (req #2 – "Continue")
  //
  //     Re-opens the WS with the SAME sessionId / profileId already
  //     stored in scope.activeSession.  Mohini recognises the auth
  //     frame and continues the conversation from where it paused.
  // ─────────────────────────────────────────────────────────────────
  async reconnect(phoneNumber) {
    try {
      Logger.info("Reconnecting WS session", { phoneNumber });

      const user = await usersQueries.findOne({ phoneNumber });
      const session = user?.scope?.activeSession;

      const keys = [
        "noPreviousSession",
        "continueBtnText",
        "newChat",
        "sessionDiscontinue",
        "reconnectMessage",
      ];
      const selectedLanguageText = await languageService.tBatch(
        phoneNumber,
        keys,
      );

      // ── No session at all → nothing to reconnect to ──────────────
      // This should only happen if the user never started a session,
      // or Mohini confirmed COMPLETED and we cleanly unset activeSession.
      // It should NOT happen for an in-progress session regardless of age.
      if (!session?.sessionId) {
        await whatsappService.sendMessage(
          phoneNumber,
          `⚠️ ${selectedLanguageText.noPreviousSession}`,
        );
        return { success: false, error: "No session in DB" };
      }

      // ── Clear stale inactivity flag ──────────────────────────────
      await usersQueries
        .update(
          { phoneNumber },
          { $unset: { "scope.wsSession.awaitingInactivityResponse": "" } },
        )
        .catch(() => {});

      // ── WS already open → just reset timer ──────────────────────
      if (this.isConnected(phoneNumber)) {
        this.resetInactivityTimer(phoneNumber);
        await whatsappService.sendMessage(
          phoneNumber,
          "✅ Session is still active. Please continue.",
        );
        return { success: true };
      }

      // ── Re-open WS — no age check, session lives until COMPLETED ─
      // Mohini maintains session state on its end indefinitely.
      // We always attempt reconnect as long as activeSession exists in DB.
      Logger.info("reconnect: attempting openConnection", {
        phoneNumber,
        sessionId: session.sessionId,
        createdAt: session.createdAt,
      });

      const result = await this.openConnection(
        phoneNumber,
        true, // isReconnect = true → skip "enter your name" prompt
        session.sessionType,
      );

      if (!result.success) {
        // WS failed to open (network issue, Mohini down, etc.)
        // Show the reconnect/new prompt so user isn't stuck silently
        Logger.warn("reconnect: openConnection failed – offering prompt", {
          phoneNumber,
          error: result.error,
        });
        await this._sendReconnectPrompt(phoneNumber).catch(() => {});
        return { success: false, error: result.error };
      }

      return result;
    } catch (error) {
      Logger.error("reconnect failed", { phoneNumber, error: error.message });
      return { success: false, error: error.message };
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // 8.  Inactivity timer management (req #2)
  // ─────────────────────────────────────────────────────────────────

  /**
   * Start (or restart) the 15-minute inactivity watchdog for a user.
   * Call this whenever the USER sends a message over the WS.
   */
  resetInactivityTimer(phoneNumber) {
    clearInactivityTimer(phoneNumber);
    const timer = setTimeout(
      () => this._handleInactivityTimeout(phoneNumber),
      INACTIVITY_TIMEOUT_MS,
    );
    inactivityTimers.set(phoneNumber, timer);

    // Keep lastActivityAt fresh in MongoDB (best-effort)
    usersQueries
      .update(
        { phoneNumber },
        { $set: { "scope.wsSession.lastActivityAt": new Date() } },
      )
      .catch(() => {});
  }

  /**
   * Called when the 15-minute window expires without a user message.
   * We leave the WS open and ask the user what they want to do.
   */
  async _handleInactivityTimeout(phoneNumber) {
    inactivityTimers.delete(phoneNumber);
    Logger.info("Inactivity timeout – prompting user", { phoneNumber });

    if (!this.isConnected(phoneNumber)) return;

    // ── Don't interrupt voice confirmation or edit flow ───────────
    // User is mid-decision on a transcription — give them more time
    // by resetting the timer instead of showing the inactivity prompt.
    try {
      const lastMsg = await usersQueries.getLastMessage(phoneNumber);
      if (lastMsg?.flow === "voice_confirm" || lastMsg?.flow === "voice_edit") {
        Logger.info("Inactivity timeout during voice flow – extending timer", {
          phoneNumber,
          flow: lastMsg.flow,
        });
        this.resetInactivityTimer(phoneNumber);
        return;
      }
    } catch (_) {}

    const keys = [
      "inactiveSession",
      "reconnectPrompt",
      "continueBtnText",
      "newChat",
    ];
    const selectedLanguageText = await languageService.tBatch(
      phoneNumber,
      keys,
    );

    try {
      await usersQueries.update(
        { phoneNumber },
        { $set: { "scope.wsSession.awaitingInactivityResponse": true } },
      );

      await this.closeConnection(phoneNumber);

      await whatsappService.sendInteractiveMessage({
        to: phoneNumber,
        type: "button",
        body: {
          text:
            `⏰ ${selectedLanguageText.inactiveSession}.\n\n` +
            `${selectedLanguageText.reconnectPrompt}.\n\n`,
        },
        action: {
          buttons: [
            {
              type: "quick_reply",
              title: `▶️ ${selectedLanguageText.continueBtnText}`,
              id: "session_continue",
            },
            {
              type: "quick_reply",
              title: `🔄 ${selectedLanguageText.newChat}`,
              id: "session_new",
            },
          ],
        },
      });
    } catch (err) {
      Logger.error("_handleInactivityTimeout error", {
        phoneNumber,
        err: err.message,
      });
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // 9.  GET /api/companychat/?session=… → check last message status
  //     Returns true only when status === "COMPLETED" (req #4)
  // ─────────────────────────────────────────────────────────────────
  async checkSessionCompleted(sessionId) {
    try {
      const resp = await axios.get(`${MOHINI_BASE_URL}/api/companychat/`, {
        params: { session: sessionId },
        headers: {
          Accept: "application/json, text/plain, */*",
          Origin: process.env.ORIGIN_URL,
        },
        timeout: 15000,
      });

      const results = resp.data?.results;
      if (!Array.isArray(results) || results.length === 0) {
        Logger.warn("companychat: empty results", { sessionId });
        return false;
      }

      // The API returns messages in chronological order; inspect the last one.
      const lastMsg = results[results.length - 1];
      Logger.info("companychat last message", {
        sessionId,
        id: lastMsg?.id,
        status: lastMsg?.status,
        stage: lastMsg?.stage,
      });

      return lastMsg?.status === "COMPLETED";
    } catch (error) {
      Logger.error("checkSessionCompleted API failed", {
        sessionId,
        error: error.message,
        status: error.response?.status,
      });
      return false;
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // PRIVATE: Send reconnect-or-new-session interactive prompt
  // ─────────────────────────────────────────────────────────────────
  async _sendReconnectPrompt(phoneNumber) {
    const keys = [
      "sessionDiscontinue",
      "reconnectMessage",
      "continueBtnText",
      "newChat",
    ];
    const selectedLanguageText = await languageService.tBatch(
      phoneNumber,
      keys,
    );
    await usersQueries
      .update(
        { phoneNumber },
        { $set: { "scope.wsSession.awaitingReconnectResponse": true } },
      )
      .catch(() => {});
    await whatsappService.sendInteractiveMessage({
      to: phoneNumber,
      type: "button",
      body: {
        text:
          `⚠️ ${selectedLanguageText.sessionDiscontinue}.\n\n` +
          `${selectedLanguageText.reconnectMessage}.\n\n`,
      },
      action: {
        buttons: [
          {
            type: "quick_reply",
            title: `▶️ ${selectedLanguageText.continueBtnText}`,
            id: "session_continue",
          },
          {
            type: "quick_reply",
            title: `🔄 ${selectedLanguageText.newChat}`,
            id: "session_new",
          },
        ],
      },
    });
  }

  // ─────────────────────────────────────────────────────────────────
  // PRIVATE: Dispatch Mohini payload → WhatsApp
  //
  // Actual Mohini shape:
  //   { text: { msg: "...", source: "bot", finish_reason: "stop", step: 1, extra_content: null } }
  // ─────────────────────────────────────────────────────────────────
  async _handleMohiniMessage(phoneNumber, payload) {
    Logger.debug("Dispatching Mohini payload", { phoneNumber, payload });

    // ── PRIMARY: { text: { msg, step, source, finish_reason, ... } }
    if (
      payload.text &&
      typeof payload.text === "object" &&
      payload.text.msg !== undefined
    ) {
      const { msg, step, source, finish_reason, extra_content } = payload.text;

      Logger.info("Mohini bot message", {
        phoneNumber,
        step,
        source,
        finish_reason,
      });

      // Persist step / context
      try {
        const lastMessage = await usersQueries.getLastMessage(phoneNumber);
        await usersQueries.updateLastMessage(phoneNumber, {
          flow: lastMessage?.flow || "capture_discussion",
          step: step ?? lastMessage?.step ?? 0,
          context: {
            ...(lastMessage?.context || {}),
            mohiniStep: step,
            mohiniSource: source,
            lastBotMsg: msg,
          },
          text: lastMessage?.text || "",
        });
      } catch (dbErr) {
        Logger.error("Failed to persist Mohini step", {
          phoneNumber,
          dbErr: dbErr.message,
        });
      }

      if (msg && source === "bot") {
        await whatsappService.sendMessage(phoneNumber, msg);
      }

      if (extra_content && typeof extra_content === "object") {
        await this._handleExtraContent(phoneNumber, extra_content);
      }

      // ── SESSION COMPLETE DETECTION ────────────────────────────────
      // finish_reason === "stop" fires on EVERY bot turn (it just means
      if (source === "bot") {
        // Non-blocking – do not await so the WS message handler returns
        setImmediate(() => this._handleSessionEnd(phoneNumber));
      }

      return;
    }

    // ── LEGACY / OTHER SHAPES ──────────────────────────────────────
    switch (payload.type) {
      case "authenticated":
      case "auth_success":
        Logger.info("Mohini WS authenticated ✓", { phoneNumber });
        break;

      case "text":
      case "message":
      case "bot_response":
      case "response": {
        const text =
          payload.text ??
          payload.message ??
          payload.response ??
          payload.content;
        if (text && typeof text === "string") {
          await whatsappService.sendMessage(phoneNumber, text);
        }
        break;
      }

      case "options":
      case "choices": {
        const options = payload.options ?? payload.choices ?? [];
        const question = payload.question ?? payload.text ?? "Please select:";
        await this._sendOptions(phoneNumber, question, options);
        break;
      }

      // Explicit session_end from Mohini
      case "session_end":
      case "end":
      case "complete": {
        Logger.info("Mohini session_end received", { phoneNumber });

        // ── Check awaiting flags before acting ───────────────────────
        const user = await usersQueries.findOne({ phoneNumber });
        if (
          user?.scope?.wsSession?.awaitingReconnectResponse ||
          user?.scope?.wsSession?.awaitingInactivityResponse
        ) {
          Logger.info(
            "session_end received but user is on a prompt – skipping",
            {
              phoneNumber,
            },
          );
          return;
        }

        await usersQueries.update(
          { phoneNumber },
          { $unset: { "scope.activeSession": "" } },
        );

        await this.closeConnection(phoneNumber);

        try {
          const storyPostSessionService = require("./storyPostSessionService");
          await storyPostSessionService.startPostSession(
            phoneNumber,
            user?.scope?.activeSession,
          );
        } catch (err) {
          Logger.error("session_end post-session trigger failed", {
            phoneNumber,
            err: err.message,
          });
        }
        break;
      }

      case "error":
        Logger.error("Mohini error payload", { phoneNumber, payload });
        const keys = ["errorMessage"];
        const selectedLanguageText = await languageService.tBatch(
          phoneNumber,
          keys,
        );
        await whatsappService.sendMessage(
          phoneNumber,
          selectedLanguageText.errorMessage,
        );
        break;

      default: {
        Logger.warn("Unknown Mohini payload type", {
          phoneNumber,
          type: payload.type,
        });
        const fallback = payload.text ?? payload.message ?? payload.content;
        if (fallback && typeof fallback === "string") {
          await whatsappService.sendMessage(phoneNumber, fallback);
        }
        break;
      }
    }
  }

  async _handleSessionEnd(phoneNumber) {
    if (this._sessionEndInProgress.has(phoneNumber)) return;

    try {
      const user = await usersQueries.findOne({ phoneNumber });
      const session = user?.scope?.activeSession;
      if (!session?.sessionId) return;

      if (
        user?.scope?.wsSession?.awaitingReconnectResponse ||
        user?.scope?.wsSession?.awaitingInactivityResponse
      ) {
        return;
      }

      const isCompleted = await this.checkSessionCompleted(session.sessionId);
      if (!isCompleted) return;

      this._sessionEndInProgress.add(phoneNumber);

      Logger.info(
        "_handleSessionEnd: session COMPLETED – starting post-session",
        {
          phoneNumber,
          sessionId: session.sessionId,
        },
      );

      await usersQueries
        .update({ phoneNumber }, { $unset: { "scope.activeSession": "" } })
        .catch(() => {});

      // we are the ones closing it after a confirmed COMPLETED session.
      const ws = activeConnections.get(phoneNumber);
      if (ws) ws._intentionalClose = true;

      await this.closeConnection(phoneNumber);

      const storyPostSessionService = require("./storyPostSessionService");
      await storyPostSessionService.startPostSession(phoneNumber, session);
    } catch (err) {
      Logger.error("_handleSessionEnd error", {
        phoneNumber,
        err: err.message,
      });
    } finally {
      this._sessionEndInProgress.delete(phoneNumber);
    }
  }

  // PRIVATE: Handle extra_content alongside a bot message
  // ─────────────────────────────────────────────────────────────────
  async _handleExtraContent(phoneNumber, extra_content) {
    const options = extra_content.options ?? extra_content.choices ?? [];
    const question = extra_content.question ?? extra_content.text ?? "";
    if (options.length > 0) {
      await this._sendOptions(phoneNumber, question, options);
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // PRIVATE: Send options as WhatsApp buttons (≤3) or list (>3)
  // ─────────────────────────────────────────────────────────────────
  async _sendOptions(phoneNumber, question, options) {
    const toRow = (opt, i) => {
      const label =
        typeof opt === "string"
          ? opt
          : (opt.label ?? opt.text ?? `Option ${i + 1}`);
      const value = typeof opt === "string" ? opt : (opt.value ?? i);
      return { label, value };
    };

    if (options.length <= 3) {
      await whatsappService.sendInteractiveMessage({
        to: phoneNumber,
        type: "button",
        body: { text: question || "Please select:" },
        action: {
          buttons: options.map((opt, i) => {
            const { label, value } = toRow(opt, i);
            return {
              type: "quick_reply",
              title: label.substring(0, 20),
              id: `mohini_opt_${i}_${value}`,
            };
          }),
        },
      });
    } else {
      await whatsappService.sendInteractiveMessage({
        to: phoneNumber,
        type: "list",
        body: { text: question || "Please select:" },
        action: {
          button: "Select",
          sections: [
            {
              title: "Options",
              rows: options.map((opt, i) => {
                const { label, value } = toRow(opt, i);
                return {
                  id: `mohini_opt_${i}_${value}`,
                  title: label.substring(0, 24),
                };
              }),
            },
          ],
        },
      });
    }
  }

  clearInactivityTimerForPhone(phoneNumber) {
    clearInactivityTimer(phoneNumber);
  }
  getActiveWs(phoneNumber) {
    return activeConnections.get(phoneNumber) || null;
  }
}

module.exports = new SessionService();
