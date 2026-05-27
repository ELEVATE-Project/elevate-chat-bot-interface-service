const mongoose = require("mongoose");
const Schema = mongoose.Schema;

/**
 * User Data Schema
 * Following ELEVATE project pattern
 */
const usersSchema = new Schema(
  {
    phoneNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },

    name: {
      type: String,
      required: true,
      trim: true,
    },

    password: {
      type: String,
      required: false,
      select: false,
    },

    files: {
      type: Array,
      default: [],
    },

    // 👇 Flow/session tracking
    lastMessage: {
      text: { type: String },
      flow: { type: String }, // e.g. "update_project", "registration"
      step: { type: Number, default: 0 },
      context: { type: Object, default: {} },
      updatedAt: { type: Date, default: Date.now },
    },

    scope: {
      type: Object,
      default: {},
    },

    source: {
      type: String,
      default: "whatsapp",
      enum: ["whatsapp", "api", "manual"],
    },

    status: {
      type: String,
      default: "active",
      enum: ["active", "inactive", "blocked"],
    },

    firstMessage: {
      type: String,
      default: "",
    },

    firstMessageAt: {
      type: Date,
    },

    // 👇 INACTIVITY TRACKING FIELDS
    lastInteractionAt: {
      type: Date,
      default: Date.now,
      index: true,
    },

    metadata: {
      type: Schema.Types.Mixed,
      default: {
        // Inactivity reminder fields
        lastReminderSentAt: null,
        remindersCount: 0,
        lastReminderDismissedAt: null,
      },
    },

    createdAt: {
      type: Date,
      default: Date.now,
      index: true,
    },

    updatedAt: {
      type: Date,
      default: Date.now,
    },

    registrationStep: { type: String, default: null },

    registrationData: {
      type: Schema.Types.Mixed,
      default: {
        name: null,
        stakeholderType: null,
        state: null,
        district: null,
        block: null,
        cluster: null,
        udise: null,
      },
    },

    isRegistered: { type: Boolean, default: false },
  },
  {
    timestamps: true,
    collection: "users",
  }
);

// Indexes
usersSchema.index({ phoneNumber: 1 });
usersSchema.index({ status: 1 });
usersSchema.index({ createdAt: -1 });
usersSchema.index({ lastInteractionAt: -1 }); // For inactivity queries
usersSchema.index({ "lastMessage.flow": 1 }); // For flow tracking queries

// Pre-save hook to update updatedAt
usersSchema.pre("save", function (next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model("users", usersSchema);