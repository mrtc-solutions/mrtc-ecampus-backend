/**
 * Authentication Middleware - Updated for Firebase + Google Drive
 * Verifies JWT tokens and attaches user context to requests
 */

const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const admin = require('firebase-admin');

/**
 * ✅ MAIN AUTH MIDDLEWARE
 * Verifies Firebase ID token and loads user data
 */
const authMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'No token provided',
        code: 'NO_TOKEN',
        message: 'Authorization token is required'
      });
    }

    // Extract token
    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    try {
      // Verify Firebase ID token
      const decodedToken = await getAuth().verifyIdToken(token);
      
      // Get user from Firestore
      const db = getFirestore();
      const userDoc = await db.collection('users').doc(decodedToken.uid).get();
      
      if (!userDoc.exists) {
        return res.status(401).json({
          success: false,
          error: 'User not found',
          code: 'USER_NOT_FOUND',
          message: 'User does not exist in the system'
        });
      }

      const userData = userDoc.data();

      // Check if user is active
      if (userData.isActive === false) {
        return res.status(403).json({
          success: false,
          error: 'Account deactivated',
          code: 'ACCOUNT_DEACTIVATED',
          message: 'Your account has been deactivated'
        });
      }

      // Attach complete user context to request
      req.user = {
        uid: decodedToken.uid,
        email: decodedToken.email,
        displayName: userData.displayName || decodedToken.name,
        photoURL: userData.photoURL,
        role: userData.role || 'student',
        isActive: userData.isActive,
        emailVerified: decodedToken.email_verified,
        createdAt: userData.createdAt,
        ...userData // Include all user data
      };

      // Set token for downstream services
      req.token = token;
      req.decodedToken = decodedToken;

      console.log(`✅ Auth successful for user: ${req.user.email} (${req.user.role})`);
      next();

    } catch (tokenError) {
      // Handle specific token errors
      if (tokenError.code === 'auth/id-token-expired') {
        return res.status(401).json({
          success: false,
          error: 'Token expired',
          code: 'TOKEN_EXPIRED',
          message: 'Your session has expired. Please login again.'
        });
      }
      
      if (tokenError.code === 'auth/id-token-revoked') {
        return res.status(401).json({
          success: false,
          error: 'Token revoked',
          code: 'TOKEN_REVOKED',
          message: 'Your token has been revoked'
        });
      }

      if (tokenError.code === 'auth/argument-error') {
        return res.status(401).json({
          success: false,
          error: 'Invalid token format',
          code: 'INVALID_TOKEN_FORMAT',
          message: 'The provided token is malformed'
        });
      }

      throw tokenError;
    }

  } catch (error) {
    console.error('❌ Auth middleware error:', error);
    
    return res.status(401).json({
      success: false,
      error: 'Authentication failed',
      code: 'AUTH_FAILED',
      message: error.message
    });
  }
};

/**
 * ✅ ADMIN-ONLY MIDDLEWARE
 * Checks if user has admin role
 */
const adminMiddleware = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      error: 'Not authenticated',
      code: 'NOT_AUTHENTICATED'
    });
  }

  if (req.user.role !== 'admin') {
    console.warn(`⚠️ Unauthorized admin access attempt by ${req.user.email}`);
    
    return res.status(403).json({
      success: false,
      error: 'Insufficient permissions',
      code: 'ADMIN_REQUIRED',
      message: 'Only administrators can access this resource'
    });
  }

  next();
};

/**
 * ✅ STUDENT-ONLY MIDDLEWARE
 * Checks if user has student role
 */
const studentMiddleware = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      error: 'Not authenticated',
      code: 'NOT_AUTHENTICATED'
    });
  }

  if (req.user.role !== 'student') {
    return res.status(403).json({
      success: false,
      error: 'Insufficient permissions',
      code: 'STUDENT_REQUIRED',
      message: 'Only students can access this resource'
    });
  }

  next();
};

/**
 * ✅ OPTIONAL AUTH MIDDLEWARE
 * Auth is optional - doesn't fail if token missing
 */
const optionalAuthMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader?.startsWith('Bearer ')) {
      // No token provided, but that's OK
      req.user = null;
      return next();
    }

    const token = authHeader.substring(7);

    try {
      const decodedToken = await getAuth().verifyIdToken(token);
      const db = getFirestore();
      const userDoc = await db.collection('users').doc(decodedToken.uid).get();
      
      if (userDoc.exists) {
        const userData = userDoc.data();
        req.user = {
          uid: decodedToken.uid,
          email: decodedToken.email,
          role: userData.role || 'student',
          ...userData
        };
      }
    } catch (error) {
      // Token invalid, but continue anyway
      console.warn('Invalid token in optional auth:', error.message);
      req.user = null;
    }

    next();

  } catch (error) {
    console.error('Optional auth error:', error);
    req.user = null;
    next();
  }
};

/**
 * ✅ INSTRUCTOR MIDDLEWARE
 * Admin and instructors can access
 */
const instructorMiddleware = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      error: 'Not authenticated',
      code: 'NOT_AUTHENTICATED'
    });
  }

  if (!['admin', 'instructor'].includes(req.user.role)) {
    return res.status(403).json({
      success: false,
      error: 'Insufficient permissions',
      code: 'INSTRUCTOR_REQUIRED',
      message: 'Only instructors and admins can access this resource'
    });
  }

  next();
};

/**
 * ✅ COURSE OWNER MIDDLEWARE
 * Checks if user is the course owner
 */
const courseOwnerMiddleware = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Not authenticated',
        code: 'NOT_AUTHENTICATED'
      });
    }

    const { courseId } = req.params;
    if (!courseId) {
      return res.status(400).json({
        success: false,
        error: 'Course ID required',
        code: 'MISSING_COURSE_ID'
      });
    }

    // Get course and check ownership
    const db = getFirestore();
    const courseDoc = await db.collection('courses').doc(courseId).get();
    
    if (!courseDoc.exists) {
      return res.status(404).json({
        success: false,
        error: 'Course not found',
        code: 'COURSE_NOT_FOUND'
      });
    }

    const courseData = courseDoc.data();
    
    // Allow if admin or course owner
    if (req.user.role === 'admin' || courseData.instructor.uid === req.user.uid) {
      next();
    } else {
      return res.status(403).json({
        success: false,
        error: 'Not course owner',
        code: 'NOT_COURSE_OWNER',
        message: 'You do not have permission to modify this course'
      });
    }

  } catch (error) {
    console.error('Course owner check error:', error);
    return res.status(500).json({
      success: false,
      error: 'Server error',
      code: 'SERVER_ERROR'
    });
  }
};

/**
 * ✅ RATE LIMIT MIDDLEWARE
 * Basic rate limiting per user
 */
const rateLimitMiddleware = (() => {
  const attempts = {};
  const limit = 100; // requests per minute
  const windowMs = 60 * 1000; // 1 minute

  return (req, res, next) => {
    const key = req.user?.uid || req.ip;
    const now = Date.now();
    
    if (!attempts[key]) {
      attempts[key] = [];
    }

    // Clean old attempts
    attempts[key] = attempts[key].filter(time => now - time < windowMs);

    if (attempts[key].length >= limit) {
      return res.status(429).json({
        success: false,
        error: 'Too many requests',
        code: 'RATE_LIMITED',
        message: 'Please wait before making more requests'
      });
    }

    attempts[key].push(now);
    next();
  };
})();

/**
 * ✅ VERIFY EMAIL MIDDLEWARE
 * Checks if user's email is verified
 */
const verifyEmailMiddleware = (req, res, next) => {
  if (!req.user?.emailVerified) {
    return res.status(403).json({
      success: false,
      error: 'Email not verified',
      code: 'EMAIL_NOT_VERIFIED',
      message: 'Please verify your email address'
    });
  }

  next();
};

module.exports = {
  authMiddleware,
  adminMiddleware,
  studentMiddleware,
  optionalAuthMiddleware,
  instructorMiddleware,
  courseOwnerMiddleware,
  rateLimitMiddleware,
  verifyEmailMiddleware
};