const express = require('express');
const bcrypt = require('bcrypt');
const { body, validationResult } = require('express-validator');
const { Employee } = require('../models/Employee');
const { generateToken, generateRefreshToken, verifyRefreshToken } = require('../middleware/auth');
const { logger, logHelpers } = require('../utils/logger');

const router = express.Router();

// Login endpoint
router.post('/login', [
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { email, password } = req.body;

    // Find user
    const user = await Employee.findOne({ 
      where: { email },
      paranoid: false // Include soft-deleted records
    });

    if (!user) {
      logHelpers.security('LOGIN_FAILED_USER_NOT_FOUND', {
        email,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      }, 'WARN');

      return res.status(401).json({
        error: 'Invalid credentials'
      });
    }

    // Check if account is active
    if (user.status !== 'ACTIVE') {
      logHelpers.security('LOGIN_FAILED_INACTIVE_ACCOUNT', {
        userId: user.id,
        status: user.status,
        ipAddress: req.ip
      }, 'WARN');

      return res.status(403).json({
        error: 'Account not active',
        message: `Account status: ${user.status}`
      });
    }

    // Check if account is locked
    if (user.isAccountLocked()) {
      logHelpers.security('LOGIN_FAILED_ACCOUNT_LOCKED', {
        userId: user.id,
        lockExpires: user.lock_expires,
        ipAddress: req.ip
      }, 'WARN');

      return res.status(423).json({
        error: 'Account locked',
        message: 'Account is temporarily locked due to failed login attempts',
        lockExpires: user.lock_expires
      });
    }

    // Verify password
    const isValidPassword = await user.validatePassword(password);
    if (!isValidPassword) {
      await user.incrementFailedLogins();
      
      logHelpers.security('LOGIN_FAILED_INVALID_PASSWORD', {
        userId: user.id,
        failedAttempts: user.failed_login_attempts + 1,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      }, 'WARN');

      return res.status(401).json({
        error: 'Invalid credentials'
      });
    }

    // Check if user is excluded
    if (user.excluded_status) {
      logHelpers.security('LOGIN_FAILED_EXCLUDED_USER', {
        userId: user.id,
        exclusionDetails: user.exclusion_details,
        ipAddress: req.ip
      }, 'ERROR');

      return res.status(403).json({
        error: 'Access denied',
        message: 'User is on exclusion list'
      });
    }

    // Update last login
    await user.updateLastLogin();

    // Generate tokens
    const token = generateToken(user);
    const refreshToken = generateRefreshToken(user);

    logHelpers.security('LOGIN_SUCCESSFUL', {
      userId: user.id,
      role: user.role,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    }, 'INFO');

    res.json({
      success: true,
      token,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role,
        department: user.department,
        twoFactorEnabled: user.two_factor_enabled
      }
    });

  } catch (error) {
    logger.error('Login error:', error);
    res.status(500).json({
      error: 'Login failed',
      message: 'Internal server error'
    });
  }
});

// Refresh token endpoint
router.post('/refresh', [
  body('refreshToken').notEmpty().withMessage('Refresh token required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { refreshToken } = req.body;

    // Verify refresh token
    const decoded = verifyRefreshToken(refreshToken);
    
    // Get user
    const user = await Employee.findByPk(decoded.userId);
    
    if (!user || user.status !== 'ACTIVE') {
      return res.status(401).json({
        error: 'Invalid refresh token'
      });
    }

    // Generate new tokens
    const newToken = generateToken(user);
    const newRefreshToken = generateRefreshToken(user);

    logHelpers.security('TOKEN_REFRESHED', {
      userId: user.id,
      ipAddress: req.ip
    }, 'INFO');

    res.json({
      success: true,
      token: newToken,
      refreshToken: newRefreshToken
    });

  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return res.status(401).json({
        error: 'Invalid refresh token'
      });
    }

    logger.error('Token refresh error:', error);
    res.status(500).json({
      error: 'Token refresh failed'
    });
  }
});

// Logout endpoint
router.post('/logout', async (req, res) => {
  try {
    // In a more sophisticated system, you would blacklist the token
    // For now, we'll just log the logout event
    
    const userId = req.user?.id;
    
    if (userId) {
      logHelpers.security('LOGOUT', {
        userId,
        ipAddress: req.ip
      }, 'INFO');
    }

    res.json({
      success: true,
      message: 'Logged out successfully'
    });

  } catch (error) {
    logger.error('Logout error:', error);
    res.status(500).json({
      error: 'Logout failed'
    });
  }
});

// Get current user profile
router.get('/me', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        error: 'Authentication required'
      });
    }

    const user = await Employee.findByPk(req.user.id, {
      attributes: { exclude: ['password_hash', 'two_factor_secret'] }
    });

    res.json({
      success: true,
      user
    });

  } catch (error) {
    logger.error('Get profile error:', error);
    res.status(500).json({
      error: 'Failed to get user profile'
    });
  }
});

// Change password
router.post('/change-password', [
  body('currentPassword').notEmpty().withMessage('Current password required'),
  body('newPassword').isLength({ min: 8 }).withMessage('New password must be at least 8 characters'),
  body('confirmPassword').custom((value, { req }) => {
    if (value !== req.body.newPassword) {
      throw new Error('Password confirmation does not match');
    }
    return true;
  })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    if (!req.user) {
      return res.status(401).json({
        error: 'Authentication required'
      });
    }

    const { currentPassword, newPassword } = req.body;
    const user = await Employee.findByPk(req.user.id);

    // Verify current password
    const isValidPassword = await user.validatePassword(currentPassword);
    if (!isValidPassword) {
      logHelpers.security('PASSWORD_CHANGE_FAILED_INVALID_CURRENT', {
        userId: user.id,
        ipAddress: req.ip
      }, 'WARN');

      return res.status(401).json({
        error: 'Invalid current password'
      });
    }

    // Update password
    user.password_hash = newPassword; // Will be hashed in beforeUpdate hook
    await user.save();

    logHelpers.security('PASSWORD_CHANGED', {
      userId: user.id,
      ipAddress: req.ip
    }, 'INFO');

    res.json({
      success: true,
      message: 'Password changed successfully'
    });

  } catch (error) {
    logger.error('Change password error:', error);
    res.status(500).json({
      error: 'Failed to change password'
    });
  }
});

module.exports = router;