// backend/index.js - Complete Backend Server
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const admin = require('firebase-admin');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// ======================
// INITIALIZE FIREBASE
// ======================
try {
    const serviceAccount = require('../firebase-admin-key.json'); // Your key from root folder
    
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
    
    console.log('✅ Firebase Admin initialized successfully');
} catch (error) {
    console.error('❌ Firebase initialization error:', error);
    console.log('⚠️ Make sure firebase-admin-key.json exists in project root');
}

const db = admin.firestore();
const app = express();

// ======================
// MIDDLEWARE
// ======================
app.use(helmet({
    contentSecurityPolicy: false, // Disable for now, configure properly later
    crossOriginEmbedderPolicy: false
}));

app.use(cors({
    origin: [
        'http://localhost:5500',
        'http://127.0.0.1:5500',
        'https://mrtc-ecampus.web.app',
        'https://mrtc-solutions.github.io'
    ],
    credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ======================
// AUTHENTICATION MIDDLEWARE
// ======================
const authenticate = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ 
                error: 'Unauthorized', 
                message: 'No token provided' 
            });
        }
        
        const token = authHeader.split('Bearer ')[1];
        const decodedToken = await admin.auth().verifyIdToken(token);
        
        req.user = {
            uid: decodedToken.uid,
            email: decodedToken.email,
            role: decodedToken.role || 'student'
        };
        
        next();
    } catch (error) {
        console.error('Authentication error:', error);
        res.status(401).json({ 
            error: 'Unauthorized', 
            message: 'Invalid token' 
        });
    }
};

const isAdmin = (req, res, next) => {
    if (req.user.email === 'stepstosucceed1@gmail.com' || req.user.role === 'admin') {
        next();
    } else {
        res.status(403).json({ 
            error: 'Forbidden', 
            message: 'Admin access required' 
        });
    }
};

// ======================
// IMPORT ROUTES
// ======================
const paymentRoutes = require('./routes/payments');
const paychanguWebhook = require('./webhooks/paychangu');
const paypalWebhook = require('./webhooks/paypal');

// ======================
// HEALTH CHECK
// ======================
app.get('/api/health', (req, res) => {
    res.json({
        status: 'healthy',
        service: 'MRTC eCampus Backend',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        firebase: admin.apps.length > 0 ? 'connected' : 'disconnected'
    });
});

// ======================
// COURSE ROUTES
// ======================

// Get all courses
app.get('/api/courses', async (req, res) => {
    try {
        const coursesSnapshot = await db.collection('courses')
            .where('isActive', '==', true)
            .get();
        
        const courses = [];
        coursesSnapshot.forEach(doc => {
            courses.push({
                id: doc.id,
                ...doc.data()
            });
        });
        
        res.json({ success: true, courses });
        
    } catch (error) {
        console.error('Get courses error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get single course
app.get('/api/courses/:courseId', async (req, res) => {
    try {
        const courseDoc = await db.collection('courses')
            .doc(req.params.courseId)
            .get();
        
        if (!courseDoc.exists) {
            return res.status(404).json({ error: 'Course not found' });
        }
        
        res.json({ 
            success: true, 
            course: { id: courseDoc.id, ...courseDoc.data() } 
        });
        
    } catch (error) {
        console.error('Get course error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ======================
// ASSESSMENT ROUTES
// ======================

// Get assessment questions
app.get('/api/assessment/:courseId', authenticate, async (req, res) => {
    try {
        const { courseId } = req.params;
        const { type = 'final' } = req.query;
        const userId = req.user.uid;
        
        console.log(`Getting assessment for course: ${courseId}, type: ${type}, user: ${userId}`);
        
        // Check if user is enrolled
        const enrollmentRef = await db.collection('enrollments')
            .doc(`${userId}_${courseId}`)
            .get();
        
        if (!enrollmentRef.exists) {
            return res.status(403).json({ 
                error: 'Not enrolled', 
                message: 'You must enroll in this course first' 
            });
        }
        
        // Get assessment
        const assessmentQuery = await db.collection('courses')
            .doc(courseId)
            .collection('assessments')
            .where('type', '==', type)
            .limit(1)
            .get();
        
        if (assessmentQuery.empty) {
            return res.status(404).json({ 
                error: 'Not found', 
                message: 'Assessment not found' 
            });
        }
        
        const assessmentDoc = assessmentQuery.docs[0];
        const assessment = assessmentDoc.data();
        assessment.id = assessmentDoc.id;
        
        // If there's a question bank, select random questions
        if (assessment.questionBank && assessment.questionBank.length > 0) {
            const totalNeeded = assessment.totalQuestions || 20;
            const shuffled = [...assessment.questionBank]
                .sort(() => 0.5 - Math.random())
                .slice(0, totalNeeded);
            
            // Add question IDs
            assessment.questions = shuffled.map((q, index) => ({
                ...q,
                id: index
            }));
        }
        
        // Log assessment access
        await db.collection('assessment_logs').add({
            userId: userId,
            courseId: courseId,
            assessmentId: assessment.id,
            type: type,
            accessedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        
        res.json({ success: true, assessment });
        
    } catch (error) {
        console.error('Get assessment error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Submit assessment
app.post('/api/assessment/:courseId/submit', authenticate, async (req, res) => {
    try {
        const { courseId } = req.params;
        const { assessmentId, answers, timeSpent, violations = 0 } = req.body;
        const userId = req.user.uid;
        
        console.log(`Submitting assessment: ${assessmentId}, user: ${userId}`);
        
        // Get assessment
        const assessmentDoc = await db.collection('courses')
            .doc(courseId)
            .collection('assessments')
            .doc(assessmentId)
            .get();
        
        if (!assessmentDoc.exists) {
            return res.status(404).json({ error: 'Assessment not found' });
        }
        
        const assessment = assessmentDoc.data();
        
        // Calculate score
        let correct = 0;
        const questionResults = [];
        
        assessment.questions.forEach((question, index) => {
            const userAnswer = answers[index];
            const isCorrect = userAnswer === question.correctAnswer;
            
            if (isCorrect) correct++;
            
            questionResults.push({
                questionId: index,
                question: question.question,
                userAnswer: userAnswer,
                correctAnswer: question.correctAnswer,
                isCorrect: isCorrect,
                explanation: question.explanation
            });
        });
        
        const score = Math.round((correct / assessment.questions.length) * 100);
        const passed = score >= 80;
        
        // Save result
        const resultData = {
            userId: userId,
            courseId: courseId,
            assessmentId: assessmentId,
            assessmentType: assessment.type,
            score: score,
            passed: passed,
            totalQuestions: assessment.questions.length,
            correctAnswers: correct,
            answers: answers,
            questionResults: questionResults,
            timeSpent: timeSpent,
            violations: violations,
            submittedAt: admin.firestore.FieldValue.serverTimestamp(),
            certificateEligible: passed && assessment.type === 'final'
        };
        
        const resultRef = await db.collection('users')
            .doc(userId)
            .collection('assessmentResults')
            .add(resultData);
        
        // Update course progress
        const progressRef = db.collection('users')
            .doc(userId)
            .collection('courseProgress')
            .doc(courseId);
        
        const progressDoc = await progressRef.get();
        let progress = progressDoc.exists ? progressDoc.data() : {
            userId: userId,
            courseId: courseId,
            completedLessons: 0,
            totalLessons: 0,
            startedAt: admin.firestore.FieldValue.serverTimestamp()
        };
        
        if (assessment.type === 'mid') {
            progress.midAssessmentPassed = passed;
            progress.midAssessmentScore = score;
            progress.midAssessmentCompleted = admin.firestore.FieldValue.serverTimestamp();
        } else if (assessment.type === 'final') {
            progress.finalAssessmentPassed = passed;
            progress.finalAssessmentScore = score;
            progress.finalAssessmentCompleted = admin.firestore.FieldValue.serverTimestamp();
            
            if (passed) {
                progress.completed = true;
                progress.completedAt = admin.firestore.FieldValue.serverTimestamp();
            }
        }
        
        progress.lastUpdated = admin.firestore.FieldValue.serverTimestamp();
        await progressRef.set(progress, { merge: true });
        
        // If passed and final, check certificate eligibility
        let certificateData = null;
        if (passed && assessment.type === 'final') {
            certificateData = await generateCertificate(userId, courseId, score, resultRef.id);
        }
        
        res.json({
            success: true,
            result: {
                id: resultRef.id,
                ...resultData,
                certificateData: certificateData
            }
        });
        
    } catch (error) {
        console.error('Submit assessment error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ======================
// ENROLLMENT ROUTES
// ======================

// Enroll in course
app.post('/api/enroll/:courseId', authenticate, async (req, res) => {
    try {
        const { courseId } = req.params;
        const userId = req.user.uid;
        
        // Check if course exists
        const courseDoc = await db.collection('courses').doc(courseId).get();
        if (!courseDoc.exists) {
            return res.status(404).json({ error: 'Course not found' });
        }
        
        const course = courseDoc.data();
        
        // Check if already enrolled
        const enrollmentId = `${userId}_${courseId}`;
        const enrollmentRef = db.collection('enrollments').doc(enrollmentId);
        const existingEnrollment = await enrollmentRef.get();
        
        if (existingEnrollment.exists) {
            return res.json({
                success: true,
                message: 'Already enrolled',
                enrollment: existingEnrollment.data()
            });
        }
        
        // Create enrollment
        const enrollmentData = {
            enrollmentId: enrollmentId,
            userId: userId,
            courseId: courseId,
            courseTitle: course.title,
            enrolledAt: admin.firestore.FieldValue.serverTimestamp(),
            progress: 0,
            completedLessons: 0,
            totalLessons: course.lessonsCount || 0,
            status: 'active',
            lastAccessed: admin.firestore.FieldValue.serverTimestamp()
        };
        
        await enrollmentRef.set(enrollmentData);
        
        // Update course enrollment count
        await db.collection('courses').doc(courseId).update({
            enrollmentCount: admin.firestore.FieldValue.increment(1),
            lastEnrollment: admin.firestore.FieldValue.serverTimestamp()
        });
        
        // Create initial progress record
        await db.collection('users')
            .doc(userId)
            .collection('courseProgress')
            .doc(courseId)
            .set({
                userId: userId,
                courseId: courseId,
                courseTitle: course.title,
                startedAt: admin.firestore.FieldValue.serverTimestamp(),
                lastAccessed: admin.firestore.FieldValue.serverTimestamp(),
                completedLessons: 0,
                totalLessons: course.lessonsCount || 0,
                progress: 0,
                status: 'active'
            }, { merge: true });
        
        res.json({
            success: true,
            message: 'Successfully enrolled',
            enrollment: enrollmentData
        });
        
    } catch (error) {
        console.error('Enrollment error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ======================
// USER PROGRESS ROUTES
// ======================

// Update lesson progress
app.post('/api/progress/:courseId/lesson/:lessonId', authenticate, async (req, res) => {
    try {
        const { courseId, lessonId } = req.params;
        const { completed } = req.body;
        const userId = req.user.uid;
        
        const progressRef = db.collection('users')
            .doc(userId)
            .collection('courseProgress')
            .doc(courseId);
        
        const progressDoc = await progressRef.get();
        let progress = progressDoc.exists ? progressDoc.data() : {};
        
        // Mark lesson as completed
        if (completed) {
            const completedLessonsRef = db.collection('users')
                .doc(userId)
                .collection('completedLessons')
                .doc(`${courseId}_${lessonId}`);
            
            await completedLessonsRef.set({
                userId: userId,
                courseId: courseId,
                lessonId: lessonId,
                completedAt: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            
            // Update progress
            progress.completedLessons = (progress.completedLessons || 0) + 1;
            progress.progress = progress.totalLessons > 0 ? 
                Math.round((progress.completedLessons / progress.totalLessons) * 100) : 0;
            
            if (progress.completedLessons === progress.totalLessons) {
                progress.allLessonsCompleted = true;
                progress.allLessonsCompletedAt = admin.firestore.FieldValue.serverTimestamp();
            }
        }
        
        progress.lastAccessed = admin.firestore.FieldValue.serverTimestamp();
        await progressRef.set(progress, { merge: true });
        
        res.json({ success: true, progress });
        
    } catch (error) {
        console.error('Progress update error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ======================
// PAYMENT ROUTES (use your existing routes)
// ======================
app.use('/api/payments', paymentRoutes);

// ======================
// WEBHOOKS (use your existing webhooks)
// ======================
app.use('/webhooks', paychanguWebhook);
app.use('/webhooks', paypalWebhook);

// ======================
// CERTIFICATE GENERATION
// ======================
async function generateCertificate(userId, courseId, score, resultId) {
    try {
        // Get user data
        const userDoc = await db.collection('users').doc(userId).get();
        const user = userDoc.data();
        
        // Get course data
        const courseDoc = await db.collection('courses').doc(courseId).get();
        const course = courseDoc.data();
        
        // Generate certificate ID
        const certificateId = `CERT-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
        
        const certificateData = {
            certificateId: certificateId,
            userId: userId,
            userEmail: user.email,
            userName: user.displayName || user.email.split('@')[0],
            courseId: courseId,
            courseTitle: course.title,
            courseCategory: course.category,
            assessmentResultId: resultId,
            score: score,
            issuedAt: admin.firestore.FieldValue.serverTimestamp(),
            expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year
            status: 'active',
            downloadUrl: `/api/certificates/${certificateId}/download`,
            viewUrl: `/api/certificates/${certificateId}/view`
        };
        
        // Save certificate
        await db.collection('certificates').doc(certificateId).set(certificateData);
        
        // Also save to user's certificates
        await db.collection('users')
            .doc(userId)
            .collection('certificates')
            .doc(certificateId)
            .set(certificateData);
        
        return certificateData;
        
    } catch (error) {
        console.error('Certificate generation error:', error);
        return null;
    }
}

// ======================
// ERROR HANDLING
// ======================
app.use((req, res) => {
    res.status(404).json({
        error: 'Not Found',
        message: `Cannot ${req.method} ${req.url}`
    });
});

app.use((error, req, res, next) => {
    console.error('Server error:', error);
    res.status(500).json({
        error: 'Internal Server Error',
        message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
    });
});

// ======================
// START SERVER
// ======================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 MRTC eCampus Backend running on port ${PORT}`);
    console.log(`📚 API Base URL: http://localhost:${PORT}`);
    console.log(`🏥 Health Check: http://localhost:${PORT}/api/health`);
    console.log(`📁 API Endpoints:`);
    console.log(`   GET  /api/courses - Get all courses`);
    console.log(`   GET  /api/assessment/:courseId - Get assessment`);
    console.log(`   POST /api/assessment/:courseId/submit - Submit assessment`);
    console.log(`   POST /api/enroll/:courseId - Enroll in course`);
    console.log(`   POST /api/progress/:courseId/lesson/:lessonId - Update progress`);
    console.log(`   POST /webhooks/paychangu - PayChangu webhook`);
    console.log(`   POST /webhooks/paypal - PayPal webhook`);
});