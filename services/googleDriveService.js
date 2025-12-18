const { google } = require('googleapis');
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

class GoogleDriveService {
    constructor() {
        this.drive = null;
        this.driveActivity = null; // 🆕 Drive Activity API
        this.initialize();
    }

    async initialize() {
        try {
            const auth = new google.auth.GoogleAuth({
                credentials: {
                    type: 'service_account',
                    project_id: process.env.FIREBASE_PROJECT_ID,
                    private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
                    private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
                    client_email: process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL,
                    client_id: '111333873983268526755',
                    auth_uri: 'https://accounts.google.com/o/oauth2/auth',
                    token_uri: 'https://oauth2.googleapis.com/token',
                    auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
                    client_x509_cert_url: `https://www.googleapis.com/robot/v1/metadata/x509/${process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL.replace('@', '%40')}`
                },

                // ✅ SCOPES GO HERE (THIS ANSWERS YOUR QUESTION)
                scopes: [
                    'https://www.googleapis.com/auth/drive.file',
                    'https://www.googleapis.com/auth/drive.readonly',
                    'https://www.googleapis.com/auth/drive.activity.readonly' // 🆕 ADDED
                ]
            });

            // Existing Drive API
            this.drive = google.drive({ version: 'v3', auth });

            // 🆕 Drive Activity API
            this.driveActivity = google.driveactivity({ version: 'v2', auth });

            console.log('✅ Google Drive & Drive Activity services initialized');
        } catch (error) {
            console.error('❌ Failed to initialize Google Drive:', error);
            throw error;
        }
    }

    // ===========================
    // EXISTING METHODS (UNCHANGED)
    // ===========================

    async uploadContent(fileBuffer, fileName, mimeType, courseId) {
        try {
            const folderId = await this.getOrCreateCourseFolder(courseId);

            const fileMetadata = {
                name: fileName,
                parents: [folderId],
                mimeType: mimeType
            };

            const media = {
                mimeType: mimeType,
                body: fileBuffer
            };

            const file = await this.drive.files.create({
                resource: fileMetadata,
                media: media,
                fields: 'id, name, webViewLink, webContentLink, mimeType, size'
            });

            await this.makeFilePublic(file.data.id);

            return {
                success: true,
                fileId: file.data.id,
                fileName: file.data.name,
                viewUrl: file.data.webViewLink,
                downloadUrl: file.data.webContentLink,
                mimeType: file.data.mimeType,
                size: file.data.size,
                folderId: folderId
            };
        } catch (error) {
            console.error('Error uploading to Google Drive:', error);
            return { success: false, error: error.message };
        }
    }

    async getOrCreateCourseFolder(courseId) {
        try {
            const response = await this.drive.files.list({
                q: `'${process.env.GOOGLE_DRIVE_FOLDER_ID}' in parents and name='course-${courseId}' and mimeType='application/vnd.google-apps.folder'`,
                fields: 'files(id, name)'
            });

            if (response.data.files.length > 0) {
                return response.data.files[0].id;
            }

            const folderMetadata = {
                name: `course-${courseId}`,
                mimeType: 'application/vnd.google-apps.folder',
                parents: [process.env.GOOGLE_DRIVE_FOLDER_ID]
            };

            const folder = await this.drive.files.create({
                resource: folderMetadata,
                fields: 'id'
            });

            console.log(`Created folder for course ${courseId}: ${folder.data.id}`);
            return folder.data.id;
        } catch (error) {
            console.error('Error creating course folder:', error);
            throw error;
        }
    }

    async makeFilePublic(fileId) {
        try {
            await this.drive.permissions.create({
                fileId: fileId,
                requestBody: {
                    role: 'reader',
                    type: 'anyone'
                }
            });
            console.log(`File ${fileId} made public`);
            return true;
        } catch (error) {
            console.error('Error making file public:', error);
            return false;
        }
    }

    async deleteFile(fileId) {
        try {
            await this.drive.files.delete({ fileId: fileId });
            console.log(`Deleted file ${fileId}`);
            return { success: true };
        } catch (error) {
            console.error('Error deleting file:', error);
            return { success: false, error: error.message };
        }
    }

    async getFileInfo(fileId) {
        try {
            const file = await this.drive.files.get({
                fileId: fileId,
                fields: 'id, name, webViewLink, webContentLink, mimeType, size, modifiedTime'
            });
            return { success: true, file: file.data };
        } catch (error) {
            console.error('Error getting file info:', error);
            return { success: false, error: error.message };
        }
    }

    // ===========================
    // 🆕 NEW: DRIVE ACTIVITY API
    // ===========================

    async getRecentDriveActivities(limit = 20) {
        try {
            const response = await this.driveActivity.activity.query({
                requestBody: {
                    pageSize: limit
                }
            });

            return {
                success: true,
                activities: response.data.activities || []
            };
        } catch (error) {
            console.error('Error fetching Drive activities:', error);
            return { success: false, error: error.message };
        }
    }
}

module.exports = new GoogleDriveService();
