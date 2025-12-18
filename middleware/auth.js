const { auth } = require('firebase-admin');
const User = require('../models/User');

const authMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'No token provided',
        code: 'NO_TOKEN'
      });
    }

    const token = authHeader.split(' ')[1];
    const decodedToken = await auth().verifyIdToken(token);
    
    // Get user from database
    const user = await User.findById(decodedToken.uid);
    if (!user) {
      return res.status(401).json({
        error: 'User not found',
        code: 'USER_NOT_FOUND'
      });
    }

    // Check if user is active
    if (!user.isActive) {
      return res.status(403).json({
        error: 'Account deactivated',
        code: 'ACCOUNT_DEACTIVATED'
      });
    }

    // Attach user to request
    req.user = user.toJSON();
    req.user.uid = decodedToken.uid;
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    
    if (error.code === 'auth/id-token-expired') {
      return res.status(401).json({
        error: 'Token expired',
        code: 'TOKEN_EXPIRED'
      });
    }
    
    if (error.code === 'auth/id-token-revoked') {
      return res.status(401).json({
        error: 'Token revoked',
        code: 'TOKEN_REVOKED'
      });
    }

    res.status(401).json({
      error: 'Invalid token',
      code: 'INVALID_TOKEN'
    });
  }
};

const adminMiddleware = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({
      error: 'Admin access required',
      code: 'ADMIN_REQUIRED'
    });
  }
  next();
};

const studentMiddleware = (req, res, next) => {
  if (!req.user || req.user.role !== 'student') {
    return res.status(403).json({
      error: 'Student access required',
      code: 'STUDENT_REQUIRED'
    });
  }
  next();
};

module.exports = {
  authMiddleware,
  adminMiddleware,
  studentMiddleware
};