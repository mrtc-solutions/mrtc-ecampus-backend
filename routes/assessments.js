// backend/routes/assessments.js
const express = require('express');
const admin = require('firebase-admin');
const router = express.Router();
const Papa = require('papaparse');

// Initialize Firestore
const db = admin.firestore();

// ======================
// MIDDLEWARE
// ======================
const authenticateAdmin = async (req, res, next) => {
    try {
        const token = req.headers.authorization?.split('Bearer ')[1];
        
        if (!token) {
            return res.status(401).json({ error: 'No token provided' });
        }
        
        const decodedToken = await admin.auth().verifyIdToken(token);
        
        // Check if admin
        if (decodedToken.email !== 'stepstosucceed1@gmail.com' && !decodedToken.admin) {
            return res.status(403).json({ error: 'Admin access required' });
        }
        
        req.user = decodedToken;
        next();
    } catch (error) {
        console.error('Admin auth error:', error);
        res.status(401).json({ error: 'Invalid token' });
    }
};

// ======================
// 1. GET ASSESSMENT STATISTICS
// ======================
router.get('/stats', authenticateAdmin, async (req, res) => {
    try {
        const coursesSnapshot = await db.collection('courses').get();
        const allAssessments = [];
        
        for (const courseDoc of coursesSnapshot.docs) {
            const assessmentsSnapshot = await courseDoc.ref.collection('assessments').get();
            assessmentsSnapshot.docs.forEach(assessmentDoc => {
                allAssessments.push({
                    id: assessmentDoc.id,
                    courseId: courseDoc.id,
                    ...assessmentDoc.data()
                });
            });
        }
        
        // Calculate stats
        let totalQuestions = 0;
        const courseSet = new Set();
        
        allAssessments.forEach(assessment => {
            courseSet.add(assessment.courseId);
            totalQuestions += (assessment.questions || []).length;
        });
        
        res.json({
            success: true,
            stats: {
                totalCourses: courseSet.size,
                totalAssessments: allAssessments.length,
                totalQuestions: totalQuestions,
                assessmentsByType: {
                    mid: allAssessments.filter(a => a.type === 'mid').length,
                    final: allAssessments.filter(a => a.type === 'final').length,
                    practice: allAssessments.filter(a => a.type === 'practice').length
                }
            }
        });
        
    } catch (error) {
        console.error('Stats error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ======================
// 2. GET ALL ASSESSMENTS
// ======================
router.get('/all', authenticateAdmin, async (req, res) => {
    try {
        const coursesSnapshot = await db.collection('courses').get();
        const assessments = [];
        
        for (const courseDoc of coursesSnapshot.docs) {
            const course = courseDoc.data();
            const assessmentsSnapshot = await courseDoc.ref.collection('assessments').get();
            
            assessmentsSnapshot.docs.forEach(assessmentDoc => {
                const assessment = assessmentDoc.data();
                assessments.push({
                    id: assessmentDoc.id,
                    courseId: courseDoc.id,
                    courseName: course.title,
                    courseCategory: course.category,
                    ...assessment,
                    createdAt: assessment.createdAt?.toDate?.() || null,
                    updatedAt: assessment.updatedAt?.toDate?.() || null
                });
            });
        }
        
        // Sort by creation date (newest first)
        assessments.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        
        res.json({ success: true, assessments });
        
    } catch (error) {
        console.error('Get assessments error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ======================
// 3. GET ALL COURSES
// ======================
router.get('/courses', authenticateAdmin, async (req, res) => {
    try {
        const coursesSnapshot = await db.collection('courses')
            .where('isActive', '==', true)
            .get();
        
        const courses = coursesSnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
        
        res.json({ success: true, courses });
        
    } catch (error) {
        console.error('Get courses error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ======================
// 4. CREATE NEW ASSESSMENT
// ======================
router.post('/create', authenticateAdmin, async (req, res) => {
    try {
        const {
            courseId,
            name,
            type,
            description,
            timeLimit,
            passingScore,
            maxRetakes,
            randomizeQuestions,
            showAnswersFeedback,
            questions
        } = req.body;
        
        // Validate required fields
        if (!courseId || !name || !type || !timeLimit || !passingScore || !questions || !Array.isArray(questions)) {
            return res.status(400).json({ error: 'Missing required fields' });
        }
        
        // Validate questions
        const validatedQuestions = questions.map((q, index) => {
            if (!q.question || !q.options || !Array.isArray(q.options) || q.options.length < 2) {
                throw new Error(`Question ${index + 1}: Invalid format`);
            }
            
            // Convert correct answer if needed
            let correctAnswer = q.correctAnswer;
            if (typeof correctAnswer === 'string') {
                correctAnswer = correctAnswer.toUpperCase();
            }
            
            // Validate correct answer is within options
            const answerIndex = correctAnswer.charCodeAt(0) - 65;
            if (answerIndex >= q.options.length) {
                throw new Error(`Question ${index + 1}: Correct answer out of range`);
            }
            
            return {
                id: index,
                question: q.question.trim(),
                options: q.options.map(opt => opt.trim()),
                correctAnswer: correctAnswer,
                explanation: q.explanation || '',
                difficulty: q.difficulty || 'Medium',
                topic: q.topic || '',
                category: q.category || 'general'
            };
        });
        
        // Check if course exists
        const courseRef = db.collection('courses').doc(courseId);
        const courseDoc = await courseRef.get();
        
        if (!courseDoc.exists) {
            return res.status(404).json({ error: 'Course not found' });
        }
        
        // Create assessment
        const assessmentData = {
            courseId: courseId,
            name: name.trim(),
            type: type,
            description: description || '',
            timeLimit: parseInt(timeLimit),
            passingScore: parseInt(passingScore),
            maxRetakes: maxRetakes || 'unlimited',
            randomizeQuestions: Boolean(randomizeQuestions),
            showAnswersFeedback: Boolean(showAnswersFeedback),
            questions: validatedQuestions,
            totalQuestions: validatedQuestions.length,
            isActive: true,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };
        
        const assessmentRef = await courseRef.collection('assessments').add(assessmentData);
        
        // Also add to question bank if this is a question bank assessment
        if (req.body.isQuestionBank) {
            await addToQuestionBank(courseId, assessmentRef.id, validatedQuestions);
        }
        
        res.json({
            success: true,
            message: `Assessment "${name}" created successfully`,
            assessmentId: assessmentRef.id,
            assessment: {
                id: assessmentRef.id,
                ...assessmentData
            }
        });
        
    } catch (error) {
        console.error('Create assessment error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ======================
// 5. GET ASSESSMENT DETAILS
// ======================
router.get('/:assessmentId', authenticateAdmin, async (req, res) => {
    try {
        const { assessmentId } = req.params;
        const { courseId } = req.query;
        
        if (!courseId) {
            return res.status(400).json({ error: 'Course ID is required' });
        }
        
        const assessmentRef = db.collection('courses')
            .doc(courseId)
            .collection('assessments')
            .doc(assessmentId);
        
        const assessmentDoc = await assessmentRef.get();
        
        if (!assessmentDoc.exists) {
            return res.status(404).json({ error: 'Assessment not found' });
        }
        
        const assessment = assessmentDoc.data();
        
        // Get course name
        const courseDoc = await db.collection('courses').doc(courseId).get();
        const course = courseDoc.data();
        
        res.json({
            success: true,
            assessment: {
                id: assessmentDoc.id,
                courseId: courseId,
                courseName: course?.title || 'Unknown',
                ...assessment,
                createdAt: assessment.createdAt?.toDate?.() || null,
                updatedAt: assessment.updatedAt?.toDate?.() || null
            }
        });
        
    } catch (error) {
        console.error('Get assessment error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ======================
// 6. UPDATE ASSESSMENT
// ======================
router.put('/:assessmentId', authenticateAdmin, async (req, res) => {
    try {
        const { assessmentId } = req.params;
        const { courseId, ...updateData } = req.body;
        
        if (!courseId) {
            return res.status(400).json({ error: 'Course ID is required' });
        }
        
        const assessmentRef = db.collection('courses')
            .doc(courseId)
            .collection('assessments')
            .doc(assessmentId);
        
        // Check if exists
        const assessmentDoc = await assessmentRef.get();
        if (!assessmentDoc.exists) {
            return res.status(404).json({ error: 'Assessment not found' });
        }
        
        // Validate questions if updating
        if (updateData.questions && Array.isArray(updateData.questions)) {
            updateData.questions = updateData.questions.map((q, index) => ({
                id: index,
                question: q.question?.trim() || '',
                options: (q.options || []).map(opt => opt?.trim() || ''),
                correctAnswer: q.correctAnswer?.toUpperCase() || 'A',
                explanation: q.explanation || '',
                difficulty: q.difficulty || 'Medium',
                topic: q.topic || '',
                category: q.category || 'general'
            }));
            updateData.totalQuestions = updateData.questions.length;
        }
        
        updateData.updatedAt = admin.firestore.FieldValue.serverTimestamp();
        
        await assessmentRef.update(updateData);
        
        res.json({
            success: true,
            message: 'Assessment updated successfully'
        });
        
    } catch (error) {
        console.error('Update assessment error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ======================
// 7. DELETE ASSESSMENT
// ======================
router.delete('/:assessmentId', authenticateAdmin, async (req, res) => {
    try {
        const { assessmentId } = req.params;
        const { courseId } = req.body;
        
        if (!courseId) {
            return res.status(400).json({ error: 'Course ID is required' });
        }
        
        const assessmentRef = db.collection('courses')
            .doc(courseId)
            .collection('assessments')
            .doc(assessmentId);
        
        // Check if exists
        const assessmentDoc = await assessmentRef.get();
        if (!assessmentDoc.exists) {
            return res.status(404).json({ error: 'Assessment not found' });
        }
        
        await assessmentRef.delete();
        
        // Also remove from question bank if it exists there
        await removeFromQuestionBank(courseId, assessmentId);
        
        res.json({
            success: true,
            message: 'Assessment deleted successfully'
        });
        
    } catch (error) {
        console.error('Delete assessment error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ======================
// 8. IMPORT QUESTIONS FROM CSV
// ======================
router.post('/import/csv', authenticateAdmin, async (req, res) => {
    try {
        const { courseId, assessmentId, csvData } = req.body;
        
        if (!courseId || !assessmentId || !csvData) {
            return res.status(400).json({ error: 'Missing required fields' });
        }
        
        const assessmentRef = db.collection('courses')
            .doc(courseId)
            .collection('assessments')
            .doc(assessmentId);
        
        const assessmentDoc = await assessmentRef.get();
        if (!assessmentDoc.exists) {
            return res.status(404).json({ error: 'Assessment not found' });
        }
        
        // Parse CSV
        const results = Papa.parse(csvData, {
            header: false,
            skipEmptyLines: true
        });
        
        if (results.errors.length > 0) {
            return res.status(400).json({ 
                error: 'CSV parse error', 
                details: results.errors 
            });
        }
        
        const rows = results.data;
        if (rows.length < 2) {
            return res.status(400).json({ error: 'CSV must have at least a header row and one data row' });
        }
        
        const questions = [];
        const errors = [];
        
        // Process rows (skip header)
        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            if (!row || row.length < 7) {
                errors.push(`Row ${i}: Insufficient columns`);
                continue;
            }
            
            try {
                const question = row[0]?.trim();
                const optionA = row[1]?.trim();
                const optionB = row[2]?.trim();
                const optionC = row[3]?.trim();
                const optionD = row[4]?.trim();
                const correctAnswer = row[5]?.trim().toUpperCase();
                const explanation = row[6]?.trim();
                const difficulty = row[7]?.trim() || 'Medium';
                const topic = row[8]?.trim() || 'general';
                
                if (!question || !optionA || !optionB || !correctAnswer) {
                    errors.push(`Row ${i}: Missing required fields`);
                    continue;
                }
                
                const options = [optionA, optionB];
                if (optionC) options.push(optionC);
                if (optionD) options.push(optionD);
                
                // Validate correct answer
                const answerIndex = correctAnswer.charCodeAt(0) - 65;
                if (answerIndex >= options.length) {
                    errors.push(`Row ${i}: Correct answer out of range`);
                    continue;
                }
                
                questions.push({
                    id: questions.length,
                    question: question,
                    options: options,
                    correctAnswer: correctAnswer,
                    explanation: explanation,
                    difficulty: difficulty,
                    topic: topic,
                    category: 'imported'
                });
                
            } catch (error) {
                errors.push(`Row ${i}: ${error.message}`);
            }
        }
        
        if (questions.length === 0) {
            return res.status(400).json({ 
                error: 'No valid questions found', 
                details: errors 
            });
        }
        
        // Get existing questions
        const assessment = assessmentDoc.data();
        const existingQuestions = assessment.questions || [];
        
        // Add new questions
        const allQuestions = [...existingQuestions, ...questions];
        
        // Update assessment
        await assessmentRef.update({
            questions: allQuestions,
            totalQuestions: allQuestions.length,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        
        res.json({
            success: true,
            message: `Imported ${questions.length} questions successfully`,
            importedCount: questions.length,
            errorCount: errors.length,
            errors: errors,
            totalQuestions: allQuestions.length
        });
        
    } catch (error) {
        console.error('Import CSV error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ======================
// 9. GET QUESTION BANK
// ======================
router.get('/question-bank/all', authenticateAdmin, async (req, res) => {
    try {
        const coursesSnapshot = await db.collection('courses').get();
        const allQuestions = [];
        
        for (const courseDoc of coursesSnapshot.docs) {
            const course = courseDoc.data();
            const assessmentsSnapshot = await courseDoc.ref.collection('assessments').get();
            
            assessmentsSnapshot.docs.forEach(assessmentDoc => {
                const assessment = assessmentDoc.data();
                (assessment.questions || []).forEach((q, index) => {
                    allQuestions.push({
                        id: `${courseDoc.id}_${assessmentDoc.id}_${index}`,
                        courseId: courseDoc.id,
                        courseName: course.title,
                        assessmentId: assessmentDoc.id,
                        assessmentName: assessment.name,
                        questionIndex: index,
                        ...q
                    });
                });
            });
        }
        
        res.json({
            success: true,
            totalQuestions: allQuestions.length,
            questions: allQuestions
        });
        
    } catch (error) {
        console.error('Get question bank error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ======================
// 10. DELETE QUESTION FROM BANK
// ======================
router.delete('/question-bank/delete', authenticateAdmin, async (req, res) => {
    try {
        const { courseId, assessmentId, questionIndex } = req.body;
        
        if (!courseId || !assessmentId || questionIndex === undefined) {
            return res.status(400).json({ error: 'Missing required fields' });
        }
        
        const assessmentRef = db.collection('courses')
            .doc(courseId)
            .collection('assessments')
            .doc(assessmentId);
        
        const assessmentDoc = await assessmentRef.get();
        if (!assessmentDoc.exists) {
            return res.status(404).json({ error: 'Assessment not found' });
        }
        
        const assessment = assessmentDoc.data();
        const questions = assessment.questions || [];
        
        if (questionIndex < 0 || questionIndex >= questions.length) {
            return res.status(400).json({ error: 'Invalid question index' });
        }
        
        // Remove the question
        questions.splice(questionIndex, 1);
        
        // Update IDs for remaining questions
        questions.forEach((q, idx) => {
            q.id = idx;
        });
        
        await assessmentRef.update({
            questions: questions,
            totalQuestions: questions.length,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        
        res.json({
            success: true,
            message: 'Question deleted successfully',
            remainingQuestions: questions.length
        });
        
    } catch (error) {
        console.error('Delete question error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ======================
// 11. GENERATE AI QUESTIONS
// ======================
router.post('/generate/ai', authenticateAdmin, async (req, res) => {
    try {
        const { courseId, assessmentId, topic, count = 20, difficulty = 'Medium' } = req.body;
        
        // Check if user has AI credits
        const user = req.user;
        const userRef = db.collection('users').doc(user.uid);
        const userDoc = await userRef.get();
        const userData = userDoc.data();
        
        if (!userData.aiCredits || userData.aiCredits < count) {
            return res.status(402).json({ 
                error: 'Insufficient AI credits', 
                required: count, 
                available: userData.aiCredits || 0 
            });
        }
        
        // TODO: Integrate with Gemini API
        // For now, generate placeholder questions
        const generatedQuestions = generatePlaceholderQuestions(topic, count, difficulty);
        
        // Deduct credits
        await userRef.update({
            aiCredits: admin.firestore.FieldValue.increment(-count)
        });
        
        res.json({
            success: true,
            message: `Generated ${generatedQuestions.length} questions`,
            questions: generatedQuestions,
            creditsUsed: count,
            remainingCredits: (userData.aiCredits || 0) - count
        });
        
    } catch (error) {
        console.error('Generate AI questions error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ======================
// HELPER FUNCTIONS
// ======================
async function addToQuestionBank(courseId, assessmentId, questions) {
    try {
        const questionBankRef = db.collection('questionBank').doc(courseId);
        const questionBankDoc = await questionBankRef.get();
        
        const existingQuestions = questionBankDoc.exists ? questionBankDoc.data().questions || [] : [];
        
        // Add new questions with metadata
        const newQuestions = questions.map((q, index) => ({
            ...q,
            bankId: `${assessmentId}_${Date.now()}_${index}`,
            sourceAssessment: assessmentId,
            addedAt: admin.firestore.FieldValue.serverTimestamp()
        }));
        
        await questionBankRef.set({
            courseId: courseId,
            questions: [...existingQuestions, ...newQuestions],
            totalQuestions: existingQuestions.length + newQuestions.length,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        
    } catch (error) {
        console.error('Add to question bank error:', error);
    }
}

async function removeFromQuestionBank(courseId, assessmentId) {
    try {
        const questionBankRef = db.collection('questionBank').doc(courseId);
        const questionBankDoc = await questionBankRef.get();
        
        if (!questionBankDoc.exists) return;
        
        const questionBank = questionBankDoc.data();
        const remainingQuestions = questionBank.questions.filter(
            q => q.sourceAssessment !== assessmentId
        );
        
        await questionBankRef.update({
            questions: remainingQuestions,
            totalQuestions: remainingQuestions.length,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        
    } catch (error) {
        console.error('Remove from question bank error:', error);
    }
}

function generatePlaceholderQuestions(topic, count, difficulty) {
    const questions = [];
    
    for (let i = 0; i < count; i++) {
        questions.push({
            id: i,
            question: `${topic} question ${i + 1}?`,
            options: ['Option A', 'Option B', 'Option C', 'Option D'],
            correctAnswer: 'A',
            explanation: `This is the explanation for question ${i + 1}`,
            difficulty: difficulty,
            topic: topic,
            category: 'ai-generated',
            generatedAt: new Date().toISOString()
        });
    }
    
    return questions;
}

module.exports = router;