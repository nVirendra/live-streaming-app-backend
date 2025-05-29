// backend/middleware/auth.js

const jwt = require('jsonwebtoken');
const User = require('../models/User');

/**
 * Authentication middleware to verify JWT tokens
 * Extracts token from Authorization header and verifies it
 * Adds user information to req.user for use in routes
 */
const auth = async (req, res, next) => {
  try {
    // Get token from header
    const authHeader = req.header('Authorization');
    
    if (!authHeader) {
      return res.status(401).json({
        success: false,
        message: 'No token provided, authorization denied'
      });
    }

    // Check if token starts with 'Bearer '
    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token format. Use: Bearer <token>'
      });
    }

    // Extract token (remove 'Bearer ' prefix)
    const token = authHeader.substring(7);

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'No token provided, authorization denied'
      });
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Find user by ID from token
    const user = await User.findById(decoded.id).select('-password');
    
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Token is valid but user not found'
      });
    }

    // Check if user account is active (optional)
    if (user.isBlocked || user.isDeleted) {
      return res.status(401).json({
        success: false,
        message: 'User account is not active'
      });
    }

    // Add user to request object
    req.user = user;
    req.token = token;
    
    next();

  } catch (error) {
    console.error('Auth middleware error:', error);

    // Handle specific JWT errors
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token'
      });
    }

    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token has expired'
      });
    }

    if (error.name === 'NotBeforeError') {
      return res.status(401).json({
        success: false,
        message: 'Token not active yet'
      });
    }

    // Generic server error
    res.status(500).json({
      success: false,
      message: 'Server error during authentication'
    });
  }
};

/**
 * Optional authentication middleware
 * Does not return error if no token provided, but sets req.user if valid token exists
 * Useful for routes that work for both authenticated and non-authenticated users
 */
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.header('Authorization');
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      // No token provided, continue without authentication
      req.user = null;
      return next();
    }

    const token = authHeader.substring(7);
    
    if (!token) {
      req.user = null;
      return next();
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Find user by ID from token
    const user = await User.findById(decoded.id).select('-password');
    
    if (user && !user.isBlocked && !user.isDeleted) {
      req.user = user;
      req.token = token;
    } else {
      req.user = null;
    }

    next();

  } catch (error) {
    // On error, continue without authentication
    req.user = null;
    next();
  }
};

/**
 * Role-based authorization middleware
 * Requires user to be authenticated and have specific role
 */
const requireRole = (role) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    if (req.user.role !== role) {
      return res.status(403).json({
        success: false,
        message: `Access denied. ${role} role required`
      });
    }

    next();
  };
};

/**
 * Streamer authorization middleware
 * Requires user to be authenticated and have streamer privileges
 */
const requireStreamer = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required'
    });
  }

  if (!req.user.isStreamer) {
    return res.status(403).json({
      success: false,
      message: 'Streamer privileges required'
    });
  }

  next();
};

/**
 * Admin authorization middleware
 * Requires user to be authenticated and be an admin
 */
const requireAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required'
    });
  }

  if (!req.user.isAdmin) {
    return res.status(403).json({
      success: false,
      message: 'Admin privileges required'
    });
  }

  next();
};

/**
 * Owner authorization middleware
 * Requires user to be the owner of the resource or an admin
 * Use with route parameters like /users/:userId
 */
const requireOwnerOrAdmin = (paramName = 'userId') => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const resourceUserId = req.params[paramName];
    
    // Allow if user is admin or owns the resource
    if (req.user.isAdmin || req.user._id.toString() === resourceUserId) {
      return next();
    }

    return res.status(403).json({
      success: false,
      message: 'Access denied. You can only access your own resources'
    });
  };
};

/**
 * Stream owner authorization middleware
 * Requires user to be the owner of the stream
 */
const requireStreamOwner = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const streamId = req.params.streamId || req.params.id;
    
    if (!streamId) {
      return res.status(400).json({
        success: false,
        message: 'Stream ID required'
      });
    }

    // Import Stream model (avoid circular dependency)
    const Stream = require('../models/Stream');
    const stream = await Stream.findById(streamId);

    if (!stream) {
      return res.status(404).json({
        success: false,
        message: 'Stream not found'
      });
    }

    // Check if user owns the stream or is admin
    if (stream.streamer.toString() !== req.user._id.toString() && !req.user.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only manage your own streams'
      });
    }

    // Add stream to request for use in route handler
    req.stream = stream;
    next();

  } catch (error) {
    console.error('Stream owner check error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during authorization'
    });
  }
};

/**
 * Rate limiting middleware for authentication attempts
 * Prevents brute force attacks on login endpoints
 */
const loginRateLimit = (req, res, next) => {
  // This would typically use Redis or memory store
  // For now, we'll use a simple in-memory approach
  const attempts = global.loginAttempts || new Map();
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  const windowMs = 15 * 60 * 1000; // 15 minutes
  const maxAttempts = 5;

  // Clean up old attempts
  for (const [key, data] of attempts.entries()) {
    if (now - data.firstAttempt > windowMs) {
      attempts.delete(key);
    }
  }

  const userAttempts = attempts.get(ip);

  if (userAttempts) {
    if (userAttempts.count >= maxAttempts) {
      const timeLeft = Math.ceil((userAttempts.firstAttempt + windowMs - now) / 1000 / 60);
      return res.status(429).json({
        success: false,
        message: `Too many login attempts. Try again in ${timeLeft} minutes.`
      });
    }
    userAttempts.count++;
  } else {
    attempts.set(ip, {
      count: 1,
      firstAttempt: now
    });
  }

  global.loginAttempts = attempts;
  next();
};

/**
 * Middleware to verify API key for webhook endpoints
 */
const verifyApiKey = (req, res, next) => {
  const apiKey = req.header('X-API-Key');
  
  if (!apiKey) {
    return res.status(401).json({
      success: false,
      message: 'API key required'
    });
  }

  if (apiKey !== process.env.API_KEY) {
    return res.status(401).json({
      success: false,
      message: 'Invalid API key'
    });
  }

  next();
};

/**
 * Middleware to extract user info from token without requiring authentication
 * Useful for analytics and logging
 */
const extractUserInfo = async (req, res, next) => {
  try {
    const authHeader = req.header('Authorization');
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      req.userInfo = null;
      return next();
    }

    const token = authHeader.substring(7);
    
    if (!token) {
      req.userInfo = null;
      return next();
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userInfo = {
      userId: decoded.id,
      username: decoded.username,
      isStreamer: decoded.isStreamer
    };

    next();

  } catch (error) {
    req.userInfo = null;
    next();
  }
};

module.exports = {
  auth,
  optionalAuth,
  requireRole,
  requireStreamer,
  requireAdmin,
  requireOwnerOrAdmin,
  requireStreamOwner,
  loginRateLimit,
  verifyApiKey,
  extractUserInfo
};