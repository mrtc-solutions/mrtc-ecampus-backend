const admin = require('firebase-admin');
const aiService = require('./aiService');

class AssessmentService {
    constructor() {
        this.db = admin.firestore();
    }

    // Get assessment for student (with AI rearrangement)
    async getStudentAssessment(courseId, userId, assessmentType = 'final') {
        try {
            // Get enrollment to check progress
            const enrollmentQuery = await this.db.collection('enrollments')
                .where('userId', '==', userId)
                .where('courseId', '==', courseId)
                .limit(1)
                .get();

            if (enrollmentQuery.empty) {
                throw new Error('Student not enrolled in this course');
            }

            const enrollment = enrollmentQuery.docs[0].data();
            
            // Check if assessment already taken
            if (assessmentType === 'mid' && enrollment.midAssessmentTaken) {
                throw new Error('Mid-assessment already taken');
            }
            
            if (assessmentType === 'final' && enrollment.finalAssessmentTaken) {
                throw new Error('Final assessment already taken');
            }

            // Get course assessment questions
            const courseDoc = await this.db.collection('courses').doc(courseId).get();
            if (!courseDoc.exists) {
                throw new Error('Course not found');
            }

            const course = courseDoc.data();
            let questionBank = [];
            
            if (assessmentType === 'mid') {
                questionBank = course.midAssessmentQuestions || [];
            } else {
                questionBank = course.finalAssessmentQuestions || [];
            }

            if (questionBank.length === 0) {
                throw new Error(`No ${assessmentType} assessment questions found`);
            }

            // Select random questions (40 questions per assessment)
            const selectedQuestions = this.selectRandomQuestions(questionBank, 40);
            
            // Rearrange with AI
            const rearrangedQuestions = await aiService.rearrangeQuestions(selectedQuestions);
            
            // Create assessment session
            const assessmentRef = this.db.collection('assessments').doc();
            const assessmentId = assessmentRef.id;
            
            await assessmentRef.set({
                id: assessmentId,
                courseId: courseId,
                userId: userId,
                enrollmentId: enrollment.id,
                assessmentType: assessmentType,
                questions: rearrangedQuestions.questions || rearrangedQuestions,
                totalQuestions: 40,
                status: 'in_progress',
                startedAt: admin.firestore.FieldValue.serverTimestamp(),
                timeLimit: 3600, // 1 hour in seconds
                security: {
                    disableCopy: true,
                    disableScreenshot: true,
                    fullscreenRequired: true,
                    tabSwitchLimit: 3
                }
            });

            return {
                success: true,
                assessmentId: assessmentId,
                questions: rearrangedQuestions.questions || rearrangedQuestions,
                timeLimit: 3600,
                courseName: course.title,
                assessmentType: assessmentType
            };
        } catch (error) {
            console.error('Assessment creation error:', error);
            return { success: false, error: error.message };
        }
    }

    // Select random questions from bank
    selectRandomQuestions(questionBank, count) {
        const shuffled = [...questionBank].sort(() => Math.random() - 0.5);
        return shuffled.slice(0, Math.min(count, shuffled.length));
    }

    // Submit assessment and calculate score
    async submitAssessment(assessmentId, answers) {
        try {
            const assessmentRef = this.db.collection('assessments').doc(assessmentId);
            const assessmentDoc = await assessmentRef.get();
            
            if (!assessmentDoc.exists) {
                throw new Error('Assessment not found');
            }

            const assessment = assessmentDoc.data();
            
            // Check if already submitted
            if (assessment.status === 'completed') {
                throw new Error('Assessment already submitted');
            }

            // Calculate score
            let correctCount = 0;
            const results = [];
            
            assessment.questions.forEach((question, index) => {
                const studentAnswer = answers[index];
                const isCorrect = studentAnswer === question.correctAnswer;
                
                if (isCorrect) correctCount++;
                
                results.push({
                    questionId: question.id,
                    questionText: question.text,
                    studentAnswer: studentAnswer,
                    correctAnswer: question.correctAnswer,
                    isCorrect: isCorrect,
                    explanation: question.explanation
                });
            });

            const score = Math.round((correctCount / assessment.totalQuestions) * 100);
            
            // Determine if passed (80% or higher)
            const passed = score >= 80;
            
            // Generate feedback using AI
            const weakAreas = this.identifyWeakAreas(results);
            const feedback = await aiService.generateAssessmentFeedback(score, weakAreas);
            
            // Update assessment
            await assessmentRef.update({
                status: 'completed',
                submittedAt: admin.firestore.FieldValue.serverTimestamp(),
                answers: answers,
                results: results,
                score: score,
                correctCount: correctCount,
                passed: passed,
                feedback: feedback,
                completedAt: admin.firestore.FieldValue.serverTimestamp()
            });

            // Update enrollment
            const enrollmentRef = this.db.collection('enrollments').doc(assessment.enrollmentId);
            
            if (assessment.assessmentType === 'mid') {
                await enrollmentRef.update({
                    midAssessmentTaken: true,
                    midAssessmentScore: score,
                    midAssessmentDate: admin.firestore.FieldValue.serverTimestamp()
                });
            } else {
                await enrollmentRef.update({
                    finalAssessmentTaken: true,
                    finalAssessmentScore: score,
                    finalAssessmentDate: admin.firestore.FieldValue.serverTimestamp(),
                    certificateEarned: passed
                });
            }

            return {
                success: true,
                score: score,
                passed: passed,
                correctCount: correctCount,
                totalQuestions: assessment.totalQuestions,
                feedback: feedback,
                weakAreas: weakAreas
            };
        } catch (error) {
            console.error('Assessment submission error:', error);
            return { success: false, error: error.message };
        }
    }

    // Identify weak areas from results
    identifyWeakAreas(results) {
        const incorrectQuestions = results.filter(r => !r.isCorrect);
        return incorrectQuestions.map(q => ({
            question: q.questionText,
            topic: this.extractTopic(q.questionText)
        }));
    }

    extractTopic(questionText) {
        // Simple topic extraction - can be enhanced
        const topics = [
            'introduction', 'basics', 'advanced', 'practical', 'theory',
            'concepts', 'applications', 'examples', 'case studies'
        ];
        
        const found = topics.find(topic => 
            questionText.toLowerCase().includes(topic)
        );
        
        return found || 'general';
    }

    // Get assessment results
    async getAssessmentResults(assessmentId) {
        try {
            const assessmentDoc = await this.db.collection('assessments').doc(assessmentId).get();
            
            if (!assessmentDoc.exists) {
                throw new Error('Assessment not found');
            }

            const assessment = assessmentDoc.data();
            
            // Only return results if completed
            if (assessment.status !== 'completed') {
                return { 
                    success: false, 
                    error: 'Assessment not yet completed',
                    status: assessment.status 
                };
            }

            return {
                success: true,
                assessment: assessment
            };
        } catch (error) {
            console.error('Get results error:', error);
            return { success: false, error: error.message };
        }
    }
}

module.exports = new AssessmentService();