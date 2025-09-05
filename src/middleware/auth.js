const jwt = require('jsonwebtoken');
const { Employee } = require('../models/Employee');
const { logger, logHelpers } = require('../utils/logger');

// JWT authentication middleware
const authenticate = async (req, res, next) => {
  try {
    const token = extractToken(req);
    
    if (!token) {
      logHelpers.security('MISSING_TOKEN', {
        endpoint: req.originalUrl,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      }, 'WARN');
      
      return res.status(401).json({
        error: 'Authentication required',
        message: 'Please provide a valid authentication token'
      });
    }
    
    // Verify JWT token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Get user from database
    const user = await Employee.findByPk(decoded.userId, {
      attributes: { exclude: ['password_hash'] }
    });
    
    if (!user) {
      logHelpers.security('INVALID_TOKEN_USER', {
        userId: decoded.userId,
        endpoint: req.originalUrl,
        ipAddress: req.ip
      }, 'WARN');
      
      return res.status(401).json({
        error: 'Invalid token',
        message: 'User not found'
      });
    }
    
    // Check if user account is active
    if (user.status !== 'ACTIVE') {
      logHelpers.security('INACTIVE_USER_ACCESS', {
        userId: user.id,
        status: user.status,
        endpoint: req.originalUrl,
        ipAddress: req.ip
      }, 'WARN');
      
      return res.status(403).json({
        error: 'Account inactive',
        message: `Account status: ${user.status}`
      });
    }
    
    // Check if user is excluded
    if (user.excluded_status) {
      logHelpers.security('EXCLUDED_USER_ACCESS', {
        userId: user.id,
        exclusionDetails: user.exclusion_details,
        endpoint: req.originalUrl,
        ipAddress: req.ip
      }, 'ERROR');
      
      return res.status(403).json({
        error: 'Access denied',
        message: 'User is on exclusion list'
      });
    }
    
    // Check if account is locked
    if (user.isAccountLocked()) {
      logHelpers.security('LOCKED_ACCOUNT_ACCESS', {
        userId: user.id,
        lockExpires: user.lock_expires,
        endpoint: req.originalUrl,
        ipAddress: req.ip
      }, 'WARN');
      
      return res.status(423).json({
        error: 'Account locked',
        message: 'Account is temporarily locked due to multiple failed login attempts'
      });
    }
    
    // Attach user to request
    req.user = user;
    req.tokenPayload = decoded;
    
    // Update last activity
    user.updateLastLogin().catch(err => 
      logger.error('Error updating last login:', err)
    );
    
    logHelpers.security('SUCCESSFUL_AUTH', {
      userId: user.id,
      role: user.role,
      endpoint: req.originalUrl,
      ipAddress: req.ip
    });
    
    next();
    
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      logHelpers.security('INVALID_JWT_TOKEN', {
        error: error.message,
        endpoint: req.originalUrl,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      }, 'WARN');
      
      return res.status(401).json({
        error: 'Invalid token',
        message: 'Authentication token is invalid'
      });
    }
    
    if (error.name === 'TokenExpiredError') {
      logHelpers.security('EXPIRED_JWT_TOKEN', {
        expiredAt: error.expiredAt,
        endpoint: req.originalUrl,
        ipAddress: req.ip
      }, 'INFO');
      
      return res.status(401).json({
        error: 'Token expired',
        message: 'Authentication token has expired'
      });
    }
    
    logger.error('Authentication error:', error);
    res.status(500).json({
      error: 'Authentication failed',
      message: 'Internal server error during authentication'
    });
  }
};

// Role-based authorization middleware
const authorize = (allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'Authentication required'
      });
    }
    
    const userRole = req.user.role;
    
    if (!allowedRoles.includes(userRole)) {
      logHelpers.security('UNAUTHORIZED_ACCESS', {
        userId: req.user.id,
        userRole,
        allowedRoles,
        endpoint: req.originalUrl,
        ipAddress: req.ip
      }, 'WARN');
      
      return res.status(403).json({
        error: 'Insufficient permissions',
        message: `Role '${userRole}' is not authorized for this resource`
      });
    }
    
    next();
  };
};

// Compliance role authorization
const requireComplianceRole = authorize([
  'COMPLIANCE_OFFICER', 
  'ADMIN', 
  'AUDITOR'
]);

// Management role authorization
const requireManagerRole = authorize([
  'MANAGER', 
  'COMPLIANCE_OFFICER', 
  'ADMIN'
]);

// Admin role authorization
const requireAdminRole = authorize(['ADMIN']);

// Two-factor authentication check
const requireTwoFactor = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      error: 'Authentication required'
    });
  }
  
  // Skip 2FA for non-sensitive operations in development
  if (process.env.NODE_ENV === 'development' && !process.env.ENFORCE_2FA) {
    return next();
  }
  
  if (!req.user.two_factor_enabled) {
    logHelpers.security('2FA_NOT_ENABLED', {
      userId: req.user.id,
      endpoint: req.originalUrl,
      ipAddress: req.ip
    }, 'WARN');
    
    return res.status(403).json({
      error: 'Two-factor authentication required',
      message: 'Please enable 2FA to access this resource'
    });
  }
  
  // Check if 2FA was verified in this session
  if (!req.tokenPayload.twoFactorVerified) {
    return res.status(403).json({
      error: 'Two-factor verification required',
      message: 'Please verify your 2FA code'
    });
  }
  
  next();
};

// Rate limiting for sensitive operations
const sensitiveOperationLimiter = (req, res, next) => {
  // This would integrate with rate limiting middleware
  // For now, we'll just log the sensitive operation
  
  logHelpers.security('SENSITIVE_OPERATION', {
    userId: req.user?.id,
    operation: req.originalUrl,
    method: req.method,
    ipAddress: req.ip,
    userAgent: req.get('User-Agent')
  }, 'INFO');
  
  next();
};

// Extract token from request
const extractToken = (req) => {
  // Check Authorization header
  const authHeader = req.get('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  
  // Check query parameter (less secure, but sometimes needed)
  if (req.query.token) {
    return req.query.token;
  }
  
  // Check cookies
  if (req.cookies && req.cookies.authToken) {
    return req.cookies.authToken;
  }
  
  return null;
};

// Generate JWT token
const generateToken = (user, options = {}) => {
  const payload = {
    userId: user.id,
    email: user.email,
    role: user.role,
    department: user.department,
    twoFactorVerified: options.twoFactorVerified || false
  };
  
  const tokenOptions = {
    expiresIn: process.env.JWT_EXPIRY || '24h',
    issuer: 'medicare-compliance-system',
    audience: 'compliance-users'
  };
  
  return jwt.sign(payload, process.env.JWT_SECRET, tokenOptions);
};

// Generate refresh token
const generateRefreshToken = (user) => {
  const payload = {
    userId: user.id,
    type: 'refresh'
  };
  
  const tokenOptions = {
    expiresIn: process.env.REFRESH_TOKEN_EXPIRY || '7d',
    issuer: 'medicare-compliance-system'
  };
  
  return jwt.sign(payload, process.env.REFRESH_TOKEN_SECRET, tokenOptions);
};

// Verify refresh token
const verifyRefreshToken = (token) => {
  return jwt.verify(token, process.env.REFRESH_TOKEN_SECRET);
};

// Compliance data access authorization
const authorizeDataAccess = (dataType) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    const userClearance = req.user.clearance_level;
    const requiredClearance = getRequiredClearance(dataType);
    
    if (!hasRequiredClearance(userClearance, requiredClearance)) {
      logHelpers.security('INSUFFICIENT_CLEARANCE', {
        userId: req.user.id,
        userClearance,
        requiredClearance,
        dataType,
        endpoint: req.originalUrl,
        ipAddress: req.ip
      }, 'WARN');
      
      return res.status(403).json({
        error: 'Insufficient clearance level',
        message: `${requiredClearance} clearance required for ${dataType} data`
      });
    }
    
    next();
  };
};

// Helper functions
const getRequiredClearance = (dataType) => {
  const clearanceMap = {
    'beneficiary_data': 'CONFIDENTIAL',
    'employee_data': 'INTERNAL',
    'financial_data': 'CONFIDENTIAL',
    'audit_data': 'RESTRICTED',
    'system_config': 'RESTRICTED'
  };
  
  return clearanceMap[dataType] || 'INTERNAL';
};

const hasRequiredClearance = (userLevel, requiredLevel) => {
  const levels = ['PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED'];
  const userIndex = levels.indexOf(userLevel);
  const requiredIndex = levels.indexOf(requiredLevel);
  
  return userIndex >= requiredIndex;
};

module.exports = {
  authenticate,
  authorize,
  requireComplianceRole,
  requireManagerRole,
  requireAdminRole,
  requireTwoFactor,
  sensitiveOperationLimiter,
  authorizeDataAccess,
  generateToken,
  generateRefreshToken,
  verifyRefreshToken,
  extractToken
};