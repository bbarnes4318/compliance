const winston = require('winston');
const path = require('path');

// Create logs directory if it doesn't exist
const logDir = path.join(process.cwd(), 'logs');
require('fs').mkdirSync(logDir, { recursive: true });

// Define log format
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.json(),
  winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
    const logObject = {
      timestamp,
      level: level.toUpperCase(),
      message,
      ...meta
    };
    
    if (stack) {
      logObject.stack = stack;
    }
    
    return JSON.stringify(logObject);
  })
);

// Console format for development
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
    let logMessage = `${timestamp} ${level}: ${message}`;
    
    if (Object.keys(meta).length > 0) {
      logMessage += ` ${JSON.stringify(meta)}`;
    }
    
    if (stack) {
      logMessage += `\n${stack}`;
    }
    
    return logMessage;
  })
);

// Create logger instance
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  defaultMeta: { 
    service: 'medicare-compliance',
    environment: process.env.NODE_ENV || 'development'
  },
  transports: [
    // Error log file
    new winston.transports.File({
      filename: path.join(logDir, 'error.log'),
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
      tailable: true
    }),
    
    // Combined log file
    new winston.transports.File({
      filename: path.join(logDir, 'combined.log'),
      maxsize: 5242880, // 5MB
      maxFiles: 10,
      tailable: true
    }),
    
    // Audit log for compliance events
    new winston.transports.File({
      filename: path.join(logDir, 'audit.log'),
      level: 'info',
      maxsize: 10485760, // 10MB
      maxFiles: 20,
      tailable: true,
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      )
    })
  ],
  
  // Handle uncaught exceptions
  exceptionHandlers: [
    new winston.transports.File({
      filename: path.join(logDir, 'exceptions.log'),
      maxsize: 5242880,
      maxFiles: 5
    })
  ],
  
  // Handle unhandled rejections
  rejectionHandlers: [
    new winston.transports.File({
      filename: path.join(logDir, 'rejections.log'),
      maxsize: 5242880,
      maxFiles: 5
    })
  ]
});

// Add console transport for non-production environments
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: consoleFormat,
    level: 'debug'
  }));
}

// Compliance audit logger
const auditLogger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  defaultMeta: {
    service: 'compliance-audit',
    environment: process.env.NODE_ENV || 'development'
  },
  transports: [
    new winston.transports.File({
      filename: path.join(logDir, 'compliance-audit.log'),
      maxsize: 20971520, // 20MB
      maxFiles: 50,
      tailable: true
    })
  ]
});

// Security logger for sensitive operations
const securityLogger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  defaultMeta: {
    service: 'security',
    environment: process.env.NODE_ENV || 'development'
  },
  transports: [
    new winston.transports.File({
      filename: path.join(logDir, 'security.log'),
      maxsize: 20971520, // 20MB
      maxFiles: 100,
      tailable: true
    })
  ]
});

// Helper functions for structured logging
const logHelpers = {
  // Log compliance events
  compliance: (action, details, userId = null) => {
    auditLogger.info('COMPLIANCE_EVENT', {
      action,
      details,
      userId,
      timestamp: new Date().toISOString(),
      sessionId: details.sessionId || null
    });
  },
  
  // Log security events
  security: (event, details, severity = 'INFO') => {
    securityLogger.log(severity.toLowerCase(), 'SECURITY_EVENT', {
      event,
      details,
      severity,
      timestamp: new Date().toISOString(),
      userAgent: details.userAgent || null,
      ipAddress: details.ipAddress || null
    });
  },
  
  // Log FWA events
  fwa: (type, details, confidence = null) => {
    auditLogger.warn('FWA_EVENT', {
      type,
      details,
      confidence,
      timestamp: new Date().toISOString(),
      requiresReview: confidence > 0.7
    });
  },
  
  // Log consent events
  consent: (action, consentId, beneficiaryId, details = {}) => {
    auditLogger.info('CONSENT_EVENT', {
      action,
      consentId,
      beneficiaryId,
      details,
      timestamp: new Date().toISOString(),
      cmsCompliant: details.cmsCompliant || false
    });
  },
  
  // Log document events
  document: (action, documentId, userId, details = {}) => {
    auditLogger.info('DOCUMENT_EVENT', {
      action,
      documentId,
      userId,
      details,
      timestamp: new Date().toISOString(),
      retentionCompliant: true
    });
  },
  
  // Log screening events
  screening: (action, employeeId, results, severity = 'INFO') => {
    auditLogger.log(severity.toLowerCase(), 'SCREENING_EVENT', {
      action,
      employeeId,
      results,
      timestamp: new Date().toISOString(),
      exclusionFound: results.exclusionFound || false
    });
  }
};

// Express middleware for request logging
const requestLogger = (req, res, next) => {
  const start = Date.now();
  
  // Log request
  logger.info('HTTP_REQUEST', {
    method: req.method,
    url: req.originalUrl,
    userAgent: req.get('User-Agent'),
    ipAddress: req.ip,
    userId: req.user?.id || null
  });
  
  // Log response
  res.on('finish', () => {
    const duration = Date.now() - start;
    
    logger.info('HTTP_RESPONSE', {
      method: req.method,
      url: req.originalUrl,
      statusCode: res.statusCode,
      duration,
      userId: req.user?.id || null
    });
    
    // Log security events for sensitive endpoints
    if (req.originalUrl.includes('/consent') || req.originalUrl.includes('/screening')) {
      logHelpers.security('API_ACCESS', {
        endpoint: req.originalUrl,
        method: req.method,
        statusCode: res.statusCode,
        userAgent: req.get('User-Agent'),
        ipAddress: req.ip,
        userId: req.user?.id || null
      }, res.statusCode >= 400 ? 'WARN' : 'INFO');
    }
  });
  
  next();
};

// Error logger middleware
const errorLogger = (err, req, res, next) => {
  logger.error('HTTP_ERROR', {
    message: err.message,
    stack: err.stack,
    method: req.method,
    url: req.originalUrl,
    userAgent: req.get('User-Agent'),
    ipAddress: req.ip,
    userId: req.user?.id || null
  });
  
  // Log security events for authentication/authorization errors
  if (err.status === 401 || err.status === 403) {
    logHelpers.security('AUTH_FAILURE', {
      endpoint: req.originalUrl,
      method: req.method,
      error: err.message,
      userAgent: req.get('User-Agent'),
      ipAddress: req.ip
    }, 'WARN');
  }
  
  next(err);
};

module.exports = {
  logger,
  auditLogger,
  securityLogger,
  logHelpers,
  requestLogger,
  errorLogger
};