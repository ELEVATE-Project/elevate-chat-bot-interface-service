// ============================================
// FILE: services/storyService.js
// ============================================
const Logger = require("../utils/logger");
const usersQueries = require("../database/databaseQueries/userQueries");
const whatsappService = require("./whatsappService");

const STORY_RECORDING_URL =   `${process.env.BACKEND_API_URL}/mohini/home`;

class StoryService {
  /**
   * Start story recording flow
   */
  static async startStoryRecording(phoneNumber) {
    try {

      await usersQueries.updateLastMessage(phoneNumber, {
        flow: "story_recording",
        step: 0,
        context: {},
        text: "record_story",
      });

      // Send story recording prompt with URL button
      await whatsappService.sendInteractiveMessage({
        to: phoneNumber,
        type: "button",
        body: {
          text: "📚 *Record Your Story*\n\nClick the button below to record your story:",
        },
        action: {
          buttons: [
            {
              type: "url",
              title: "🎙️ Record Story",
              id: "open_recording_link",
              url: STORY_RECORDING_URL,
            },
          ],
        },
      });


      // Wait 20 seconds, then show post-recording options
      setTimeout(async () => {
        try {
          await this.showPostRecordingMenu(phoneNumber);
        } catch (error) {
          Logger.error("Error showing post-recording menu", error);
        }
      }, 500000); // 20 seconds

    } catch (error) {
      Logger.error("Error starting story recording", error);
      await whatsappService.sendMessage(
        phoneNumber,
        "❌ Error starting story recording. Please try again."
      );
      await usersQueries.clearLastMessage(phoneNumber);
    }
  }

  /**
   * Show menu after story recording (wait for user to complete recording)
   */
  static async showPostRecordingMenu(phoneNumber) {
    try {

      await usersQueries.updateLastMessage(phoneNumber, {
        flow: "story_recording",
        step: 1,
        context: {},
        text: "post_recording",
      });

      // Send post-recording options
      await whatsappService.sendInteractiveMessage({
        to: phoneNumber,
        type: "button",
        body: {
          text: "✅ *Story Recording Complete!*\n\nWould you like to record another story or go back to menu?",
        },
        action: {
          buttons: [
            {
              type: "quick_reply",
              title: "🎙️ Record Another Story",
              id: "record_another_story",
            },
            {
              type: "quick_reply",
              title: "🏠 Back to Main Menu",
              id: "main_menu",
            },
          ],
        },
      });

    } catch (error) {
      Logger.error("Error showing post-recording menu", error);
      await whatsappService.sendMessage(
        phoneNumber,
        "❌ Error loading menu. Please try again."
      );
    }
  }

  /**
   * Handle record another story action
   */
  static async handleRecordAnotherStory(phoneNumber) {
    try {

      // Clear previous context and restart
      await usersQueries.clearLastMessage(phoneNumber);

      // Restart the recording flow
      await this.startStoryRecording(phoneNumber);
    } catch (error) {
      Logger.error("Error handling record another story", error);
      await whatsappService.sendMessage(
        phoneNumber,
        "❌ Error starting new recording. Please try again."
      );
    }
  }

  /**
   * Handle story recording flow continuation (if needed for text input)
   */
  static async handleStoryRecordingFlow(phoneNumber, messageText, lastMessage) {
    try {
      const step = lastMessage?.step || 0;

      if (step === 0) {
        // User at recording screen - acknowledge
        await whatsappService.sendMessage(
          phoneNumber,
          "🎙️ Recording in progress... Use the link above to record your story."
        );
      } else if (step === 1) {
        // User at post-recording menu
        await whatsappService.sendMessage(
          phoneNumber,
          "Please select an option from the menu above."
        );
      }
    } catch (error) {
      Logger.error("Error in story recording flow", error);
      await whatsappService.sendMessage(
        phoneNumber,
        "❌ Error in story flow. Please try again."
      );
    }
  }
}

module.exports = StoryService;