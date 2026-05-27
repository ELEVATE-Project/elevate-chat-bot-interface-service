



// ============================================
//  inactivityReminderService.js
// ============================================

const Logger = require("../utils/logger");
const usersQueries = require("../database/databaseQueries/userQueries");
const whatsappService = require("./whatsappService");

// FIXED: Adjusted timings for testing (change back after)
const INACTIVITY_THRESHOLD = 1 * 60 * 1000; // 1 minute for testing
const REMINDER_INTERVAL = 2 * 60 * 1000; // Send reminder every 2 minutes (don't spam)
const CHECK_INTERVAL = 30 * 1000; // Check every 30 seconds

const activeReminders = new Map();

class InactivityReminderService {
  /**
   * Track user activity and update lastInteractionAt
   */
  static async trackUserActivity(phoneNumber) {
    try {
      await usersQueries.update(
        { phoneNumber },
        {
          $set: {
            lastInteractionAt: new Date(),
            "lastMessage.updatedAt": new Date(),
          },
        },
        { new: true }
      );

      // Clear any pending reminders for this user
      if (activeReminders.has(phoneNumber)) {
        clearTimeout(activeReminders.get(phoneNumber).timeout);
        activeReminders.delete(phoneNumber);
      }

      Logger.info("✅ User activity tracked", { phoneNumber });
    } catch (error) {
      Logger.error("❌ Error tracking user activity", error);
    }
  }

  /**
   * Send inactivity reminder to user
   */
  static async sendInactivityReminder(phoneNumber) {
    try {
      const user = await usersQueries.findOne({ phoneNumber });

      if (!user || user.status !== "active") {
        Logger.warn("User not found or inactive, skipping reminder", {
          phoneNumber,
        });
        return;
      }

      Logger.info("📤 Sending reminder to user", { phoneNumber });

      // Send reminder message with action button
      await whatsappService.sendInteractiveMessage({
        to: phoneNumber,
        type: "button",
        body: {
          text: "👋 *Project Update Reminder*\n\nYou've been inactive for a while. Would you like to:\n• Check your project status\n• Update your project\n• Continue working",
        },
        action: {
          buttons: [
            {
              type: "quick_reply",
              title: "✏️ Update Project",
              id: "update_existing_project",
            },

            {
                type: "quick_reply",
                title: "🏠 Main Menu",
                id: "main_menu",
              },
            {
              type: "quick_reply",
              title: "❌ Dismiss",
              id: "dismiss_reminder",
            },
          ],
        },
      });

      Logger.info("✅ Inactivity reminder sent successfully", { phoneNumber });

      // Update metadata
      const remindersCount = (user.metadata?.remindersCount || 0) + 1;

      await usersQueries.update(
        { phoneNumber },
        {
          $set: {
            "metadata.lastReminderSentAt": new Date(),
            "metadata.remindersCount": remindersCount,
          },
        }
      );

      Logger.info("📊 Reminder metadata updated", {
        phoneNumber,
        remindersCount,
      });
    } catch (error) {
      Logger.error("❌ Error sending inactivity reminder", error);
    }
  }

  /**
   * Check if user is inactive and send reminder if needed
   */
  static async checkAndRemindInactiveUsers() {
    try {
      const inactiveThresholdTime = new Date(Date.now() - INACTIVITY_THRESHOLD);

      Logger.info("🔍 Starting inactivity check...", {
        threshold: inactiveThresholdTime,
      });

      // FIXED: Removed the flow requirement - check ALL active users
      const inactiveUsers = await usersQueries.usersDocuments(
        {
          status: "active",
          lastInteractionAt: { $lt: inactiveThresholdTime },
          isRegistered: true,
        },
        ["phoneNumber", "lastInteractionAt", "metadata"]
      );

      Logger.info("📋 Found inactive users", {
        count: inactiveUsers.length,
        threshold: inactiveThresholdTime,
      });

      if (inactiveUsers.length === 0) {
        Logger.info("✅ No inactive users found");
        return { success: true, processedCount: 0 };
      }

      for (const user of inactiveUsers) {
        const lastReminderTime = user.metadata?.lastReminderSentAt
          ? new Date(user.metadata.lastReminderSentAt)
          : null;

        const timeSinceLastReminder = lastReminderTime
          ? Date.now() - lastReminderTime.getTime()
          : null;

        const inactivityDuration = Date.now() - new Date(user.lastInteractionAt).getTime();

        Logger.info("👤 Checking user", {
          phoneNumber: user.phoneNumber,
          inactiveForMs: inactivityDuration,
          inactiveForMins: Math.round(inactivityDuration / 60000),
          lastReminderSentAt: lastReminderTime,
          timeSinceLastReminderMs: timeSinceLastReminder,
        });

        // Send reminder if not sent in last REMINDER_INTERVAL
        if (!timeSinceLastReminder || timeSinceLastReminder > REMINDER_INTERVAL) {
          Logger.info("⏰ Sending reminder - conditions met", {
            phoneNumber: user.phoneNumber,
            timeSinceLastReminder,
          });
          await this.sendInactivityReminder(user.phoneNumber);
        } else {
          Logger.info("⏭️ Skipping reminder - sent too recently", {
            phoneNumber: user.phoneNumber,
            timeSinceLastReminder,
            reminderInterval: REMINDER_INTERVAL,
          });
        }
      }

      return { success: true, processedCount: inactiveUsers.length };
    } catch (error) {
      Logger.error("❌ Error checking inactive users", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Start the inactivity reminder background job
   */
  static startInactivityReminderJob() {
    Logger.info("🚀 Starting inactivity reminder job", {
      checkInterval: CHECK_INTERVAL,
      reminderInterval: REMINDER_INTERVAL,
      inactivityThreshold: INACTIVITY_THRESHOLD,
    });

    // Run check immediately on startup
    this.checkAndRemindInactiveUsers();

    // Then run periodically
    const intervalId = setInterval(() => {
      this.checkAndRemindInactiveUsers();
    }, CHECK_INTERVAL);

    Logger.info("✅ Inactivity reminder job started successfully", {
      intervalId,
    });

    // Return interval ID so you can stop it if needed
    return intervalId;
  }

  /**
   * Handle reminder dismissal
   */
  static async handleReminderDismissal(phoneNumber) {
    try {
      await usersQueries.update(
        { phoneNumber },
        {
          $set: {
            "metadata.lastReminderDismissedAt": new Date(),
          },
        }
      );

      Logger.info("User dismissed reminder", { phoneNumber });
    } catch (error) {
      Logger.error("Error handling reminder dismissal", error);
    }
  }

  /**
   * Get inactivity stats for a user
   */
  static async getUserInactivityStats(phoneNumber) {
    try {
      const user = await usersQueries.findOne(
        { phoneNumber },
        { lastInteractionAt: 1, metadata: 1 }
      );

      if (!user) {
        return null;
      }

      const timeSinceLastInteraction =
        Date.now() - new Date(user.lastInteractionAt).getTime();
      const isInactive = timeSinceLastInteraction > INACTIVITY_THRESHOLD;

      return {
        phoneNumber,
        lastInteractionAt: user.lastInteractionAt,
        timeSinceLastInteractionMs: timeSinceLastInteraction,
        timeSinceLastInteractionMins: Math.round(
          timeSinceLastInteraction / 60000
        ),
        isInactive,
        remindersCount: user.metadata?.remindersCount || 0,
        lastReminderSentAt: user.metadata?.lastReminderSentAt || null,
      };
    } catch (error) {
      Logger.error("Error getting inactivity stats", error);
      return null;
    }
  }

  /**
   * Reset reminders for a user (when they become active)
   */
  static async resetReminderCount(phoneNumber) {
    try {
      await usersQueries.update(
        { phoneNumber },
        {
          $set: {
            "metadata.remindersCount": 0,
            "metadata.lastReminderDismissedAt": null,
          },
        }
      );

      Logger.info("Reminder count reset", { phoneNumber });
    } catch (error) {
      Logger.error("Error resetting reminder count", error);
    }
  }
}

module.exports = InactivityReminderService;