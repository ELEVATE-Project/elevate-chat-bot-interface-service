// ============================================
// FILE: app.js - UPDATED WITH MCP ROUTES
// ============================================
const express = require('express');
const webhookRoutes = require('./routes/webhookRoutes');
const mcpRoutes = require('./routes/mcpRoutes');
const errorHandler = require('./middleware/errorHandler');
const Logger = require('./utils/logger');

const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req, res, next) => {
  Logger.debug(`${req.method} ${req.path}`, {
    query: req.query,
    body: req.body
  });
  next();
});

// ============================================
// ROUTES
// ============================================

// Webhook routes (existing)
app.use(process.env.BASE_ROUTE || '/webhook', webhookRoutes);

// MCP Service routes (new - for separate MCP server)
app.use('/mcp', mcpRoutes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    service: 'WhatsApp Webhook Service',
    status: 'running',
    version: '1.0.0',
    endpoints: {
      webhook: `POST ${process.env.BASE_ROUTE || "Not set"}`,
      mcp: 'POST /mcp/:toolName',
      health: 'GET /webhook/health'
    }
  });
});

// Health check for bot
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'whatsapp-bot',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Error handler (must be last)
app.use(errorHandler);

module.exports = app;