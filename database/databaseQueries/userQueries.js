// ============================================
// FILE: database/databaseQueries/userQueries.js
// ============================================
const database = require("../../config/db");

module.exports = class users {
  /**
   * Find single user
   */
  static findOne(query = {}, projection = {}) {
    return new Promise(async (resolve, reject) => {
      try {
        let userDocument = await database.models.user
          .findOne(query, projection)
          .lean();
        return resolve(userDocument);
      } catch (error) {
        return reject(error);
      }
    });
  }

  /**
   * Find users
   */
  static usersDocuments(
    usersFilter = "all",
    fieldsArray = "all",
    sortedData = "all",
    skipFields = "none"
  ) {
    return new Promise(async (resolve, reject) => {
      try {
        let queryObject = usersFilter != "all" ? usersFilter : {};
        let projection = {};

        if (fieldsArray != "all") {
          fieldsArray.forEach((field) => {
            projection[field] = 1;
          });
        }

        if (skipFields !== "none") {
          skipFields.forEach((field) => {
            projection[field] = 0;
          });
        }

        let usersDocuments;

        if (sortedData !== "all") {
          usersDocuments = await database.models.user
            .find(queryObject, projection)
            .sort(sortedData)
            .lean();
        } else {
          usersDocuments = await database.models.user
            .find(queryObject, projection)
            .lean();
        }

        return resolve(usersDocuments);
      } catch (error) {
        return resolve({
          success: false,
          message: error.message,
          data: false,
        });
      }
    });
  }

  /**
   * Update many users
   */
  static updateMany(query, update) {
    return new Promise(async (resolve, reject) => {
      try {
        let usersDocuments = await database.models.user.updateMany(query, update);
        return resolve(usersDocuments);
      } catch (error) {
        return reject(error);
      }
    });
  }

  /**
   * Update user
   */
  static update(query, updateObject, returnData = { new: false }) {
    return new Promise(async (resolve, reject) => {
      try {
        let usersDocuments = await database.models.user
          .findOneAndUpdate(query, updateObject, returnData)
          .lean();
        return resolve(usersDocuments);
      } catch (error) {
        return reject(error);
      }
    });
  }

  /**
   * Create user
   */
  static create(usersData) {
    return new Promise(async (resolve, reject) => {
      try {
        let usersDocument = await database.models.user.create(usersData);
        return resolve(usersDocument);
      } catch (error) {
        return reject(error);
      }
    });
  }

  // ============================================================
  // 👇 FLOW / SESSION TRACKING HELPERS
  // ============================================================

  /**
   * Update or save last message (flow/session data)
   * @param {String} phoneNumber
   * @param {Object} messageData { text, flow, step, context }
   */
  static async updateLastMessage(phoneNumber, messageData = {}) {
    const updateData = {
      "lastMessage.text": messageData.text || "",
      "lastMessage.flow": messageData.flow || "",
      "lastMessage.step": messageData.step ?? 0,
      "lastMessage.context": messageData.context || {},
      "lastMessage.updatedAt": new Date(),
      lastInteractionAt: new Date(),
    };
    const phoneNumberStr = phoneNumber.toString();
    return await database.models.user.findOneAndUpdate(
      { phoneNumber:phoneNumberStr },
      { $set: updateData },
      { new: true, upsert: true }
    ).lean();
  }

  /**
   * Get last message (flow/session data)
   * @param {String} phoneNumber
   */
  static async getLastMessage(phoneNumber) {
    const user = await database.models.user.findOne(
      { phoneNumber },
      { lastMessage: 1, name: 1 ,wsSession: 1}
    ).lean();
    return user?.lastMessage || null;
  }

  /**
   * Clear last message (reset session)
   * @param {String} phoneNumber
   */
  static async clearLastMessage(phoneNumber) {
    const resetData = {
      "lastMessage.text": "",
      "lastMessage.flow": "",
      "lastMessage.step": 0,
      "lastMessage.context": {},
      "lastMessage.updatedAt": new Date(),
    };

    return await database.models.user.findOneAndUpdate(
      { phoneNumber },
      { $set: resetData },
      { new: true }
    ).lean();
  }
}