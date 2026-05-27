// ============================================
// FILE: config/config.js
// ============================================
require('dotenv').config();

module.exports = {
  port: process.env.PORT || 3000,
  whapi: {
    token: process.env.WHAPI_TOKEN,
    channel: process.env.WHAPI_CHANNEL || 'default',
    baseUrl: 'https://gate.whapi.cloud',
  },
  mongodb: {
    url: process.env.MONGODB_URL || 'mongodb://localhost:27017/whatsapp_service',
  },
  backend: {
    apiUrl: process.env.BACKEND_API_URL,
    apiKey: process.env.BACKEND_API_KEY,
  },
  webhook: {
    secret: process.env.WEBHOOK_SECRET, // Optional: for webhook validation
  },
  
};