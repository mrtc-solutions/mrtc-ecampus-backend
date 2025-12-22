// =============================================
// COMPREHENSIVE COURSES API ROUTES
// =============================================
const express = require('express');
const router = express.Router();
const multer = require('multer');
const admin = require('firebase-admin');
const courseService = require('../services/courseService');
const googleDriveService = require('../services/googleDriveService');
const { authenticate, requireAdmin } = require('../middleware/auth');

// Configure multer for file uploads
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 500 * 1024 * 1024 // 500MB limit for videos
    }
});

// ======================
// PUBLIC COURSE ROUTES
// ======================

/**
 * Get courses with pagination and filters
 * GET /api/courses?page=1&limit=12&category=tech&search=python
 */
router.get('/', async (req, res) => {
    try {
        const { 
            page = 1, 
            limit = 12, 
            category, 
            filter, 
            search, 
            sort = 'newest' 
        } = req.query;

        const courses = await courseService.getCourses({
            page: parseInt(page),
            limit: parseInt(limit),
            category,
            filter,
            search,
            sort
        });

        res.json({ 
            success: true, 
            ...courses 
        });

    } catch (error) {
        console.error('❌ Get courses error:', error);
        res.status(500).json({ 
            success: false,
            error: 'Failed to get courses' 
        });
    }
});

/**
 * Get single course by ID
 * GET /api/courses/:courseId
 */
router.get('/:courseId', async (req, res) => {
    try {
        const { courseId } = req.params;

        const courseDoc = await admin.firestore().collection('courses').doc(courseId).get();

        if (!courseDoc.exists) {
            return res.status(404).json({ 
                success: false,
                error: 'Course not found' 
            });
        }

        const course = {
            id: courseDoc.id,
            ...courseDoc.data()
        };

        res.json({ 
            success: true, 
            course 
        });

    } catch (error) {
        console.error('❌ Get course error:', error);
        res.status(500).json({ 
            success: false,
            error: 'Failed to get course' 
        });
    }
});

/**
 * Get course categories
 * GET /api/courses/list/categories
 */
router.get('/list/categories', async (req, res) => {
    try {
        const snapshot = await admin.firestore().collection('courses').get();
        const categories = new Set();

        snapshot.forEach(doc => {
            const data = doc.data();
            if (data.category) {
                categories.add(data.category);
            }
        });

        res.json({ 
            success: true, 
            categories: Array.from(categories).sort() 
        });

    } catch (error) {
        console.error('❌ Get categories error:', error);
        res.status(500).json({ 
            success: false,
            error: 'Failed to get categories' 
        });
    }
});

/**
 * Get course recommendations
 * GET /api/courses/:courseId/recommendations
 */
router.get('/:courseId/recommendations', async (req, res) => {
    try {
        const { courseId } = req.params;
        const limit = req.query.limit || 4;

        const courseDoc = await admin.firestore().collection('courses').doc(courseId).get();
        
        if (!courseDoc.exists) {
            return res.status(404).json({ error: 'Course not found' });
        }

        const courseData = courseDoc.data();
        const { category } = courseData;

        // Find similar courses
        const snapshot = await admin.firestore().collection('courses')
            .where('category', '==', category)
            .where('status', '==', 'published')
            .limit(parseInt(limit) + 1)
            .get();

        const recommendations = snapshot.docs
            .filter(doc => doc.id !== courseId)
            .slice(0, limit)
            .map(doc => ({
                id: doc.id,
                ...doc.data()
            }));

        res.json({ 
            success: true, 
            recommendations 
        });

    } catch (error) {
        console.error('❌ Get recommendations error:', error);
        res.status(500).json({ 
            success: false,
            error: 'Failed to get recommendations' 
        });
    }
});

/**
 * Get course reviews
 * GET /api/courses/:courseId/reviews
 */
router.get('/:courseId/reviews', async (req, res) => {
    try {
        const { page = 1, limit = 10, sort = 'recent' } = req.query;
        const { courseId } = req.params;

        let query = admin.firestore().collection('course_reviews')
            .where('courseId', '==', courseId)
            .where('isVerified', '==', true);

        if (sort === 'helpful') {
            query = query.orderBy('helpful', 'desc');
        } else {
            query = query.orderBy('createdAt', 'desc');
        }

        const snapshot = await query
            .limit(parseInt(limit) * parseInt(page))
            .get();

        const reviews = snapshot.docs
            .slice((parseInt(page) - 1) * parseInt(limit))
            .map(doc => ({
                id: doc.id,
                ...doc.data(),
                createdAt: doc.data().createdAt?.toDate()
            }));

        const totalSnapshot = await admin.firestore().collection('course_reviews')
            .where('courseId', '==', courseId)
            .where('isVerified', '==', true)
            .get();

        res.json({
            success: true,
            reviews,
            total: totalSnapshot.size,
            page: parseInt(page),
            totalPages: Math.ceil(totalSnapshot.size / limit)
        });

    } catch (error) {
        console.error('❌ Get reviews error:', error);
        res.status(500).json({ 
            success: false,
            error: 'Failed to get reviews' 
        });
    }
});

// ======================
// AUTHENTICATED USER ROUTES
// ======================

/**
 * Enroll in course
 * POST /api/courses/:courseId/enroll
 */
router.post('/:courseId/enroll', authenticate, async (req, res) => {
    try {
        const { courseId } = req.params;
        const { isFree = false } = req.body;

        // Check if already enrolled
        const enrollmentSnap = await admin.firestore().collection('enrollments')
            .where('courseId', '==', courseId)
            .where('studentId', '==', req.user.uid)
            .get();

        if (!enrollmentSnap.empty) {
            return res.status(400).json({
                success: false,
                error: 'Already enrolled in this course'
            });
        }

        // Create enrollment record
        const enrollmentRef = admin.firestore().collection('enrollments').doc();

        await enrollmentRef.set({
            id: enrollmentRef.id,
            courseId: courseId,
            studentId: req.user.uid,
            studentEmail: req.user.email,
            enrolledAt: admin.firestore.FieldValue.serverTimestamp(),
            progress: 0,
            completed: false,
            isFree: isFree,
            certificateId: null,
            lastAccessedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        res.json({
            success: true,
            message: 'Successfully enrolled in course',
            enrollmentId: enrollmentRef.id
        });

    } catch (error) {
        console.error('❌ Enrollment error:', error);
        res.status(500).json({ 
            success: false,
            error: error.message || 'Failed to enroll in course' 
        });
    }
});

/**
 * Get student's enrolled courses
 * GET /api/courses/student/enrolled
 */
router.get('/student/enrolled', authenticate, async (req, res) => {
    try {
        const enrollments = await admin.firestore().collection('enrollments')
            .where('studentId', '==', req.user.uid)
            .orderBy('enrolledAt', 'desc')
            .get();

        const courses = [];

        for (const enrollment of enrollments.docs) {
            const enrollmentData = enrollment.data();
            const courseDoc = await admin.firestore().collection('courses')
                .doc(enrollmentData.courseId)
                .get();

            if (courseDoc.exists) {
                courses.push({
                    id: courseDoc.id,
                    ...courseDoc.data(),
                    enrollment: {
                        enrollmentId: enrollment.id,
                        enrolledAt: enrollmentData.enrolledAt?.toDate(),
                        progress: enrollmentData.progress,
                        completed: enrollmentData.completed,
                        lastAccessedAt: enrollmentData.lastAccessedAt?.toDate()
                    }
                });
            }
        }

        res.json({ 
            success: true, 
            courses,
            count: courses.length 
        });

    } catch (error) {
        console.error('❌ Get student courses error:', error);
        res.status(500).json({ 
            success: false,
            error: 'Failed to get student courses' 
        });
    }
});

/**
 * Submit course review
 * POST /api/courses/:courseId/review
 */
router.post('/:courseId/review', authenticate, async (req, res) => {
    try {
        const { rating, comment } = req.body;
        const { courseId } = req.params;
        const userId = req.user.uid;

        // Validate rating
        if (!rating || rating < 1 || rating > 5) {
            return res.status(400).json({
                success: false,
                error: 'Rating must be between 1 and 5'
            });
        }

        // Check if student has completed course
        const enrollmentSnapshot = await admin.firestore().collection('enrollments')
            .where('courseId', '==', courseId)
            .where('studentId', '==', userId)
            .where('completed', '==', true)
            .get();

        if (enrollmentSnapshot.empty) {
            return res.status(400).json({
                success: false,
                error: 'You must complete the course before reviewing'
            });
        }

        // Check if already reviewed
        const existingReview = await admin.firestore().collection('course_reviews')
            .where('courseId', '==', courseId)
            .where('studentId', '==', userId)
            .get();

        if (!existingReview.empty) {
            return res.status(400).json({
                success: false,
                error: 'You have already reviewed this course'
            });
        }

        // Create review
        const reviewRef = admin.firestore().collection('course_reviews').doc();

        await reviewRef.set({
            id: reviewRef.id,
            courseId: courseId,
            studentId: userId,
            studentName: req.user.displayName || req.user.email.split('@')[0],
            studentEmail: req.user.email,
            rating: parseInt(rating),
            comment: comment || '',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            isVerified: true,
            helpful: 0,
            reported: false
        });

        // Update course rating average
        const courseDoc = await admin.firestore().collection('courses').doc(courseId).get();
        const courseData = courseDoc.data();

        const newRating = (
            ((courseData.averageRating || 0) * (courseData.reviewCount || 0)) + parseInt(rating)
        ) / ((courseData.reviewCount || 0) + 1);

        await courseDoc.ref.update({
            averageRating: newRating,
            reviewCount: (courseData.reviewCount || 0) + 1
        });

        res.json({
            success: true,
            message: 'Review submitted successfully',
            reviewId: reviewRef.id,
            courseRating: newRating
        });

    } catch (error) {
        console.error('❌ Submit review error:', error);
        res.status(500).json({ 
            success: false,
            error: 'Failed to submit review' 
        });
    }
});

// ======================
// 🆕 GOOGLE DRIVE FILE UPLOADS
// ======================

/**
 * Upload course content (video, PDF, HTML, text)
 * POST /api/courses/:courseId/upload
 */
router.post('/:courseId/upload', authenticate, requireAdmin, upload.single('file'), async (req, res) => {
    try {
        const { courseId } = req.params;
        const { lessonId, description } = req.body;
        const file = req.file;

        // ✅ VALIDATE REQUEST
        if (!file) {
            return res.status(400).json({ 
                success: false,
                error: 'No file uploaded' 
            });
        }

        // Validate file size
        const sizeValidation = googleDriveService.validateFileSize(file.buffer, 500);
        if (!sizeValidation.valid) {
            return res.status(400).json({ 
                success: false,
                error: sizeValidation.error 
            });
        }

        // Validate file type
        const supportedTypes = googleDriveService.getSupportedFileTypes();
        const allSupportedMimes = Object.values(supportedTypes).flat();
        
        const typeValidation = googleDriveService.validateFileType(file.mimetype, allSupportedMimes);
        if (!typeValidation.valid) {
            return res.status(400).json({ 
                success: false,
                error: typeValidation.error 
            });
        }

        console.log(`📤 Uploading file "${file.originalname}" for course ${courseId}`);

        // ✅ STEP 1: UPLOAD TO GOOGLE DRIVE
        const uploadResult = await googleDriveService.uploadCourseContent(
            file.buffer,
            file.originalname,
            file.mimetype,
            courseId,
            lessonId || null
        );

        if (!uploadResult.success) {
            return res.status(500).json({ 
                success: false,
                error: uploadResult.error 
            });
        }

        console.log(`✅ Google Drive upload successful: ${uploadResult.googleDriveFileId}`);

        // ✅ STEP 2: SAVE METADATA TO FIRESTORE
        const db = admin.firestore();
        const contentRef = db.collection('course_contents').doc();

        await contentRef.set({
            id: contentRef.id,
            courseId: courseId,
            lessonId: lessonId || null,
            type: file.mimetype.split('/')[0],
            mimeType: file.mimetype,
            fileName: file.originalname,
            fileSize: file.size,
            description: description || '',
            // 🆕 Google Drive metadata
            googleDriveFileId: uploadResult.googleDriveFileId,
            googleDriveUrl: uploadResult.viewUrl,
            downloadUrl: uploadResult.downloadUrl,
            // Folder IDs for organization
            courseFolderId: uploadResult.courseFolderId,
            lessonFolderId: uploadResult.lessonFolderId,
            // Timestamps
            uploadedAt: admin.firestore.FieldValue.serverTimestamp(),
            uploadedBy: req.user.uid,
            status: 'active'
        });

        console.log(`✅ Firestore record created: ${contentRef.id}`);

        // ✅ STEP 3: UPDATE COURSE DOCUMENT (auto-increment content count)
        const courseDoc = await db.collection('courses').doc(courseId).get();
        if (courseDoc.exists) {
            const courseData = courseDoc.data();
            await courseDoc.ref.update({
                contentCount: (courseData.contentCount || 0) + 1,
                lastUpdated: admin.firestore.FieldValue.serverTimestamp()
            });
        }

        // ✅ RESPONSE
        res.json({
            success: true,
            message: 'Content uploaded successfully',
            data: {
                contentId: contentRef.id,
                courseId: courseId,
                fileName: file.originalname,
                type: file.mimetype.split('/')[0],
                mimeType: file.mimetype,
                size: file.size,
                // Access URLs
                viewUrl: uploadResult.viewUrl,
                downloadUrl: uploadResult.downloadUrl,
                googleDriveFileId: uploadResult.googleDriveFileId,
                // Folder organization
                courseFolderId: uploadResult.courseFolderId,
                lessonFolderId: uploadResult.lessonFolderId || null,
                uploadedAt: new Date().toISOString()
            }
        });

    } catch (error) {
        console.error('❌ Upload content error:', error);
        res.status(500).json({ 
            success: false,
            error: error.message || 'Failed to upload content' 
        });
    }
});

/**
 * Upload YouTube link (no file upload needed)
 * POST /api/courses/:courseId/upload/youtube
 */
router.post('/:courseId/upload/youtube', authenticate, requireAdmin, async (req, res) => {
    try {
        const { courseId } = req.params;
        const { youtubeUrl, title, description, lessonId } = req.body;

        // ✅ VALIDATE REQUEST
        if (!youtubeUrl || !title) {
            return res.status(400).json({ 
                success: false,
                error: 'YouTube URL and title are required' 
            });
        }

        console.log(`📹 Saving YouTube link for course ${courseId}`);

        // ✅ STEP 1: VALIDATE AND EXTRACT METADATA
        const youtubeResult = await googleDriveService.uploadYouTubeLink(
            courseId,
            youtubeUrl,
            title,
            description || '',
            lessonId || null
        );

        if (!youtubeResult.success) {
            return res.status(400).json({ 
                success: false,
                error: youtubeResult.error 
            });
        }

        // ✅ STEP 2: SAVE TO FIRESTORE
        const db = admin.firestore();
        const contentRef = db.collection('course_contents').doc();

        await contentRef.set({
            id: contentRef.id,
            courseId: courseId,
            lessonId: lessonId || null,
            type: 'youtube',
            mimeType: 'video/youtube',
            fileName: title,
            description: description || '',
            // YouTube specific
            youtubeUrl: youtubeUrl,
            videoId: youtubeResult.videoId,
            thumbnailUrl: youtubeResult.thumbnailUrl,
            // Timestamps
            uploadedAt: admin.firestore.FieldValue.serverTimestamp(),
            uploadedBy: req.user.uid,
            status: 'active'
        });

        console.log(`✅ YouTube link saved to Firestore: ${contentRef.id}`);

        // ✅ STEP 3: UPDATE COURSE
        const courseDoc = await db.collection('courses').doc(courseId).get();
        if (courseDoc.exists) {
            const courseData = courseDoc.data();
            await courseDoc.ref.update({
                contentCount: (courseData.contentCount || 0) + 1,
                lastUpdated: admin.firestore.FieldValue.serverTimestamp()
            });
        }

        // ✅ RESPONSE
        res.json({
            success: true,
            message: 'YouTube link saved successfully',
            data: {
                contentId: contentRef.id,
                courseId: courseId,
                type: 'youtube',
                title: title,
                youtubeUrl: youtubeUrl,
                videoId: youtubeResult.videoId,
                thumbnailUrl: youtubeResult.thumbnailUrl,
                uploadedAt: new Date().toISOString()
            }
        });

    } catch (error) {
        console.error('❌ Upload YouTube error:', error);
        res.status(500).json({ 
            success: false,
            error: error.message || 'Failed to save YouTube link' 
        });
    }
});

/**
 * Upload HTML content
 * POST /api/courses/:courseId/upload/html
 */
router.post('/:courseId/upload/html', authenticate, requireAdmin, async (req, res) => {
    try {
        const { courseId } = req.params;
        const { htmlContent, fileName, description, lessonId } = req.body;

        // ✅ VALIDATE REQUEST
        if (!htmlContent || !fileName) {
            return res.status(400).json({ 
                success: false,
                error: 'HTML content and file name are required' 
            });
        }

        console.log(`📝 Uploading HTML content for course ${courseId}`);

        // ✅ STEP 1: UPLOAD TO GOOGLE DRIVE
        const uploadResult = await googleDriveService.uploadHTMLContent(
            courseId,
            htmlContent,
            fileName,
            lessonId || null
        );

        if (!uploadResult.success) {
            return res.status(500).json({ 
                success: false,
                error: uploadResult.error 
            });
        }

        // ✅ STEP 2: SAVE METADATA TO FIRESTORE
        const db = admin.firestore();
        const contentRef = db.collection('course_contents').doc();

        await contentRef.set({
            id: contentRef.id,
            courseId: courseId,
            lessonId: lessonId || null,
            type: 'html',
            mimeType: 'text/html',
            fileName: fileName,
            fileSize: htmlContent.length,
            description: description || '',
            // Google Drive metadata
            googleDriveFileId: uploadResult.googleDriveFileId,
            googleDriveUrl: uploadResult.viewUrl,
            downloadUrl: uploadResult.downloadUrl,
            // Folder IDs
            courseFolderId: uploadResult.courseFolderId,
            lessonFolderId: uploadResult.lessonFolderId,
            // Timestamps
            uploadedAt: admin.firestore.FieldValue.serverTimestamp(),
            uploadedBy: req.user.uid,
            status: 'active'
        });

        // ✅ STEP 3: UPDATE COURSE
        const courseDoc = await db.collection('courses').doc(courseId).get();
        if (courseDoc.exists) {
            const courseData = courseDoc.data();
            await courseDoc.ref.update({
                contentCount: (courseData.contentCount || 0) + 1,
                lastUpdated: admin.firestore.FieldValue.serverTimestamp()
            });
        }

        // ✅ RESPONSE
        res.json({
            success: true,
            message: 'HTML content uploaded successfully',
            data: {
                contentId: contentRef.id,
                courseId: courseId,
                type: 'html',
                fileName: fileName,
                viewUrl: uploadResult.viewUrl,
                downloadUrl: uploadResult.downloadUrl,
                googleDriveFileId: uploadResult.googleDriveFileId,
                uploadedAt: new Date().toISOString()
            }
        });

    } catch (error) {
        console.error('❌ Upload HTML error:', error);
        res.status(500).json({ 
            success: false,
            error: error.message || 'Failed to upload HTML content' 
        });
    }
});

/**
 * Get course contents
 * GET /api/courses/:courseId/contents?lessonId=xxx&type=video
 */
router.get('/:courseId/contents', authenticate, async (req, res) => {
    try {
        const { courseId } = req.params;
        const { lessonId, type } = req.query;

        let query = admin.firestore().collection('course_contents')
            .where('courseId', '==', courseId)
            .where('status', '==', 'active');

        if (lessonId) {
            query = query.where('lessonId', '==', lessonId);
        }

        if (type) {
            query = query.where('type', '==', type);
        }

        const snapshot = await query.orderBy('uploadedAt', 'desc').get();

        const contents = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            uploadedAt: doc.data().uploadedAt?.toDate()
        }));

        // Get storage usage
        const storageUsage = await googleDriveService.getStorageUsage(courseId);

        res.json({
            success: true,
            data: {
                contents: contents,
                storageUsage: storageUsage.success ? {
                    totalBytes: storageUsage.totalBytes,
                    totalGB: storageUsage.totalGB,
                    fileCount: storageUsage.fileCount
                } : null,
                count: contents.length
            }
        });

    } catch (error) {
        console.error('❌ Get contents error:', error);
        res.status(500).json({ 
            success: false,
            error: error.message || 'Failed to get contents' 
        });
    }
});

/**
 * Delete course content
 * DELETE /api/courses/:courseId/contents/:contentId
 */
router.delete('/:courseId/contents/:contentId', authenticate, requireAdmin, async (req, res) => {
    try {
        const { courseId, contentId } = req.params;

        const db = admin.firestore();
        const contentDoc = await db.collection('course_contents').doc(contentId).get();

        if (!contentDoc.exists) {
            return res.status(404).json({ 
                success: false,
                error: 'Content not found' 
            });
        }

        const content = contentDoc.data();

        // Verify content belongs to course
        if (content.courseId !== courseId) {
            return res.status(403).json({ 
                success: false,
                error: 'Content does not belong to this course' 
            });
        }

        // Delete from Google Drive
        if (content.googleDriveFileId) {
            await googleDriveService.deleteFile(content.googleDriveFileId);
        }

        // Delete from Firestore
        await contentDoc.ref.delete();

        // Update course
        const courseDoc = await db.collection('courses').doc(courseId).get();
        if (courseDoc.exists) {
            const courseData = courseDoc.data();
            await courseDoc.ref.update({
                contentCount: Math.max(0, (courseData.contentCount || 1) - 1),
                lastUpdated: admin.firestore.FieldValue.serverTimestamp()
            });
        }

        res.json({
            success: true,
            message: 'Content deleted successfully'
        });

    } catch (error) {
        console.error('❌ Delete content error:', error);
        res.status(500).json({ 
            success: false,
            error: error.message || 'Failed to delete content' 
        });
    }
});

/**
 * Get storage usage for a course
 * GET /api/courses/:courseId/storage
 */
router.get('/:courseId/storage', authenticate, requireAdmin, async (req, res) => {
    try {
        const { courseId } = req.params;

        const usage = await googleDriveService.getStorageUsage(courseId);

        if (!usage.success) {
            return res.status(500).json({ 
                success: false,
                error: usage.error 
            });
        }

        res.json({
            success: true,
            data: usage
        });

    } catch (error) {
        console.error('❌ Get storage usage error:', error);
        res.status(500).json({ 
            success: false,
            error: error.message || 'Failed to get storage usage' 
        });
    }
});

// ======================
// ADMIN COURSE MANAGEMENT
// ======================

/**
 * Create new course
 * POST /api/courses/admin/create
 */
router.post('/admin/create', authenticate, requireAdmin, async (req, res) => {
    try {
        const { title, description, category, price, instructor } = req.body;

        // Validate required fields
        if (!title || !description || !category) {
            return res.status(400).json({
                success: false,
                error: 'Title, description, and category are required'
            });
        }

        const db = admin.firestore();
        const courseRef = db.collection('courses').doc();

        // ✅ CREATE COURSE DOCUMENT
        await courseRef.set({
            id: courseRef.id,
            title: title.trim(),
            description: description.trim(),
            category: category.trim(),
            price: parseFloat(price) || 0,
            instructor: instructor || req.user.uid,
            instructorEmail: req.user.email,
            status: 'draft', // Start as draft
            contentCount: 0,
            enrollmentCount: 0,
            averageRating: 0,
            reviewCount: 0,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            createdBy: req.user.uid
        });

        res.json({
            success: true,
            message: 'Course created successfully',
            courseId: courseRef.id
        });

    } catch (error) {
        console.error('❌ Create course error:', error);
        res.status(500).json({ 
            success: false,
            error: error.message || 'Failed to create course' 
        });
    }
});

/**
 * Update course
 * PUT /api/courses/admin/:courseId
 */
router.put('/admin/:courseId', authenticate, requireAdmin, async (req, res) => {
    try {
        const { courseId } = req.params;
        const updateData = req.body;

        // Add timestamp
        updateData.updatedAt = admin.firestore.FieldValue.serverTimestamp();

        const db = admin.firestore();
        await db.collection('courses').doc(courseId).update(updateData);

        res.json({
            success: true,
            message: 'Course updated successfully'
        });

    } catch (error) {
        console.error('❌ Update course error:', error);
        res.status(500).json({ 
            success: false,
            error: error.message || 'Failed to update course' 
        });
    }
});

/**
 * Delete course (cascade delete)
 * DELETE /api/courses/admin/:courseId
 */
router.delete('/admin/:courseId', authenticate, requireAdmin, async (req, res) => {
    try {
        const { courseId } = req.params;

        const db = admin.firestore();

        // Get all course contents
        const contentsSnap = await db.collection('course_contents')
            .where('courseId', '==', courseId)
            .get();

        // Delete files from Google Drive
        for (const contentDoc of contentsSnap.docs) {
            const content = contentDoc.data();
            if (content.googleDriveFileId) {
                await googleDriveService.deleteFile(content.googleDriveFileId);
            }
        }

        // Delete all content records from Firestore
        const batch = db.batch();
        contentsSnap.docs.forEach(doc => {
            batch.delete(doc.ref);
        });
        await batch.commit();

        // Delete course
        await db.collection('courses').doc(courseId).delete();

        // Delete enrollments
        const enrollmentsSnap = await db.collection('enrollments')
            .where('courseId', '==', courseId)
            .get();

        const batch2 = db.batch();
        enrollmentsSnap.docs.forEach(doc => {
            batch2.delete(doc.ref);
        });
        await batch2.commit();

        res.json({
            success: true,
            message: 'Course deleted successfully'
        });

    } catch (error) {
        console.error('❌ Delete course error:', error);
        res.status(500).json({ 
            success: false,
            error: error.message || 'Failed to delete course' 
        });
    }
});

/**
 * Get course statistics for admin dashboard
 * GET /api/courses/admin/statistics
 */
router.get('/admin/statistics', authenticate, requireAdmin, async (req, res) => {
    try {
        const db = admin.firestore();

        // Total courses
        const coursesSnap = await db.collection('courses').get();
        const totalCourses = coursesSnap.size;

        // Total enrollments
        const enrollmentsSnap = await db.collection('enrollments').get();
        const totalEnrollments = enrollmentsSnap.size;

        // Total certificates
        const certificatesSnap = await db.collection('certificates').get();
        const totalCertificates = certificatesSnap.size;

        // Revenue (if applicable)
        const paymentsSnap = await db.collection('payments')
            .where('status', '==', 'completed')
            .get();

        let totalRevenue = 0;
        paymentsSnap.forEach(doc => {
            totalRevenue += doc.data().amount || 0;
        });

        res.json({
            success: true,
            statistics: {
                totalCourses,
                totalEnrollments,
                totalCertificates,
                totalRevenue,
                averageCoursePrice: totalCourses > 0 ? 
                    coursesSnap.docs.reduce((sum, doc) => sum + (doc.data().price || 0), 0) / totalCourses : 0
            }
        });

    } catch (error) {
        console.error('❌ Get statistics error:', error);
        res.status(500).json({ 
            success: false,
            error: error.message || 'Failed to get statistics' 
        });
    }
});

/**
 * Get all courses for admin (with pagination)
 * GET /api/courses/admin/all?page=1&limit=50&status=published
 */
router.get('/admin/all', authenticate, requireAdmin, async (req, res) => {
    try {
        const { page = 1, limit = 50, status } = req.query;

        let query = admin.firestore().collection('courses');

        if (status) {
            query = query.where('status', '==', status);
        }

        const snapshot = await query
            .orderBy('createdAt', 'desc')
            .get();

        const courses = snapshot.docs
            .slice((parseInt(page) - 1) * parseInt(limit), parseInt(page) * parseInt(limit))
            .map(doc => ({
                id: doc.id,
                ...doc.data(),
                createdAt: doc.data().createdAt?.toDate()
            }));

        res.json({
            success: true,
            courses,
            total: snapshot.size,
            page: parseInt(page),
            limit: parseInt(limit),
            totalPages: Math.ceil(snapshot.size / parseInt(limit))
        });

    } catch (error) {
        console.error('❌ Get all courses error:', error);
        res.status(500).json({ 
            success: false,
            error: error.message || 'Failed to get courses' 
        });
    }
});

module.exports = router;