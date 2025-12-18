// Simple encryption tool for Firebase Functions
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

console.log('🔐 Simple Config Encryption for Firebase Functions');

// Read .env file
const envPath = path.join(__dirname, '../.env');
if (!fs.existsSync(envPath)) {
  console.error('❌ .env file not found');
  process.exit(1);
}

const envContent = fs.readFileSync(envPath, 'utf8');

// Get or generate encryption key
let encryptionKey = process.env.CONFIG_ENCRYPTION_KEY;
if (!encryptionKey) {
  // Generate new key
  encryptionKey = crypto.randomBytes(32).toString('hex');
  console.log('🔑 Generated new encryption key:', encryptionKey);
  console.log('💡 Save this key as CONFIG_ENCRYPTION_KEY environment variable!');
}

// Encrypt
const iv = crypto.randomBytes(16);
const cipher = crypto.createCipheriv('aes-256-gcm', 
  Buffer.from(encryptionKey, 'hex'), iv);

let encrypted = cipher.update(envContent, 'utf8', 'hex');
encrypted += cipher.final('hex');
const authTag = cipher.getAuthTag();

const encryptedData = {
  iv: iv.toString('hex'),
  content: encrypted,
  authTag: authTag.toString('hex'),
  encryptedAt: new Date().toISOString(),
  project: 'mrtc-ecampus-firebase'
};

// Save to file
const outputPath = path.join(__dirname, '../config.encrypted.json');
fs.writeFileSync(outputPath, JSON.stringify(encryptedData, null, 2));

console.log('✅ Encrypted config saved to:', outputPath);
console.log('📤 Upload this file to your Google Drive folder manually');
console.log('📁 Folder ID: 1b1bfhCg7SZYgjXVGzD55l3iKds_VU6_3');