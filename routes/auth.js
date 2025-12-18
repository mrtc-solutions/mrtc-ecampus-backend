const express = require('express');
const router = express.Router();
const { auth } = require('firebase-admin');
const User = require('../models/User');
const { validateSignup, validateLogin } = require('../middleware/validation');
const rateLimit = require('../middleware/rateLimit');

// Register new user
router.post('/register', rateLimit.auth, validateSignup, async (req, res) => {
  try {
    const { email, password, displayName, phoneNumber, country } = req.body;

    // Check if user exists
    const existingUser = await User.findByEmail(email);
    if (existingUser) {
      return res.status(400).json({
        error: 'User already exists',
        code: 'USER_EXISTS'
      });
    }

    // Create Firebase user
    const userRecord = await auth().createUser({
      email,
      password,
      displayName,
      phoneNumber,
      emailVerified: false
    });

    // Create user in Firestore
    const user = new User({
      uid: userRecord.uid,
      email: userRecord.email,
      displayName: userRecord.displayName || displayName,
      phoneNumber: userRecord.phoneNumber || phoneNumber,
      country: country || 'Malawi',
      role: 'student',
      createdAt: new Date().toISOString(),
      lastLogin: new Date().toISOString()
    });

    await user.save();

    // Create custom token for client
    const token = await auth().createCustomToken(userRecord.uid);

    res.status(201).json({
      message: 'User registered successfully',
      user: user.toJSON(),
      token
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      error: 'Registration failed',
      code: 'REGISTRATION_FAILED',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Login user
router.post('/login', rateLimit.auth, validateLogin, async (req, res) => {
  try {
    const { email, password } = req.body;

    // Sign in with email/password
    const userCredential = await auth()
      .getAuth()
      .signInWithEmailAndPassword(email, password);

    const userRecord = userCredential.user;
    
    // Get or create user in Firestore
    let user = await User.findById(userRecord.uid);
    if (!user) {
      user = new User({
        uid: userRecord.uid,
        email: userRecord.email,
        displayName: userRecord.displayName || '',
        photoURL: userRecord.photoURL || '',
        role: 'student',
        lastLogin: new Date().toISOString()
      });
      await user.save();
    } else {
      // Update last login
      user.lastLogin = new Date().toISOString();
      await user.save();
    }

    // Create custom token
    const token = await auth().createCustomToken(userRecord.uid);

    res.json({
      message: 'Login successful',
      user: user.toJSON(),
      token,
      isAdmin: user.role === 'admin'
    });
  } catch (error) {
    console.error('Login error:', error);
    
    let statusCode = 500;
    let errorMessage = 'Login failed';
    
    if (error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password') {
      statusCode = 401;
      errorMessage = 'Invalid email or password';
    } else if (error.code === 'auth/user-disabled') {
      statusCode = 403;
      errorMessage = 'Account disabled';
    } else if (error.code === 'auth/too-many-requests') {
      statusCode = 429;
      errorMessage = 'Too many login attempts. Try again later';
    }

    res.status(statusCode).json({
      error: errorMessage,
      code: error.code || 'LOGIN_FAILED'
    });
  }
});

// Google OAuth
router.post('/google', rateLimit.auth, async (req, res) => {
  try {
    const { idToken } = req.body;

    // Verify Google ID token
    const decodedToken = await auth().verifyIdToken(idToken);
    const { uid, email, name, picture } = decodedToken;

    // Get or create user
    let user = await User.findById(uid);
    if (!user) {
      user = new User({
        uid,
        email,
        displayName: name || email.split('@')[0],
        photoURL: picture || '',
        role: 'student',
        lastLogin: new Date().toISOString()
      });
      await user.save();
    } else {
      user.lastLogin = new Date().toISOString();
      await user.save();
    }

    // Create custom token
    const token = await auth().createCustomToken(uid);

    res.json({
      message: 'Google login successful',
      user: user.toJSON(),
      token,
      isAdmin: user.role === 'admin'
    });
  } catch (error) {
    console.error('Google auth error:', error);
    res.status(401).json({
      error: 'Invalid Google token',
      code: 'INVALID_GOOGLE_TOKEN'
    });
  }
});

// Get current user
router.get('/me', rateLimit.auth, async (req, res) => {
  try {
    // In a real implementation, you'd verify the token from headers
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];
    const decodedToken = await auth().verifyIdToken(token);
    
    const user = await User.findById(decodedToken.uid);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      user: user.toJSON(),
      isAdmin: user.role === 'admin'
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(401).json({
      error: 'Invalid token',
      code: 'INVALID_TOKEN'
    });
  }
});

// Update user profile
router.put('/profile', rateLimit.auth, async (req, res) => {
  try {
    const { uid } = req.user; // Would come from auth middleware
    const updates = req.body;

    const allowedUpdates = ['displayName', 'phoneNumber', 'country', 'city', 'bio', 'skills'];
    const filteredUpdates = {};
    
    Object.keys(updates).forEach(key => {
      if (allowedUpdates.includes(key)) {
        filteredUpdates[key] = updates[key];
      }
    });

    const user = await User.update(uid, filteredUpdates);

    res.json({
      message: 'Profile updated successfully',
      user: user.toJSON()
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({
      error: 'Failed to update profile',
      code: 'UPDATE_FAILED'
    });
  }
});

// Request password reset
router.post('/forgot-password', rateLimit.auth, async (req, res) => {
  try {
    const { email } = req.body;

    const user = await User.findByEmail(email);
    if (!user) {
      return res.status(404).json({
        error: 'User not found',
        code: 'USER_NOT_FOUND'
      });
    }

    // Generate reset link
    const resetLink = await auth().generatePasswordResetLink(email);
    
    // In production, you would send this via email
    // await emailService.sendPasswordReset(email, resetLink);

    res.json({
      message: 'Password reset link generated',
      resetLink: process.env.NODE_ENV === 'development' ? resetLink : undefined,
      code: 'RESET_LINK_SENT'
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({
      error: 'Failed to process password reset',
      code: 'RESET_FAILED'
    });
  }
});

// Verify email
router.post('/verify-email', rateLimit.auth, async (req, res) => {
  try {
    const { email } = req.body;

    const user = await User.findByEmail(email);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Generate email verification link
    const verificationLink = await auth().generateEmailVerificationLink(email);
    
    // In production, send this via email
    // await emailService.sendVerificationEmail(email, verificationLink);

    res.json({
      message: 'Verification link generated',
      verificationLink: process.env.NODE_ENV === 'development' ? verificationLink : undefined
    });
  } catch (error) {
    console.error('Verify email error:', error);
    res.status(500).json({
      error: 'Failed to generate verification link',
      code: 'VERIFICATION_FAILED'
    });
  }
});

// Logout
router.post('/logout', rateLimit.auth, async (req, res) => {
  try {
    // Firebase handles logout on client side
    // This endpoint is for server-side cleanup if needed
    res.json({
      message: 'Logout successful',
      code: 'LOGOUT_SUCCESS'
    });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({
      error: 'Logout failed',
      code: 'LOGOUT_FAILED'
    });
  }
});

module.exports = router;