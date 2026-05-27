// ============================================
// FILE: middleware/errorHandler.js
// ============================================
const Logger = require('../utils/logger');

const errorHandler = (err, req, res, next) => {
  Logger.error('Unhandled error', err);

  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  res.status(statusCode).json({
    status: 'error',
    statusCode,
    message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
};

module.exports = errorHandler;
