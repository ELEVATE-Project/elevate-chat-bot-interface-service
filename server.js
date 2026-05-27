// ============================================
// FILE: server.js
// ============================================
const app = require("./app");
const config = require("./config/config");
const Logger = require("./utils/logger");
const database = require("./config/db");
const inactivityReminderService = require("./services/inactivityReminderService"); // ADD THIS LINE

// Validate required environment variables
const validateConfig = () => {
  const required = ["WHAPI_TOKEN", "MONGODB_URL"];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    Logger.error("Missing required environment variables", { missing });
    process.exit(1);
  }
};

/**
 * Initialize database collections
 */
const initializeDatabase = async () => {
  try {
    // Create collections if they don't exist
    const collections = await database.db.db.listCollections().toArray();
    const collectionNames = collections.map((col) => col.name);

    // Check if users collection exists
    if (!collectionNames.includes("users")) {
      Logger.info("Creating users collection...");
      await database.db.db.createCollection("users");
      Logger.info("Users collection created successfully");
    }

    Logger.info("Database initialized", {
      database: database.db.name,
      collections: collectionNames,
    });
  } catch (error) {
    Logger.error("Error initializing database", error);
  }
};

// Start server
const startServer = async () => {
  try {
    validateConfig();

    // Connect to MongoDB (this will auto-load all models)
    await database.connect();

    // Initialize database and collections
    await initializeDatabase();

    // Start Express server
    const server = app.listen(config.port, () => {
      Logger.info("Server started successfully", {
        port: config.port,
        environment: process.env.NODE_ENV || "development",
        webhookUrl: `/webhook/whatsapp`,
        database: database.isConnected() ? "connected" : "disconnected",
        modelsLoaded: Object.keys(database.models),
      });
    
       // ============================================
      // START INACTIVITY REMINDER JOB
      // ============================================
      // inactivityReminderService.startInactivityReminderJob();
    });

    // Graceful shutdown
    const shutdown = async (signal) => {
      Logger.info(`${signal} received, shutting down gracefully`);

      server.close(async () => {
        Logger.info("HTTP server closed");

        await database.disconnect();

        Logger.info("Application shut down successfully");
        process.exit(0);
      });

      // Force shutdown after 10 seconds
      setTimeout(() => {
        Logger.error("Forced shutdown after timeout");
        process.exit(1);
      }, 10000);
    };

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
  } catch (error) {
    Logger.error("Failed to start server", error);
    process.exit(1);
  }
};

startServer();
