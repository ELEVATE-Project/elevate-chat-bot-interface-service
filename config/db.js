const mongoose = require('mongoose');
const config = require('./config');
const Logger = require('../utils/logger');

/**
 * Database connection and model management
 * Following ELEVATE pattern
 */
class Database {
  constructor() {
    this.db = null;
    this.models = {}; // Store all models here
  }

  /**
   * Connect to MongoDB
   */
  async connect() {
    try {
      if (this.db) {
        Logger.warn('Database already connected');
        return this.db;
      }

      Logger.info('Connecting to MongoDB...', { 
        url: config.mongodb.url.replace(/\/\/.*@/, '//***@') 
      });

      const options = {
        useNewUrlParser: true,
        useUnifiedTopology: true,
      };

      await mongoose.connect(config.mongodb.url, options);
      this.db = mongoose.connection;

      Logger.info('MongoDB connected successfully', {
        host: this.db.host,
        database: this.db.name
      });

      // Handle connection events
      this.db.on('error', (error) => {
        Logger.error('MongoDB connection error', error);
      });

      this.db.on('disconnected', () => {
        Logger.warn('MongoDB disconnected');
      });

      this.db.on('reconnected', () => {
        Logger.info('MongoDB reconnected');
      });

      // Load all models after connection
      this.loadModels();

      return this.db;
    } catch (error) {
      Logger.error('Failed to connect to MongoDB', error);
      throw error;
    }
  }

  /**
   * Load all models from models directory
   */
  loadModels() {
    const fs = require('fs');
    const path = require('path');
    
    const modelsPath = path.join(__dirname, '../database/models');
    
    // Get all JavaScript files except index.js
    const modelFiles = fs.readdirSync(modelsPath)
      .filter(file => file !== 'index.js' && file.endsWith('.js'));

    modelFiles.forEach(file => {
      try {
        const modelName = path.basename(file, '.js');
        const model = require(path.join(modelsPath, file));
        
        // Store model in models object
        this.models[modelName] = model;
        
        Logger.info(`Model loaded: ${modelName}`, { 
          collection: model.collection.name 
        });
      } catch (error) {
        Logger.error(`Failed to load model: ${file}`, error);
      }
    });
  }

  /**
   * Disconnect from MongoDB
   */
  async disconnect() {
    try {
      if (this.db) {
        await mongoose.disconnect();
        this.db = null;
        Logger.info('MongoDB disconnected successfully');
      }
    } catch (error) {
      Logger.error('Error disconnecting from MongoDB', error);
      throw error;
    }
  }
  

  /**
   * Check if database is connected
   */
  isConnected() {
    return mongoose.connection.readyState === 1;
  }
}



// Export singleton instance
const database = new Database();
module.exports = database;