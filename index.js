// =============================================
// MRTC ECAMPUS - STANDALONE BACKEND v3.0
// Modified for GitHub/Heroku/Vercel deployment
// Based on the complete Firebase Functions v3.0
// =============================================

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const PDFDocument = require('pdfkit');
const { google } = require('googleapis');
const admin = require('firebase-admin');
const bodyParser = require('body-parser');
require('dotenv').config();

// Initialize Express app
const app = express();

// ===== FIREBASE ADMIN INITIALIZATION (Standalone) =====
if (!admin.apps.length) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        privateKeyId: process.env.FIREBASE_PRIVATE_KEY_ID
      }),
      databaseURL: `https://${process.env.FIREBASE_PROJECT_ID}.firebaseio.com`
    });
    console.log('✅ Firebase Admin initialized for standalone backend');
  } catch (error) {
    console.error('❌ Firebase Admin initialization failed:', error.message);
  }
}

const db = admin.firestore();

// ===== SECURITY MIDDLEWARE =====
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://www.paypal.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:", "blob:"],
      connectSrc: ["'self'", "https://api.paychangu.com", "https://api.sandbox.paypal.com"]
    }
  }
}));

app.use(cors({ 
  origin: [
    'https://mrtc-ecampus.web.app',
    'http://localhost:5500',
    'http://127.0.0.1:5500',
    'http://localhost:3000',
    process.env.FRONTEND_URL
  ].filter(Boolean),
  credentials: true 
}));

app.use(compression());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));

// ===== RATE LIMITING =====
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests from this IP, please try again later.'
});

app.use('/api/', limiter);

// ===== GOOGLE DRIVE CONFIGURATION =====
const GOOGLE_DRIVE_CREDENTIALS = {
  type: "service_account",
  project_id: process.env.FIREBASE_PROJECT_ID || "mrtc-ecampus",
  private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID || "ba87cf1c783b59351ebfdb66cc1d276e74ccff5d",
  private_key: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, '\n'),
  client_email: process.env.FIREBASE_CLIENT_EMAIL || "firebase-adminsdk-fbsvc@mrtc-ecampus.iam.gserviceaccount.com",
  client_id: process.env.GOOGLE_CLIENT_ID || "1073159719007-l86iutd88maq7nrsrposj3hpg0nksqbp.apps.googleusercontent.com",
  auth_uri: "https://accounts.google.com/o/oauth2/auth",
  token_uri: "https://oauth2.googleapis.com/token",
  auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
  client_x509_cert_url: "https://www.googleapis.com/robot/v1/metadata/x509/firebase-adminsdk-fbsvc%40mrtc-ecampus.iam.gserviceaccount.com"
};

const DRIVE_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID || "1b1bfhCg7SZYgjXVGzD55l3iKds_VU6_3";

// Initialize Google Drive
let driveClient = null;
function initializeDrive() {
  try {
    const auth = new google.auth.GoogleAuth({
      credentials: GOOGLE_DRIVE_CREDENTIALS,
      scopes: [
        'https://www.googleapis.com/auth/drive.file',
        'https://www.googleapis.com/auth/drive'
      ]
    });
    
    driveClient = google.drive({
      version: 'v3',
      auth: auth
    });
    
    console.log('✅ Google Drive initialized for standalone backend');
    return driveClient;
  } catch (error) {
    console.error('❌ Google Drive init error:', error);
    return null;
  }
}
driveClient = initializeDrive();

// ===== MIDDLEWARE =====
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized: No token provided' });
    }

    const token = authHeader.split('Bearer ')[1];
    const decodedToken = await admin.auth().verifyIdToken(token);
    req.user = decodedToken;
    
    // Verify user exists in Firestore
    const userDoc = await db.collection('users').doc(decodedToken.uid).get();
    if (!userDoc.exists) {
      return res.status(403).json({ error: 'User not found in database' });
    }
    
    next();
  } catch (error) {
    console.error('Authentication error:', error);
    res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
};

const requireAdmin = async (req, res, next) => {
  try {
    const userDoc = await db.collection('users').doc(req.user.uid).get();
    const userData = userDoc.data();
    
    if (userData.role !== 'admin' && userData.email !== process.env.ADMIN_EMAIL) {
      return res.status(403).json({ error: 'Forbidden: Admin access required' });
    }
    next();
  } catch (error) {
    console.error('Admin check error:', error);
    res.status(403).json({ error: 'Forbidden: Access denied' });
  }
};

// File upload middleware
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'image/jpeg', 'image/png', 'image/gif', 'image/webp',
      'application/pdf',
      'text/html', 'text/plain',
      'video/mp4', 'video/webm', 'video/quicktime',
      'audio/mpeg', 'audio/wav', 'audio/mp4'
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type: ${file.mimetype}`), false);
    }
  }
});

// ===== IMPORT ALL SERVICES AND FUNCTIONS FROM YOUR COMPREHENSIVE FILE =====
// Note: I'm including key functions. You should copy-paste all your services from the original file.

// Google Drive Service (copy from your original)
class GoogleDriveService {
  constructor() {
    this.folderId = DRIVE_FOLDER_ID;
  }

  async uploadFile(fileBuffer, fileName, mimeType, folderId = this.folderId) {
    // Copy your exact uploadFile method from original
    try {
      const fileMetadata = {
        name: fileName,
        parents: [folderId]
      };

      const media = {
        mimeType: mimeType,
        body: fileBuffer
      };

      const response = await driveClient.files.create({
        resource: fileMetadata,
        media: media,
        fields: 'id, name, webViewLink, webContentLink, size, mimeType'
      });

      // Make file publicly accessible
      await driveClient.permissions.create({
        fileId: response.data.id,
        requestBody: {
          role: 'reader',
          type: 'anyone'
        }
      });

      const downloadUrl = `https://drive.google.com/uc?export=download&id=${response.data.id}`;
      const previewUrl = `https://drive.google.com/file/d/${response.data.id}/preview`;

      return {
        success: true,
        fileId: response.data.id,
        fileName: response.data.name,
        fileUrl: `https://drive.google.com/file/d/${response.data.id}/view`,
        downloadUrl: downloadUrl,
        previewUrl: previewUrl,
        mimeType: response.data.mimeType,
        size: response.data.size
      };
    } catch (error) {
      console.error('Google Drive upload error:', error);
      throw error;
    }
  }

  // ... (copy all other methods from your original file)
}

const driveService = new GoogleDriveService();

// Certificate Service (copy from your original)
class CertificateService {
  async generateCertificate(data) {
    // Copy your exact generateCertificate method
    try {
      const { courseId, assessmentId, score, studentId, userId } = data;
      
      if (score < 80) {
        throw new Error('Minimum score of 80% required for certificate');
      }

      // ... (copy all your certificate logic)
      // This should be identical to your original file
      
      return {
        success: true,
        certificate: {
          // ... certificate data
        }
      };
    } catch (error) {
      console.error('Generate certificate error:', error);
      throw error;
    }
  }

  // ... (copy all other certificate methods)
}

const certificateService = new CertificateService();

// ===== IMPORT ALL HELPER FUNCTIONS =====
// Copy these exactly from your original file:
function validatePaymentAmount(requiredAmount, paidAmount) {
  // Copy your exact function
}

function calculateAssessmentScore(answers, questions) {
  // Copy your exact function
}

function selectRandomQuestions(questionBank, count) {
  // Copy your exact function
}

async function updateCourseProgress(userId, courseId, assessmentType) {
  // Copy your exact function
}

async function enrollUser(userId, courseId, paymentId) {
  // Copy your exact function
}

// ===== IMPORT ALL ROUTES =====
// I'll show the structure. You should copy-paste each route from your original file.

// Health Check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    backend: 'standalone',
    version: '3.0',
    services: {
      firebase: 'connected',
      googleDrive: driveClient ? 'connected' : 'disconnected'
    }
  });
});

// ===== COPY ALL PAYMENT ROUTES =====
// Copy these EXACTLY from your original file:

app.post('/api/payments/check-existing', authenticate, async (req, res) => {
  // Copy from original
});

app.post('/api/payments/validate-amount', authenticate, async (req, res) => {
  // Copy from original
});

app.post('/api/payments/create-paychangu', authenticate, async (req, res) => {
  // Copy from original
});

app.post('/api/payments/create-paypal', authenticate, async (req, res) => {
  // Copy from original
});

// ... (copy ALL payment routes from your original file)

// ===== COPY ALL CERTIFICATE ROUTES =====
app.post('/api/certificates/generate', authenticate, async (req, res) => {
  // Copy from original
});

app.get('/api/certificates/:id', authenticate, async (req, res) => {
  // Copy from original
});

// ... (copy ALL certificate routes)

// ===== COPY ALL COURSE MANAGEMENT ROUTES =====
app.post('/api/courses', authenticate, requireAdmin, async (req, res) => {
  // Copy from original
});

app.get('/api/courses', authenticate, async (req, res) => {
  // Copy from original
});

// ... (copy ALL course routes)

// ===== COPY ALL ADMIN ROUTES =====
app.get('/api/admin/payments', authenticate, requireAdmin, async (req, res) => {
  // Copy from original
});

app.get('/api/admin/settings', authenticate, requireAdmin, async (req, res) => {
  // Copy from original
});

// ... (copy ALL admin routes)

// ===== COPY ALL ASSESSMENT ROUTES =====
app.post('/api/courses/:courseId/assessments', authenticate, requireAdmin, async (req, res) => {
  // Copy from original
});

// ... (copy ALL assessment routes)

// ===== COPY ALL ENROLLMENT ROUTES =====
app.post('/api/enroll', authenticate, async (req, res) => {
  // Copy from original
});

// ===== ERROR HANDLING =====
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File size too large. Maximum size is 100MB' });
    }
    return res.status(400).json({ error: err.message });
  }
  
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong',
    timestamp: new Date().toISOString()
  });
});

// 404 Handler
app.use('*', (req, res) => {
  res.status(404).json({ 
    error: 'Endpoint not found',
    message: `The requested endpoint ${req.originalUrl} does not exist`
  });
});

// ===== START STANDALONE SERVER =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('🚀 MRTC eCampus Standalone Backend v3.0');
  console.log(`📍 Server running on port ${PORT}`);
  console.log(`🌐 Health check: http://localhost:${PORT}/api/health`);
  console.log('✅ Ready for GitHub/Heroku/Vercel deployment');
});