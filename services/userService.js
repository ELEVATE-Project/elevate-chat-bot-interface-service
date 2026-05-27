// ============================================
// FILE: services/userService.js  (UPDATED)
// ============================================
const Logger = require("../utils/logger");
const usersQueries = require("../database/databaseQueries/userQueries");
const whatsappService = require("./whatsappService");
const languageService = require("./languageService");

class UserService {
  // ─────────────────────────────────────────
  // Check if user exists and is active
  // ─────────────────────────────────────────
  async checkUserExists(phoneNumber) {
    try {
      const users = await usersQueries.usersDocuments({
        phoneNumber,
        status: "active",
      });
      if (users && users.length > 0) {
        return { success: true, data: users[0] };
      }
      return { success: false };
    } catch (error) {
      if (error.response?.status === 404) return { success: false };
      Logger.error("Error checking user existence", error);
      throw error;
    }
  }

  // ─────────────────────────────────────────
  // Create a minimal user skeleton on first contact
  // ─────────────────────────────────────────
  async createUser(phoneNumber, name, firstMessage = "") {
    try {
      let user = await usersQueries.findOne({ phoneNumber });

      if (!user) {
        user = await usersQueries.create({
          phoneNumber,
          name,
          firstMessage,
          firstMessageAt: new Date(),
          lastInteractionAt: new Date(),
          isRegistered: false,
          status: "active",
          scope: {},
          registrationProgress: "awaiting_language",
        });
        Logger.info("New user created", { phoneNumber, userId: user._id });
      }

      return { success: true, data: user };
    } catch (error) {
      Logger.error("Failed to create user", error);
      return { success: false, error: error.message };
    }
  }

  // ─────────────────────────────────────────
  // MAIN ENTRY POINT
  // Called by flowRouter when no other route matches,
  // or directly for the very first message.
  //
  // State machine:
  //   Step 1 – No user in DB           → create + show language picker
  //   Step 2 – User, no language set   → show language picker
  //   Step 3 – User, language set      → show translated main menu
  //   Step 4 – Active WS session       → forward to sessionService
  // ─────────────────────────────────────────
  async handleUserMessage(message) {
    try {
      const phoneNumber = message.from;
      const senderName = message.pushName || message.from_name || "Friend";
      const messageText = message.text?.body?.trim() || "";

      // ── STEP 1 & 2: Check existence ──────────────────────────
      const userCheck = await this.checkUserExists(phoneNumber);

      if (!userCheck.success) {
        // Brand-new user – create skeleton then ask for language
        Logger.info("New user – creating record", { phoneNumber });
        await this.createUser(phoneNumber, senderName, messageText);

        // await whatsappService.sendMessage(
        //   phoneNumber,
        //   `👋 Hi *${senderName}*, welcome to *Mitra Bot*!`
        // );

        const langMsg = languageService.buildLanguageSelectionMessage(phoneNumber);
        await whatsappService.sendInteractiveMessage(langMsg);

        return { success: true, handled: true, stage: "language_selection" };
      }

      const user = userCheck.data;

      // ── STEP 2: Existing user but no language chosen ──────────
      if (!user.scope?.language) {
        Logger.info("User has no language – prompting selection", { phoneNumber });

        const langMsg = languageService.buildLanguageSelectionMessage(phoneNumber);
        await whatsappService.sendInteractiveMessage(langMsg);

        return { success: true, handled: true, stage: "language_selection" };
      }

      // ── STEP 3: Language set – show translated main menu ──────
      Logger.info("User ready – showing main menu", {
        phoneNumber,
        language: user.scope.language,
      });

      await usersQueries.clearLastMessage(phoneNumber);

      const mainMenuMsg = await languageService.buildMainMenuMessage(phoneNumber);
      await whatsappService.sendInteractiveMessage(mainMenuMsg);

      return { success: true, handled: true, stage: "main_menu" };
    } catch (error) {
      Logger.error("Error in handleUserMessage", error);
      try {
        await whatsappService.sendMessage(
          message.from,
          "❌ Something went wrong. Please try again."
        );
      } catch (_) {}
      return { success: false, handled: true, error: error.message };
    }
  }

  // ─────────────────────────────────────────
  // Convenience helpers (unchanged from original)
  // ─────────────────────────────────────────
  async getUserByPhone(phoneNumber) {
    try {
      return await usersQueries.findOne({ phoneNumber });
    } catch (error) {
      Logger.error("Error fetching user", error);
      throw error;
    }
  }

  async updateUser(phoneNumber, updateData) {
    try {
      Logger.info("Updating user", { phoneNumber });
      return await usersQueries.update(
        { phoneNumber },
        { $set: updateData },
        { new: true }
      );
    } catch (error) {
      Logger.error("Failed to update user", error);
      throw error;
    }
  }
}

module.exports = new UserService();