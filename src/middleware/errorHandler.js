const { logger, logHelpers } = require('../utils/logger');

// Main error handler middleware
const errorHandler = (err, req, res, next) => {
  // Log the error
  logger.error('Unhandled error:', {
    message: err.message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
    userId: req.user?.id,
    ipAddress: req.ip,
    userAgent: req.get('User-Agent')
  });

  // Default error response
  let status = err.status || err.statusCode || 500;
  let message = err.message || 'Internal Server Error';
  let errorCode = err.code || 'INTERNAL_ERROR';

  // Handle specific error types
  if (err.name === 'ValidationError') {
    status = 400;
    message = 'Validation failed';
    errorCode = 'VALIDATION_ERROR';
    
    if (err.errors) {
      message = Object.values(err.errors).map(e => e.message).join(', ');
    }
  }
  
  if (err.name === 'SequelizeValidationError') {
    status = 400;
    message = 'Database validation failed';
    errorCode = 'DB_VALIDATION_ERROR';
    
    if (err.errors) {
      message = err.errors.map(e => `${e.path}: ${e.message}`).join(', ');
    }
  }
  
  if (err.name === 'SequelizeUniqueConstraintError') {
    status = 409;
    message = 'Resource already exists';
    errorCode = 'DUPLICATE_RESOURCE';
  }
  
  if (err.name === 'SequelizeForeignKeyConstraintError') {
    status = 400;
    message = 'Invalid reference to related resource';
    errorCode = 'INVALID_REFERENCE';
  }
  
  if (err.name === 'JsonWebTokenError') {
    status = 401;
    message = 'Invalid authentication token';
    errorCode = 'INVALID_TOKEN';
  }
  
  if (err.name === 'TokenExpiredError') {
    status = 401;
    message = 'Authentication token expired';
    errorCode = 'TOKEN_EXPIRED';
  }
  
  if (err.code === 'ENOENT') {
    status = 404;
    message = 'Resource not found';
    errorCode = 'RESOURCE_NOT_FOUND';
  }
  
  if (err.code === 'EACCES') {
    status = 403;
    message = 'Access denied';
    errorCode = 'ACCESS_DENIED';
  }

  // Don't expose internal error details in production
  if (process.env.NODE_ENV === 'production' && status === 500) {
    message = 'Internal Server Error';
  }

  // Security-related errors
  if (status === 401 || status === 403) {
    logHelpers.security('ERROR_RESPONSE', {
      errorCode,
      status,
      endpoint: req.originalUrl,
      method: req.method,
      userId: req.user?.id,
      ipAddress: req.ip
    }, 'WARN');
  }

  // Compliance-related errors
  if (req.originalUrl.includes('/consent') || 
      req.originalUrl.includes('/fwa') || 
      req.originalUrl.includes('/screening')) {
    logHelpers.compliance('ERROR_OCCURRED', {
      endpoint: req.originalUrl,
      errorCode,
      status,
      message
    }, req.user?.id);
  }

  const errorResponse = {
    error: {
      code: errorCode,
      message,
      status,
      timestamp: new Date().toISOString(),
      path: req.originalUrl,
      method: req.method
    }
  };

  // Include additional details in development
  if (process.env.NODE_ENV === 'development') {
    errorResponse.error.stack = err.stack;
    errorResponse.error.details = err.details || null;
  }

  // Include request ID if available
  if (req.requestId) {
    errorResponse.error.requestId = req.requestId;
  }

  res.status(status).json(errorResponse);
};

// 404 handler
const notFoundHandler = (req, res) => {
  const message = `Route ${req.originalUrl} not found`;
  
  logger.warn('Route not found:', {
    url: req.originalUrl,
    method: req.method,
    userId: req.user?.id,
    ipAddress: req.ip,
    userAgent: req.get('User-Agent')
  });

  res.status(404).json({
    error: {
      code: 'ROUTE_NOT_FOUND',
      message,
      status: 404,
      timestamp: new Date().toISOString(),
      path: req.originalUrl,
      method: req.method
    }
  });
};

// Async error wrapper
const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

module.exports = {
  errorHandler,
  notFoundHandler,
  asyncHandler
};