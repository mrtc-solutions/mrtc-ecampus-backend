// =============================================
// FIREBASE FUNCTIONS CONFIG ENCRYPTION TOOL
// Encrypts .env file for Google Drive storage
// =============================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const admin = require('firebase-admin');

console.log('🔐 Firebase Functions Config Encryption Tool');
console.log('============================================');

// Initialize Firebase Admin (uses default credentials)
if (!admin.apps.length) {
  admin.initializeApp();
}

// Get Google Drive API using Firebase Admin credentials
async function getDriveClient() {
  try {
    // Firebase Admin automatically uses the service account
    const auth = admin.credential.applicationDefault();
    const { google } = require('googleapis');
    
    const authClient = await auth.getClient({
      scopes: ['https://www.googleapis.com/auth/drive.file']
    });
    
    return google.drive({ version: 'v3', auth: authClient });
  } catch (error) {
    console.error('❌ Failed to initialize Google Drive client:', error.message);
    throw error;
  }
}

// Main encryption function
async function encryptAndUpload() {
  try {
    console.log('\n📁 Step 1: Reading configuration...');
    
    // 1. Read .env file
    const envPath = path.join(__dirname, '../.env');
    if (!fs.existsSync(envPath)) {
      throw new Error('.env file not found at: ' + envPath);
    }
    
    const envContent = fs.readFileSync(envPath, 'utf8');
    console.log('✅ Loaded .env file');
    
    // 2. Get encryption key from environment or .env
    let encryptionKey = process.env.CONFIG_ENCRYPTION_KEY;
    
    if (!encryptionKey) {
      // Try to get from .env file
      const lines = envContent.split('\n');
      const keyLine = lines.find(line => line.startsWith('CONFIG_ENCRYPTION_KEY='));
      if (keyLine) {
        encryptionKey = keyLine.split('=')[1].trim();
      }
    }
    
    if (!encryptionKey) {
      throw new Error('CONFIG_ENCRYPTION_KEY not found in environment or .env file');
    }
    
    console.log('✅ Found encryption key');
    
    // 3. Encrypt the content
    console.log('\n🔐 Step 2: Encrypting configuration...');
    
    function encrypt(text, key) {
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv(
        'aes-256-gcm',
        Buffer.from(key, 'hex'),
        iv
      );
      
      let encrypted = cipher.update(text, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      const authTag = cipher.getAuthTag();
      
      return {
        iv: iv.toString('hex'),
        content: encrypted,
        authTag: authTag.toString('hex'),
        encryptedAt: new Date().toISOString(),
        environment: process.env.FIREBASE_CONFIG?.projectId || 'firebase-functions'
      };
    }
    
    const encryptedData = encrypt(envContent, encryptionKey);
    const outputJson = JSON.stringify(encryptedData, null, 2);
    
    // 4. Save encrypted file locally
    console.log('\n💾 Step 3: Saving encrypted file...');
    
    const outputPath = path.join(__dirname, '../config.encrypted.json');
    fs.writeFileSync(outputPath, outputJson);
    
    console.log('✅ Encrypted config saved to:', outputPath);
    console.log('📊 File size:', (fs.statSync(outputPath).size / 1024).toFixed(2), 'KB');
    
    // 5. Get Google Drive folder ID
    const driveFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID || 
                         '1b1bfhCg7SZYgjXVGzD55l3iKds_VU6_3';
    
    console.log('\n☁️ Step 4: Uploading to Google Drive...');
    console.log('📁 Target folder ID:', driveFolderId);
    
    const drive = await getDriveClient();
    
    // Check if file already exists
    const searchResponse = await drive.files.list({
      q: `name='config.encrypted.json' and '${driveFolderId}' in parents and trashed=false`,
      fields: 'files(id, name, modifiedTime)',
      spaces: 'drive'
    });
    
    let fileId;
    let isUpdate = false;
    
    if (searchResponse.data.files.length > 0) {
      // Update existing file
      fileId = searchResponse.data.files[0].id;
      isUpdate = true;
      
      await drive.files.update({
        fileId: fileId,
        media: {
          mimeType: 'application/json',
          body: outputJson
        },
        fields: 'id, name, webViewLink'
      });
      
      console.log('✅ Updated existing file on Google Drive');
    } else {
      // Create new file
      const fileMetadata = {
        name: 'config.encrypted.json',
        parents: [driveFolderId],
        description: 'MRTC eCampus Firebase Functions Encrypted Configuration',
        mimeType: 'application/json'
      };
      
      const media = {
        mimeType: 'application/json',
        body: outputJson
      };
      
      const file = await drive.files.create({
        requestBody: fileMetadata,
        media: media,
        fields: 'id, name, webViewLink'
      });
      
      fileId = file.data.id;
      console.log('✅ Created new file on Google Drive');
    }
    
    // Make file publicly readable (optional)
    await drive.permissions.create({
      fileId: fileId,
      requestBody: {
        role: 'reader',
        type: 'anyone'
      }
    });
    
    // Get file URL
    const fileInfo = await drive.files.get({
      fileId: fileId,
      fields: 'webViewLink, webContentLink'
    });
    
    console.log('\n🎉 SUCCESS! Configuration uploaded securely');
    console.log('===========================================');
    console.log('📄 File:', isUpdate ? 'Updated' : 'Created');
    console.log('🔗 View URL:', fileInfo.data.webViewLink);
    console.log('📥 Download URL:', fileInfo.data.webContentLink);
    console.log('🆔 File ID:', fileId);
    console.log('📅 Encrypted at:', encryptedData.encryptedAt);
    console.log('🏷️ Environment:', encryptedData.environment);
    console.log('\n💡 Tip: Keep your CONFIG_ENCRYPTION_KEY safe!');
    console.log('     You need it to decrypt this configuration.');
    
    // Save upload info for reference
    const uploadInfo = {
      fileId: fileId,
      viewUrl: fileInfo.data.webViewLink,
      downloadUrl: fileInfo.data.webContentLink,
      uploadedAt: new Date().toISOString(),
      isUpdate: isUpdate,
      folderId: driveFolderId,
      environment: encryptedData.environment
    };
    
    fs.writeFileSync(
      path.join(__dirname, '../upload-info.json'),
      JSON.stringify(uploadInfo, null, 2)
    );
    
  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
    console.error('Stack:', error.stack);
    
    // Provide helpful suggestions
    if (error.message.includes('invalid_grant')) {
      console.log('\n💡 Help: Make sure your Firebase service account has Google Drive API enabled');
      console.log('1. Go to: https://console.cloud.google.com/apis/library/drive.googleapis.com');
      console.log('2. Enable Google Drive API for your project');
      console.log('3. Wait a few minutes and try again');
    } else if (error.message.includes('not found')) {
      console.log('\n💡 Help: Check your Google Drive folder ID');
      console.log('1. Open the folder in Google Drive');
      console.log('2. Copy the ID from the URL (after /folders/)');
      console.log('3. Update GOOGLE_DRIVE_FOLDER_ID in .env');
    }
    
    process.exit(1);
  }
}

// Helper function to decrypt (for verification)
function decrypt(encryptedData, key) {
  try {
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      Buffer.from(key, 'hex'),
      Buffer.from(encryptedData.iv, 'hex')
    );
    
    decipher.setAuthTag(Buffer.from(encryptedData.authTag, 'hex'));
    
    let decrypted = decipher.update(encryptedData.content, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error) {
    throw new Error('Decryption failed. Wrong key or corrupted data.');
  }
}

// Test decryption (optional)
async function testDecryption() {
  try {
    console.log('\n🔍 Testing decryption...');
    
    const encryptedPath = path.join(__dirname, '../config.encrypted.json');
    if (!fs.existsSync(encryptedPath)) {
      console.log('No encrypted file found to test');
      return;
    }
    
    const encryptedData = JSON.parse(fs.readFileSync(encryptedPath, 'utf8'));
    const encryptionKey = process.env.CONFIG_ENCRYPTION_KEY;
    
    if (!encryptionKey) {
      console.log('CONFIG_ENCRYPTION_KEY not set for testing');
      return;
    }
    
    const decrypted = decrypt(encryptedData, encryptionKey);
    
    // Check if it looks like a valid .env file
    if (decrypted.includes('FIREBASE_PROJECT_ID=') && decrypted.includes('GEMINI_API_KEY=')) {
      console.log('✅ Decryption test PASSED');
      console.log('📝 Sample of decrypted content:');
      console.log(decrypted.split('\n').slice(0, 5).join('\n'));
      console.log('...');
    } else {
      console.log('⚠️ Decryption test: Content looks different than expected');
    }
    
  } catch (error) {
    console.error('❌ Decryption test failed:', error.message);
  }
}

// Command line interface
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  
  switch (command) {
    case 'test':
      await testDecryption();
      break;
      
    case 'help':
      console.log('\n📖 Firebase Functions Config Tool Usage:');
      console.log('=========================================');
      console.log('npm run encrypt                 Encrypt and upload .env to Google Drive');
      console.log('npm run encrypt test           Test decryption of local encrypted file');
      console.log('npm run encrypt help           Show this help message');
      console.log('\n📋 Required Environment Variables:');
      console.log('CONFIG_ENCRYPTION_KEY          Your 64-character hex encryption key');
      console.log('GOOGLE_DRIVE_FOLDER_ID         Google Drive folder ID (optional)');
      console.log('\n🔑 Generate encryption key:');
      console.log('node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
      break;
      
    default:
      await encryptAndUpload();
  }
}

// Handle uncaught errors
process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection:', error);
  process.exit(1);
});

// Run the tool
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = {
  encryptAndUpload,
  testDecryption,
  decrypt
};