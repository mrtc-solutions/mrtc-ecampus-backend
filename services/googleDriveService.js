const { google } = require('googleapis');
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
const stream = require('stream');

class GoogleDriveService {
    constructor() {
        this.drive = null;
        this.driveActivity = null;
        this.initialize();
    }

    async initialize() {
        try {
            // 🔑 VALIDATE REQUIRED ENV VARIABLES
            const requiredEnvs = [
                'FIREBASE_PROJECT_ID',
                'FIREBASE_PRIVATE_KEY_ID',
                'FIREBASE_PRIVATE_KEY',
                'GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL',
                'GOOGLE_DRIVE_FOLDER_ID'
            ];

            for (const env of requiredEnvs) {
                if (!process.env[env]) {
                    throw new Error(`Missing required environment variable: ${env}`);
                }
            }

            // ✅ AUTHENTICATION SETUP
            const auth = new google.auth.GoogleAuth({
                credentials: {
                    type: 'service_account',
                    project_id: process.env.FIREBASE_PROJECT_ID,
                    private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
                    private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
                    client_email: process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL,
                    client_id: process.env.GOOGLE_DRIVE_CLIENT_ID || '111333873983268526755',
                    auth_uri: 'https://accounts.google.com/o/oauth2/auth',
                    token_uri: 'https://oauth2.googleapis.com/token',
                    auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
                    client_x509_cert_url: `https://www.googleapis.com/robot/v1/metadata/x509/${process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL.replace('@', '%40')}`
                },
                scopes: [
                    'https://www.googleapis.com/auth/drive.file',
                    'https://www.googleapis.com/auth/drive.readonly',
                    'https://www.googleapis.com/auth/drive.activity.readonly'
                ]
            });

            // Initialize Drive API v3
            this.drive = google.drive({ version: 'v3', auth });

            // Initialize Drive Activity API v2
            this.driveActivity = google.driveactivity({ version: 'v2', auth });

            console.log('✅ Google Drive service initialized successfully');
            return true;

        } catch (error) {
            console.error('❌ Failed to initialize Google Drive:', error.message);
            throw error;
        }
    }

    // ========================================
    // 🆕 COURSE UPLOAD (Main Method)
    // ========================================
    /**
     * Upload course file to Google Drive and return metadata
     * @param {Buffer} fileBuffer - File buffer
     * @param {string} fileName - Original file name
     * @param {string} mimeType - File MIME type
     * @param {string} courseId - Course ID
     * @param {string} lessonId - Optional lesson ID
     * @returns {Object} Upload result with metadata
     */
    async uploadCourseContent(fileBuffer, fileName, mimeType, courseId, lessonId = null) {
        try {
            console.log(`📤 Uploading "${fileName}" for course ${courseId}`);

            // Step 1: Get or create course folder
            const courseFolderId = await this.getOrCreateCourseFolder(courseId);
            console.log(`✅ Course folder: ${courseFolderId}`);

            // Step 2: Get or create lesson folder (if lessonId provided)
            let lessonFolderId = null;
            if (lessonId) {
                lessonFolderId = await this.getOrCreateLessonFolder(courseFolderId, lessonId);
                console.log(`✅ Lesson folder: ${lessonFolderId}`);
            }

            // Step 3: Create file metadata
            const fileMetadata = {
                name: fileName,
                parents: [lessonFolderId || courseFolderId],
                mimeType: mimeType,
                // 🆕 Add custom properties for tracking
                properties: {
                    courseId: courseId,
                    lessonId: lessonId || 'root',
                    uploadedAt: new Date().toISOString()
                }
            };

            // Step 4: Upload file to Google Drive
            const media = {
                mimeType: mimeType,
                body: this.bufferToStream(fileBuffer)
            };

            const response = await this.drive.files.create({
                resource: fileMetadata,
                media: media,
                fields: 'id, name, webViewLink, webContentLink, mimeType, size, createdTime, owners'
            });

            const fileData = response.data;
            console.log(`✅ File uploaded to Drive: ${fileData.id}`);

            // Step 5: Make file publicly accessible (optional)
            await this.makeFilePublic(fileData.id);
            console.log(`✅ File made public`);

            // Step 6: Return metadata (to be saved in Firestore)
            return {
                success: true,
                googleDriveFileId: fileData.id,
                fileName: fileData.name,
                viewUrl: fileData.webViewLink,
                downloadUrl: fileData.webContentLink,
                mimeType: fileData.mimeType,
                size: fileData.size,
                createdTime: fileData.createdTime,
                courseFolderId: courseFolderId,
                lessonFolderId: lessonFolderId,
                uploadedAt: new Date().toISOString()
            };

        } catch (error) {
            console.error('❌ Course content upload error:', error.message);
            return {
                success: false,
                error: error.message || 'Failed to upload course content'
            };
        }
    }

    // ========================================
    // 🆕 YOUTUBE LINK STORAGE
    // ========================================
    /**
     * Save YouTube link as metadata (no file upload)
     */
    async uploadYouTubeLink(courseId, youtubeUrl, title, description = '', lessonId = null) {
        try {
            console.log(`📹 Saving YouTube link for course ${courseId}`);

            // Validate YouTube URL
            const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.?be)\/.+$/;
            if (!youtubeRegex.test(youtubeUrl)) {
                return {
                    success: false,
                    error: 'Invalid YouTube URL format'
                };
            }

            // Extract video ID
            const videoIdMatch = youtubeUrl.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
            const videoId = videoIdMatch ? videoIdMatch[1] : null;

            if (!videoId) {
                return {
                    success: false,
                    error: 'Could not extract video ID from YouTube URL'
                };
            }

            // Return metadata for Firestore
            return {
                success: true,
                type: 'youtube',
                videoId: videoId,
                youtubeUrl: youtubeUrl,
                title: title,
                description: description,
                thumbnailUrl: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
                courseId: courseId,
                lessonId: lessonId || null,
                uploadedAt: new Date().toISOString()
            };

        } catch (error) {
            console.error('❌ YouTube link save error:', error.message);
            return {
                success: false,
                error: error.message
            };
        }
    }

    // ========================================
    // 🆕 HTML CONTENT UPLOAD
    // ========================================
    /**
     * Upload HTML content as file to Google Drive
     */
    async uploadHTMLContent(courseId, htmlContent, fileName, lessonId = null) {
        try {
            console.log(`📝 Uploading HTML content for course ${courseId}`);

            // Ensure fileName ends with .html
            const safeName = fileName.endsWith('.html') ? fileName : `${fileName}.html`;

            // Convert HTML string to buffer
            const buffer = Buffer.from(htmlContent, 'utf-8');

            // Get or create course folder
            const courseFolderId = await this.getOrCreateCourseFolder(courseId);

            // Get or create lesson folder
            let lessonFolderId = null;
            if (lessonId) {
                lessonFolderId = await this.getOrCreateLessonFolder(courseFolderId, lessonId);
            }

            // File metadata
            const fileMetadata = {
                name: safeName,
                parents: [lessonFolderId || courseFolderId],
                mimeType: 'text/html',
                properties: {
                    courseId: courseId,
                    lessonId: lessonId || 'root',
                    contentType: 'html'
                }
            };

            // Upload file
            const response = await this.drive.files.create({
                resource: fileMetadata,
                media: {
                    mimeType: 'text/html',
                    body: this.bufferToStream(buffer)
                },
                fields: 'id, name, webViewLink, webContentLink, mimeType, size'
            });

            // Make public
            await this.makeFilePublic(response.data.id);

            return {
                success: true,
                googleDriveFileId: response.data.id,
                fileName: response.data.name,
                viewUrl: response.data.webViewLink,
                downloadUrl: response.data.webContentLink,
                mimeType: 'text/html',
                size: buffer.length,
                courseFolderId: courseFolderId,
                lessonFolderId: lessonFolderId,
                uploadedAt: new Date().toISOString()
            };

        } catch (error) {
            console.error('❌ HTML content upload error:', error.message);
            return {
                success: false,
                error: error.message
            };
        }
    }

    // ========================================
    // FOLDER MANAGEMENT
    // ========================================

    /**
     * Get or create course folder in Google Drive
     */
    async getOrCreateCourseFolder(courseId) {
        try {
            const parentFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

            // Search for existing folder
            const response = await this.drive.files.list({
                q: `'${parentFolderId}' in parents and name='course-${courseId}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
                fields: 'files(id, name)',
                spaces: 'drive'
            });

            if (response.data.files.length > 0) {
                console.log(`✅ Found existing course folder: ${response.data.files[0].id}`);
                return response.data.files[0].id;
            }

            // Create new folder
            console.log(`📁 Creating new course folder for course ${courseId}`);

            const folderMetadata = {
                name: `course-${courseId}`,
                mimeType: 'application/vnd.google-apps.folder',
                parents: [parentFolderId],
                properties: {
                    courseId: courseId,
                    type: 'course'
                }
            };

            const folderResponse = await this.drive.files.create({
                resource: folderMetadata,
                fields: 'id, name',
                spaces: 'drive'
            });

            console.log(`✅ Created course folder: ${folderResponse.data.id}`);
            return folderResponse.data.id;

        } catch (error) {
            console.error('❌ Error managing course folder:', error.message);
            throw error;
        }
    }

    /**
     * Get or create lesson folder within course folder
     */
    async getOrCreateLessonFolder(courseFolderId, lessonId) {
        try {
            // Search for existing folder
            const response = await this.drive.files.list({
                q: `'${courseFolderId}' in parents and name='lesson-${lessonId}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
                fields: 'files(id, name)',
                spaces: 'drive'
            });

            if (response.data.files.length > 0) {
                return response.data.files[0].id;
            }

            // Create new lesson folder
            const folderMetadata = {
                name: `lesson-${lessonId}`,
                mimeType: 'application/vnd.google-apps.folder',
                parents: [courseFolderId],
                properties: {
                    lessonId: lessonId,
                    type: 'lesson'
                }
            };

            const folderResponse = await this.drive.files.create({
                resource: folderMetadata,
                fields: 'id, name',
                spaces: 'drive'
            });

            return folderResponse.data.id;

        } catch (error) {
            console.error('❌ Error managing lesson folder:', error.message);
            throw error;
        }
    }

    // ========================================
    // FILE PERMISSIONS & ACCESS
    // ========================================

    /**
     * Make file publicly accessible
     */
    async makeFilePublic(fileId) {
        try {
            await this.drive.permissions.create({
                fileId: fileId,
                requestBody: {
                    role: 'reader',
                    type: 'anyone'
                }
            });

            console.log(`✅ File ${fileId} made publicly accessible`);
            return true;

        } catch (error) {
            console.error(`⚠️ Warning: Could not make file public: ${error.message}`);
            // Don't throw - file can still be accessed with proper auth
            return false;
        }
    }

    /**
     * Get file info
     */
    async getFileInfo(fileId) {
        try {
            const file = await this.drive.files.get({
                fileId: fileId,
                fields: 'id, name, webViewLink, webContentLink, mimeType, size, modifiedTime, owners, createdTime'
            });

            return {
                success: true,
                file: file.data
            };

        } catch (error) {
            console.error('❌ Error getting file info:', error.message);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Delete file from Google Drive
     */
    async deleteFile(fileId) {
        try {
            await this.drive.files.delete({ fileId: fileId });
            console.log(`✅ Deleted file ${fileId} from Google Drive`);
            return { success: true };

        } catch (error) {
            console.error('❌ Error deleting file:', error.message);
            return {
                success: false,
                error: error.message
            };
        }
    }

    // ========================================
    // STORAGE & ANALYTICS
    // ========================================

    /**
     * Get storage usage for a course
     */
    async getStorageUsage(courseId) {
        try {
            const courseFolderId = await this.getOrCreateCourseFolder(courseId);

            // Get all files in course folder
            const response = await this.drive.files.list({
                q: `'${courseFolderId}' in parents and trashed=false`,
                fields: 'files(size)',
                spaces: 'drive',
                pageSize: 1000
            });

            let totalSize = 0;
            const files = response.data.files || [];

            files.forEach(file => {
                totalSize += parseInt(file.size) || 0;
            });

            const usageGB = (totalSize / (1024 * 1024 * 1024)).toFixed(2);

            return {
                success: true,
                totalBytes: totalSize,
                totalGB: usageGB,
                fileCount: files.length,
                courseId: courseId
            };

        } catch (error) {
            console.error('❌ Error getting storage usage:', error.message);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Get recent Google Drive activities
     */
    async getRecentDriveActivities(limit = 20) {
        try {
            const response = await this.driveActivity.activity.query({
                requestBody: {
                    pageSize: limit
                }
            });

            return {
                success: true,
                activities: response.data.activities || [],
                count: response.data.activities?.length || 0
            };

        } catch (error) {
            console.error('❌ Error fetching Drive activities:', error.message);
            return {
                success: false,
                error: error.message
            };
        }
    }

    // ========================================
    // UTILITY METHODS
    // ========================================

    /**
     * Convert buffer to stream
     */
    bufferToStream(buffer) {
        const readable = new stream.Readable();
        readable._read = () => {};
        readable.push(buffer);
        readable.push(null);
        return readable;
    }

    /**
     * Validate file size
     */
    validateFileSize(fileBuffer, maxSizeMB) {
        const maxBytes = maxSizeMB * 1024 * 1024;

        if (fileBuffer.length > maxBytes) {
            return {
                valid: false,
                error: `File size exceeds ${maxSizeMB}MB limit`
            };
        }

        return { valid: true };
    }

    /**
     * Validate file type
     */
    validateFileType(mimeType, allowedCategories) {
        const [category] = mimeType.split('/');

        if (allowedCategories.includes(category) || allowedCategories.includes(mimeType)) {
            return { valid: true };
        }

        return {
            valid: false,
            error: `File type "${mimeType}" is not allowed`
        };
    }

    /**
     * Get supported file types
     */
    getSupportedFileTypes() {
        return {
            video: ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime'],
            audio: ['audio/mpeg', 'audio/wav', 'audio/webm', 'audio/ogg'],
            document: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
            image: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
            text: ['text/plain', 'text/html', 'text/css', 'application/json'],
            presentation: ['application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation']
        };
    }
}

module.exports = new GoogleDriveService();