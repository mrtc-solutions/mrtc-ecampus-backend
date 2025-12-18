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
        fileSize: 100 * 1024 * 1024 // 100MB limit
    }
});

// ======================
// PUBLIC COURSE ROUTES
// ======================

// Get courses with pagination and filters
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
            search
        });

        res.json({ success: true, ...courses });
    } catch (error) {
        console.error('Get courses error:', error);
        res.status(500).json({ error: 'Failed to get courses' });
    }
});

// Get single course by ID
router.get('/:courseId', async (req, res) => {
    try {
        const course = await courseService.getCourseById(req.params.courseId);
        
        if (!course) {
            return res.status(404).json({ error: 'Course not found' });
        }

        res.json({ success: true, course });
    } catch (error) {
        console.error('Get course error:', error);
        res.status(500).json({ error: 'Failed to get course' });
    }
});

// Get course categories
router.get('/categories', async (req, res) => {
    try {
        const categories = await courseService.getCourseCategories();
        res.json({ success: true, categories });
    } catch (error) {
        console.error('Get categories error:', error);
        res.status(500).json({ error: 'Failed to get categories' });
    }
});

// Get course recommendations
router.get('/:courseId/recommendations', async (req, res) => {
    try {
        const recommendations = await courseService.getCourseRecommendations(
            req.params.courseId,
            req.query.limit || 4
        );
        res.json({ success: true, recommendations });
    } catch (error) {
        console.error('Get recommendations error:', error);
        res.status(500).json({ error: 'Failed to get recommendations' });
    }
});

// Get course reviews
router.get('/:courseId/reviews', async (req, res) => {
    try {
        const { page = 1, limit = 10, sort = 'recent' } = req.query;
        const { courseId } = req.params;

        let query = req.db.collection('course_reviews')
            .where('courseId', '==', courseId)
            .where('isVerified', '==', true);

        if (sort === 'helpful') {
            query = query.orderBy('helpful', 'desc');
        } else {
            query = query.orderBy('createdAt', 'desc');
        }

        const snapshot = await query.limit(parseInt(limit)).get();
        const reviews = [];

        snapshot.forEach(doc => {
            const data = doc.data();
            reviews.push({
                id: doc.id,
                ...data,
                createdAt: data.createdAt?.toDate()
            });
        });

        const totalSnapshot = await req.db.collection('course_reviews')
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
        console.error('Get reviews error:', error);
        res.status(500).json({ error: 'Failed to get reviews' });
    }
});

// ======================
// AUTHENTICATED USER ROUTES
// ======================

// Enroll in course
router.post('/:courseId/enroll', authenticate, async (req, res) => {
    try {
        const { courseId } = req.params;
        const { isFree = false } = req.body;

        const result = await courseService.enrollStudent(
            courseId,
            req.user.uid,
            req.user.email,
            isFree
        );

        res.json(result);
    } catch (error) {
        console.error('Enrollment error:', error);
        res.status(500).json({ error: error.message || 'Failed to enroll in course' });
    }
});

// Process course purchase
router.post('/:courseId/purchase', authenticate, async (req, res) => {
    try {
        const { courseId } = req.params;
        const { amount, method, transactionId } = req.body;

        // Payment validation
        const course = await courseService.getCourseById(courseId);
        const coursePrice = course.price || 0;

        if (parseFloat(amount) < coursePrice) {
            return res.status(400).json({
                error: 'Insufficient payment',
                message: `Payment amount (${amount}) is less than required course price (${coursePrice})`
            });
        }

        const result = await courseService.processCoursePurchase(courseId, req.user.uid, {
            amount: parseFloat(amount),
            method,
            transactionId
        });

        res.json(result);
    } catch (error) {
        console.error('Purchase error:', error);
        res.status(500).json({ error: error.message || 'Failed to process purchase' });
    }
});

// Get student's enrolled courses
router.get('/student/enrolled', authenticate, async (req, res) => {
    try {
        const courses = await courseService.getStudentCourses(req.user.uid);
        res.json({ success: true, courses });
    } catch (error) {
        console.error('Get student courses error:', error);
        res.status(500).json({ error: 'Failed to get student courses' });
    }
});

// Submit course review
router.post('/:courseId/review', authenticate, async (req, res) => {
    try {
        const { rating, comment } = req.body;
        const { courseId } = req.params;
        const userId = req.user.uid;

        // Check if student has completed course
        const enrollmentSnapshot = await req.db.collection('enrollments')
            .where('courseId', '==', courseId)
            .where('studentId', '==', userId)
            .where('progress', '==', 100)
            .get();

        if (enrollmentSnapshot.empty) {
            return res.status(400).json({
                error: 'Cannot review',
                message: 'You must complete the course before reviewing'
            });
        }

        // Check if already reviewed
        const existingReview = await req.db.collection('course_reviews')
            .where('courseId', '==', courseId)
            .where('studentId', '==', userId)
            .get();

        if (!existingReview.empty) {
            return res.status(400).json({
                error: 'Already reviewed',
                message: 'You have already reviewed this course'
            });
        }

        // Create review
        const reviewId = req.db.collection('course_reviews').doc().id;
        await req.db.collection('course_reviews').doc(reviewId).set({
            reviewId,
            courseId,
            studentId: userId,
            studentName: req.user.name || req.user.email.split('@')[0],
            studentEmail: req.user.email,
            rating: parseInt(rating),
            comment,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            isVerified: true,
            helpful: 0
        });

        // Update course rating
        const result = await courseService.updateCourseRating(courseId, parseInt(rating));

        res.json({ 
            success: true, 
            message: 'Review submitted successfully',
            ...result
        });
    } catch (error) {
        console.error('Submit review error:', error);
        res.status(500).json({ error: 'Failed to submit review' });
    }
});

// ======================
// GOOGLE DRIVE FILE MANAGEMENT
// ======================

// Upload course content (video, PDF, HTML, text)
router.post('/:courseId/upload', authenticate, requireAdmin, upload.single('file'), async (req, res) => {
    try {
        const { courseId } = req.params;
        const { lessonId, description } = req.body;
        const file = req.file;

        if (!file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        // Validate file
        const sizeValidation = googleDriveService.validateFileSize(file.buffer, 100);
        if (!sizeValidation.valid) {
            return res.status(400).json({ error: sizeValidation.error });
        }

        const mimeType = file.mimetype;
        const typeValidation = googleDriveService.validateFileType(mimeType, [
            'image', 'video', 'audio', 'pdf', 'text'
        ]);
        if (!typeValidation.valid) {
            return res.status(400).json({ error: typeValidation.error });
        }

        // Upload to Google Drive
        const uploadResult = await googleDriveService.uploadCourseContent(
            courseId,
            file.buffer,
            file.originalname,
            mimeType,
            lessonId
        );

        if (!uploadResult.success) {
            return res.status(500).json({ error: uploadResult.error });
        }

        // Save to Firestore
        const contentRef = req.db.collection('course_contents').doc();
        
        await contentRef.set({
            id: contentRef.id,
            courseId: courseId,
            lessonId: lessonId || null,
            type: mimeType.split('/')[0],
            mimeType: mimeType,
            fileName: file.originalname,
            fileSize: file.size,
            description: description || '',
            googleDriveFileId: uploadResult.googleDriveFileId,
            googleDriveUrl: uploadResult.viewUrl,
            downloadUrl: uploadResult.downloadUrl,
            uploadedAt: admin.firestore.FieldValue.serverTimestamp(),
            uploadedBy: req.user.uid,
            status: 'active'
        });

        res.json({
            success: true,
            message: 'Content uploaded successfully',
            data: {
                contentId: contentRef.id,
                fileName: file.originalname,
                type: mimeType.split('/')[0],
                mimeType: mimeType,
                size: file.size,
                url: uploadResult.viewUrl,
                downloadUrl: uploadResult.downloadUrl,
                courseFolderId: uploadResult.courseFolderId,
                lessonFolderId: uploadResult.lessonFolderId
            }
        });

    } catch (error) {
        console.error('Upload content error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Upload YouTube link (no file upload)
router.post('/:courseId/upload/youtube', authenticate, requireAdmin, async (req, res) => {
    try {
        const { courseId } = req.params;
        const { youtubeUrl, title, description, lessonId } = req.body;

        if (!youtubeUrl || !title) {
            return res.status(400).json({ error: 'YouTube URL and title are required' });
        }

        // Validate YouTube URL
        const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.?be)\/.+$/;
        if (!youtubeRegex.test(youtubeUrl)) {
            return res.status(400).json({ error: 'Invalid YouTube URL' });
        }

        // Save YouTube link
        const uploadResult = await googleDriveService.uploadYouTubeLink(
            courseId,
            youtubeUrl,
            title,
            description,
            lessonId
        );

        if (!uploadResult.success) {
            return res.status(500).json({ error: uploadResult.error });
        }

        res.json({
            success: true,
            message: 'YouTube link saved successfully',
            data: uploadResult
        });

    } catch (error) {
        console.error('Upload YouTube error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Upload HTML content as file
router.post('/:courseId/upload/html', authenticate, requireAdmin, async (req, res) => {
    try {
        const { courseId } = req.params;
        const { htmlContent, fileName, description, lessonId } = req.body;

        if (!htmlContent || !fileName) {
            return res.status(400).json({ error: 'HTML content and file name are required' });
        }

        // Upload HTML content
        const uploadResult = await googleDriveService.uploadHTMLContent(
            courseId,
            htmlContent,
            fileName,
            lessonId
        );

        if (!uploadResult.success) {
            return res.status(500).json({ error: uploadResult.error });
        }

        // Save to Firestore
        const contentRef = req.db.collection('course_contents').doc();
        
        await contentRef.set({
            id: contentRef.id,
            courseId: courseId,
            lessonId: lessonId || null,
            type: 'html',
            mimeType: 'text/html',
            fileName: fileName,
            fileSize: htmlContent.length,
            description: description || '',
            googleDriveFileId: uploadResult.googleDriveFileId,
            googleDriveUrl: uploadResult.viewUrl,
            downloadUrl: uploadResult.downloadUrl,
            uploadedAt: admin.firestore.FieldValue.serverTimestamp(),
            uploadedBy: req.user.uid,
            status: 'active'
        });

        res.json({
            success: true,
            message: 'HTML content uploaded successfully',
            data: {
                contentId: contentRef.id,
                fileName: fileName,
                type: 'html',
                url: uploadResult.viewUrl,
                downloadUrl: uploadResult.downloadUrl
            }
        });

    } catch (error) {
        console.error('Upload HTML error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get course contents
router.get('/:courseId/contents', authenticate, async (req, res) => {
    try {
        const { courseId } = req.params;
        const { lessonId, type } = req.query;

        let query = req.db.collection('course_contents').where('courseId', '==', courseId);

        if (lessonId) {
            query = query.where('lessonId', '==', lessonId);
        }

        if (type) {
            query = query.where('type', '==', type);
        }

        query = query.where('status', '==', 'active').orderBy('uploadedAt', 'desc');

        const snapshot = await query.get();
        const contents = snapshot.docs.map(doc => doc.data());

        // Get storage usage
        const storageUsage = await googleDriveService.getStorageUsage(courseId);

        res.json({
            success: true,
            data: {
                contents: contents,
                storageUsage: storageUsage.success ? storageUsage : null,
                count: contents.length
            }
        });

    } catch (error) {
        console.error('Get contents error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Delete course content
router.delete('/:courseId/contents/:contentId', authenticate, requireAdmin, async (req, res) => {
    try {
        const { courseId, contentId } = req.params;

        const contentDoc = await req.db.collection('course_contents').doc(contentId).get();

        if (!contentDoc.exists) {
            return res.status(404).json({ error: 'Content not found' });
        }

        const content = contentDoc.data();

        // Verify content belongs to course
        if (content.courseId !== courseId) {
            return res.status(403).json({ error: 'Content does not belong to this course' });
        }

        // Delete from Google Drive
        if (content.googleDriveFileId) {
            await googleDriveService.deleteFile(content.googleDriveFileId);
        }

        // Delete from Firestore
        await contentDoc.ref.delete();

        res.json({
            success: true,
            message: 'Content deleted successfully'
        });

    } catch (error) {
        console.error('Delete content error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get storage usage
router.get('/:courseId/storage', authenticate, requireAdmin, async (req, res) => {
    try {
        const { courseId } = req.params;

        const usage = await googleDriveService.getStorageUsage(courseId);

        if (!usage.success) {
            return res.status(500).json({ error: usage.error });
        }

        res.json({
            success: true,
            data: usage
        });

    } catch (error) {
        console.error('Get storage usage error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ======================
// ADMIN COURSE MANAGEMENT
// ======================

// Create new course
router.post('/admin/create', authenticate, requireAdmin, async (req, res) => {
    try {
        const result = await courseService.saveCourse(req.body, req.user.uid);
        res.json(result);
    } catch (error) {
        console.error('Create course error:', error);
        res.status(500).json({ error: 'Failed to create course' });
    }
});

// Update course
router.put('/admin/:courseId', authenticate, requireAdmin, async (req, res) => {
    try {
        const courseData = { id: req.params.courseId, ...req.body };
        const result = await courseService.saveCourse(courseData, req.user.uid);
        res.json(result);
    } catch (error) {
        console.error('Update course error:', error);
        res.status(500).json({ error: 'Failed to update course' });
    }
});

// Delete course
router.delete('/admin/:courseId', authenticate, requireAdmin, async (req, res) => {
    try {
        const result = await courseService.deleteCourse(req.params.courseId, req.user.uid);
        res.json(result);
    } catch (error) {
        console.error('Delete course error:', error);
        res.status(500).json({ error: 'Failed to delete course' });
    }
});

// Get course statistics for admin
router.get('/admin/statistics', authenticate, requireAdmin, async (req, res) => {
    try {
        const stats = await courseService.getCourseStatistics();
        res.json({ success: true, ...stats });
    } catch (error) {
        console.error('Get course statistics error:', error);
        res.status(500).json({ error: 'Failed to get course statistics' });
    }
});

// Get all courses for admin management
router.get('/admin/all', authenticate, requireAdmin, async (req, res) => {
    try {
        const { page = 1, limit = 50, status } = req.query;
        
        let query = req.db.collection('courses');
        
        if (status) {
            query = query.where('status', '==', status);
        }
        
        query = query.orderBy('createdAt', 'desc');
        
        const snapshot = await query.get();
        const courses = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));

        res.json({
            success: true,
            courses,
            total: courses.length,
            page: parseInt(page),
            totalPages: Math.ceil(courses.length / limit)
        });
    } catch (error) {
        console.error('Get all courses error:', error);
        res.status(500).json({ error: 'Failed to get courses' });
    }
});

module.exports = router;