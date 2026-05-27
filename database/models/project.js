// ============================================
// FILE: database/models/Project.js
// ============================================
const mongoose = require("mongoose");

const ProjectSchema = new mongoose.Schema(
  {
    // Project info from API
    projectId: {
      type: String,
      required: true,
      index: true,
    },
    projectName: {
      type: String,
      required: true,
    },
    solutionId: {
      type: String,
    },
    programId: {
      type: String,
    },

    // User info
    phoneNumber: {
      type: String,
      required: true,
      index: true,
    },
    userId: {
      type: String,
    },

    // Project data
    projectData: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },

    // Task progress tracking
    tasks: [
      {
        taskId: String,
        taskName: String,
        status: {
          type: String,
          enum: ["notStarted", "inProgress", "completed"],
          default: "notStarted",
        },
        endDate: Date,
        evidence: [
          {
           
          },
        ],
      },
    ],

    // Submission tracking
    submissionStatus: {
      type: String,
      enum: ["draft", "submitted", "approved"],
      default: "draft",
    },
    submittedAt: Date,
    lastSyncedAt: Date,

    // Certificate info
    certificate: {
      earned: {
        type: Boolean,
        default: false,
      },
      url: String,
      downloadUrl: String,
      earnedAt: Date,
    },

    // Metadata
    createdAt: {
      type: Date,
      default: Date.now,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    collection: "projects",
  }
);

// Index for quick lookups
ProjectSchema.index({ phoneNumber: 1, projectId: 1 });
ProjectSchema.index({ submissionStatus: 1 });

module.exports = mongoose.model("Project", ProjectSchema);