const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { google } = require('googleapis');

class ConfigLoader {
  constructor() {
    this.config = null;
    this.encryptionKey = process.env.CONFIG_ENCRYPTION_KEY;
    this.googleDriveFileId = process.env.GOOGLE_DRIVE_CONFIG_FILE_ID;
  }

  async load() {
    if (this.config) return this.config;

    // Try loading from Google Drive first
    if (this.encryptionKey && this.googleDriveFileId) {
      try {
        this.config = await this.loadFromGoogleDrive();
        console.log('✅ Configuration loaded from Google Drive');
        return this.config;
      } catch (error) {
        console.warn('⚠️ Failed to load from Google Drive, falling back to env:', error.message);
      }
    }

    // Fall back to environment variables
    this.config = this.loadFromEnv();
    console.log('✅ Configuration loaded from environment variables');
    return this.config;
  }

  async loadFromGoogleDrive() {
    // Initialize Google Drive API
    const auth = new google.auth.GoogleAuth({
      credentials: {
        type: 'service_account',
        project_id: process.env.FIREBASE_PROJECT_ID,
        private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        client_email: process.env.FIREBASE_CLIENT_EMAIL,
        client_id: process.env.FIREBASE_CLIENT_ID,
        auth_uri: 'https://accounts.google.com/o/oauth2/auth',
        token_uri: 'https://oauth2.googleapis.com/token',
        auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
        client_x509_cert_url: process.env.FIREBASE_CLIENT_X509_CERT_URL
      },
      scopes: ['https://www.googleapis.com/auth/drive.readonly']
    });

    const drive = google.drive({ version: 'v3', auth });
    
    // Download encrypted config file
    const response = await drive.files.get({
      fileId: this.googleDriveFileId,
      alt: 'media'
    }, { responseType: 'stream' });

    let encryptedData = '';
    response.data.on('data', chunk => encryptedData += chunk);
    await new Promise(resolve => response.data.on('end', resolve));

    // Decrypt the data
    const decryptedData = this.decrypt(encryptedData);
    return JSON.parse(decryptedData);
  }

  loadFromEnv() {
    return {
      firebase: {
        projectId: process.env.FIREBASE_PROJECT_ID,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        clientId: process.env.FIREBASE_CLIENT_ID,
        authUri: process.env.FIREBASE_AUTH_URI,
        tokenUri: process.env.FIREBASE_TOKEN_URI,
        authProviderX509CertUrl: process.env.FIREBASE_AUTH_PROVIDER_X509_CERT_URL,
        clientX509CertUrl: process.env.FIREBASE_CLIENT_X509_CERT_URL,
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
        databaseURL: process.env.FIREBASE_DATABASE_URL
      },
      payments: {
        paychangu: {
          publicKey: process.env.PAYCHANGU_PUBLIC_KEY,
          secretKey: process.env.PAYCHANGU_SECRET_KEY,
          mode: process.env.PAYCHANGU_MODE || 'test'
        },
        paypal: {
          merchantId: process.env.PAYPAL_MERCHANT_ID,
          clientId: process.env.PAYPAL_CLIENT_ID,
          clientSecret: process.env.PAYPAL_CLIENT_SECRET,
          mode: process.env.PAYPAL_MODE || 'sandbox'
        }
      },
      ai: {
        gemini: {
          apiKey: process.env.GEMINI_API_KEY,
          model: process.env.GEMINI_MODEL || 'gemini-pro',
          enabled: !!process.env.GEMINI_API_KEY
        },
        deepseek: {
          apiKey: process.env.DEEPSEEK_API_KEY,
          enabled: !!process.env.DEEPSEEK_API_KEY
        },
        openai: {
          apiKey: process.env.OPENAI_API_KEY,
          enabled: !!process.env.OPENAI_API_KEY
        },
        primary: process.env.PRIMARY_AI_PROVIDER || 'gemini'
      },
      googleDrive: {
        folderId: process.env.GOOGLE_DRIVE_FOLDER_ID,
        serviceAccountEmail: process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL
      },
      email: {
        host: process.env.EMAIL_HOST,
        port: process.env.EMAIL_PORT,
        user: process.env.EMAIL_USER,
        password: process.env.EMAIL_PASSWORD
      },
      admin: {
        email: process.env.ADMIN_EMAIL,
        passwordHash: process.env.ADMIN_PASSWORD_HASH
      },
      system: {
        exchangeRate: parseInt(process.env.EXCHANGE_RATE) || 800,
        baseUrl: process.env.BASE_URL,
        apiBaseUrl: process.env.API_BASE_URL,
        jwtSecret: process.env.JWT_SECRET,
        sessionTimeout: parseInt(process.env.SESSION_TIMEOUT) || 86400000
      },
      features: {
        enableAiAssistant: process.env.ENABLE_AI_ASSISTANT === 'true',
        enableTourGuide: process.env.ENABLE_TOUR_GUIDE === 'true',
        enableAutoAssessment: process.env.ENABLE_AUTO_ASSESSMENT === 'true',
        enableCertificateAutoGen: process.env.ENABLE_CERTIFICATE_AUTO_GEN === 'true'
      }
    };
  }

  encrypt(text) {
    if (!this.encryptionKey) return text;
    
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', 
      Buffer.from(this.encryptionKey, 'hex'), 
      iv
    );
    
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();
    
    return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
  }

  decrypt(encryptedText) {
    if (!this.encryptionKey) return encryptedText;
    
    const [ivHex, authTagHex, encrypted] = encryptedText.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    
    const decipher = crypto.createDecipheriv('aes-256-gcm', 
      Buffer.from(this.encryptionKey, 'hex'), 
      iv
    );
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  }

  async saveToGoogleDrive(config) {
    if (!this.encryptionKey || !this.googleDriveFileId) {
      throw new Error('Encryption key or Google Drive file ID not configured');
    }

    const auth = new google.auth.GoogleAuth({
      credentials: {
        type: 'service_account',
        project_id: config.firebase.projectId,
        private_key: config.firebase.privateKey,
        client_email: config.firebase.clientEmail
      },
      scopes: ['https://www.googleapis.com/auth/drive.file']
    });

    const drive = google.drive({ version: 'v3', auth });
    
    // Encrypt config
    const configJson = JSON.stringify(config, null, 2);
    const encryptedConfig = this.encrypt(configJson);
    
    // Update file in Google Drive
    await drive.files.update({
      fileId: this.googleDriveFileId,
      media: {
        mimeType: 'text/plain',
        body: encryptedConfig
      }
    });

    console.log('✅ Configuration saved to Google Drive');
  }
}

module.exports = new ConfigLoader();