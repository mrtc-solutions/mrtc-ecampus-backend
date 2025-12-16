// backend/setup-database.js - Run this ONCE to create sample data
const admin = require('firebase-admin');
const serviceAccount = require('../firebase-admin-key.json');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function setupDatabase() {
    console.log('🚀 Setting up database...');
    
    try {
        // ======================
        // 1. CREATE SAMPLE COURSES
        // ======================
        const courses = [
            {
                id: 'digital-skills-101',
                title: 'Introduction to Digital Skills',
                description: 'Learn essential digital skills for the modern workplace in Malawi',
                shortDescription: 'Master computer basics, internet, email, and online safety',
                category: 'digital',
                subcategory: 'beginner',
                instructor: 'MRTC Admin Team',
                duration: '4 weeks',
                lessonsCount: 8,
                difficulty: 'beginner',
                language: 'English',
                price: 0,
                currency: 'USD',
                mwkPrice: 0,
                isFree: true,
                featured: true,
                rating: 4.8,
                enrollmentCount: 125,
                imageUrl: 'assets/images/course-placeholder.jpg',
                learningObjectives: [
                    'Understand computer hardware and software',
                    'Use internet safely and effectively',
                    'Create and manage email accounts',
                    'Use Microsoft Office basics',
                    'Protect personal information online'
                ],
                requirements: ['No prior experience needed', 'Basic literacy'],
                targetAudience: ['Beginners', 'Job seekers', 'Small business owners'],
                isActive: true,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            },
            {
                id: 'web-development-bootcamp',
                title: 'Web Development Bootcamp',
                description: 'Full-stack web development course focusing on modern technologies',
                shortDescription: 'Build responsive websites with HTML, CSS, JavaScript, and Firebase',
                category: 'technology',
                subcategory: 'programming',
                instructor: 'MRTC Development Team',
                duration: '12 weeks',
                lessonsCount: 24,
                difficulty: 'intermediate',
                language: 'English',
                price: 49.99,
                currency: 'USD',
                mwkPrice: 39992, // 49.99 * 800
                isFree: false,
                featured: true,
                rating: 4.9,
                enrollmentCount: 89,
                imageUrl: 'assets/images/course-webdev.jpg',
                learningObjectives: [
                    'Build responsive websites with HTML5 & CSS3',
                    'Create dynamic web apps with JavaScript',
                    'Connect to databases with Firebase',
                    'Deploy websites to production',
                    'Build a portfolio project'
                ],
                requirements: ['Basic computer skills', 'Internet access'],
                targetAudience: ['Aspiring developers', 'Entrepreneurs', 'Students'],
                isActive: true,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            }
        ];
        
        for (const course of courses) {
            await db.collection('courses').doc(course.id).set(course);
            console.log(`✅ Created course: ${course.title}`);
        }
        
        // ======================
        // 2. CREATE ASSESSMENTS FOR DIGITAL SKILLS COURSE
        // ======================
        const digitalSkillsAssessments = [
            {
                id: 'mid-assessment',
                courseId: 'digital-skills-101',
                type: 'mid',
                title: 'Mid-Course Digital Skills Assessment',
                description: 'Test your understanding after completing 50% of the course',
                totalQuestions: 20,
                timeLimit: 30, // minutes
                passingScore: 80,
                questions: [
                    {
                        id: 0,
                        question: 'What does CPU stand for in computing?',
                        options: [
                            'Central Processing Unit',
                            'Computer Personal Unit',
                            'Central Personal Unit',
                            'Computer Processing Unit'
                        ],
                        correctAnswer: 0,
                        explanation: 'CPU stands for Central Processing Unit, which is the brain of the computer that processes instructions.',
                        category: 'hardware',
                        difficulty: 'easy',
                        points: 1
                    },
                    {
                        id: 1,
                        question: 'Which of these is NOT an input device?',
                        options: [
                            'Keyboard',
                            'Mouse',
                            'Monitor',
                            'Scanner'
                        ],
                        correctAnswer: 2,
                        explanation: 'Monitor is an output device that displays information. Input devices are used to enter data into a computer.',
                        category: 'hardware',
                        difficulty: 'easy',
                        points: 1
                    },
                    {
                        id: 2,
                        question: 'What is the purpose of RAM in a computer?',
                        options: [
                            'Permanent storage of files and documents',
                            'Temporary storage of running programs and data',
                            'Connecting to the internet',
                            'Processing graphics and video'
                        ],
                        correctAnswer: 1,
                        explanation: 'RAM (Random Access Memory) provides temporary storage for programs and data that are currently in use.',
                        category: 'hardware',
                        difficulty: 'medium',
                        points: 1
                    },
                    {
                        id: 3,
                        question: 'Which file extension indicates a Microsoft Word document?',
                        options: [
                            '.txt',
                            '.docx',
                            '.pdf',
                            '.jpg'
                        ],
                        correctAnswer: 1,
                        explanation: '.docx is the file extension for Microsoft Word documents created in Word 2007 and later versions.',
                        category: 'software',
                        difficulty: 'easy',
                        points: 1
                    },
                    {
                        id: 4,
                        question: 'What does URL stand for?',
                        options: [
                            'Uniform Resource Locator',
                            'Universal Reference Link',
                            'Uniform Reference Locator',
                            'Universal Resource Link'
                        ],
                        correctAnswer: 0,
                        explanation: 'URL stands for Uniform Resource Locator, which is the address of a web page on the internet.',
                        category: 'internet',
                        difficulty: 'easy',
                        points: 1
                    }
                    // Add 15 more questions...
                ],
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                isActive: true
            },
            {
                id: 'final-assessment',
                courseId: 'digital-skills-101',
                type: 'final',
                title: 'Final Digital Skills Assessment',
                description: 'Comprehensive test covering all course material',
                totalQuestions: 40,
                timeLimit: 45,
                passingScore: 80,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                isActive: true
            }
        ];
        
        for (const assessment of digitalSkillsAssessments) {
            await db.collection('courses')
                .doc(assessment.courseId)
                .collection('assessments')
                .doc(assessment.id)
                .set(assessment);
            
            console.log(`✅ Created ${assessment.type} assessment for ${assessment.courseId}`);
        }
        
        // ======================
        // 3. CREATE LESSONS FOR DIGITAL SKILLS COURSE
        // ======================
        const lessons = [
            {
                id: 'lesson-1',
                courseId: 'digital-skills-101',
                title: 'Understanding Computer Hardware',
                description: 'Learn about the physical components of a computer',
                content: '<h2>Computer Hardware Components</h2><p>A computer consists of several key hardware components...</p>',
                duration: '30 minutes',
                order: 1,
                videoUrl: '',
                resources: [],
                isActive: true,
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            },
            {
                id: 'lesson-2',
                courseId: 'digital-skills-101',
                title: 'Introduction to Operating Systems',
                description: 'Learn about Windows, macOS, and Linux operating systems',
                content: '<h2>What is an Operating System?</h2><p>An operating system (OS) manages computer hardware and software...</p>',
                duration: '45 minutes',
                order: 2,
                videoUrl: '',
                resources: [],
                isActive: true,
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            }
            // Add 6 more lessons...
        ];
        
        for (const lesson of lessons) {
            await db.collection('courses')
                .doc(lesson.courseId)
                .collection('lessons')
                .doc(lesson.id)
                .set(lesson);
            
            console.log(`✅ Created lesson: ${lesson.title}`);
        }
        
        console.log('\n🎉 Database setup completed successfully!');
        console.log('\n📊 Sample Data Created:');
        console.log('   - 2 Courses (1 free, 1 paid)');
        console.log('   - 2 Assessments (mid & final) with questions');
        console.log('   - 8 Lessons for Digital Skills course');
        console.log('\n🚀 Your backend is ready to use!');
        console.log('\n👉 Start the server: cd backend && npm start');
        console.log('👉 Test the API: http://localhost:3000/api/health');
        
        process.exit(0);
        
    } catch (error) {
        console.error('❌ Database setup error:', error);
        process.exit(1);
    }
}

setupDatabase();