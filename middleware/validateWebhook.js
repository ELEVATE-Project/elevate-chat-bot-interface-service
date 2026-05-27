// ============================================
// FILE: middleware/validateWebhook.js
// ============================================
const config = require('../config/config');
const Logger = require('../utils/logger');

/**
 * Validate webhook authenticity (optional)
 */
const validateWebhook = (req, res, next) => {
  // If webhook secret is configured, validate it
  if (config.webhook.secret) {
    const signature = req.headers['x-webhook-signature'];
    
    if (!signature || signature !== config.webhook.secret) {
      Logger.warn('Invalid webhook signature', { ip: req.ip });
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  next();
};

module.exports = validateWebhook;