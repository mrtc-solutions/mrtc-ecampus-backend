class MRTCFirestore {
    constructor() {
        this.db = firebase.firestore();
    }

    // Course Management
    async createCourse(courseData) {
        try {
            const courseRef = await this.db.collection('courses').add({
                ...courseData,
                status: 'draft',
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                studentsEnrolled: 0,
                averageRating: 0,
                totalRatings: 0
            });
            return { success: true, courseId: courseRef.id };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async updateCourse(courseId, updates) {
        try {
            await this.db.collection('courses').doc(courseId).update({
                ...updates,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async getCourses(filters = {}) {
        try {
            let query = this.db.collection('courses');
            
            // Apply filters
            if (filters.category) {
                query = query.where('category', '==', filters.category);
            }
            if (filters.status) {
                query = query.where('status', '==', filters.status);
            }
            if (filters.isFree !== undefined) {
                query = query.where('isFree', '==', filters.isFree);
            }
            
            const snapshot = await query.orderBy('createdAt', 'desc').get();
            const courses = [];
            snapshot.forEach(doc => {
                courses.push({ id: doc.id, ...doc.data() });
            });
            return courses;
        } catch (error) {
            console.error('Error getting courses:', error);
            return [];
        }
    }

    // Enrollment Management
    async enrollStudent(courseId, userId) {
        try {
            const enrollmentRef = await this.db.collection('enrollments').add({
                courseId,
                userId,
                enrolledAt: firebase.firestore.FieldValue.serverTimestamp(),
                progress: 0,
                completed: false,
                lastAccessed: firebase.firestore.FieldValue.serverTimestamp()
            });

            // Update course enrollment count
            await this.db.collection('courses').doc(courseId).update({
                studentsEnrolled: firebase.firestore.FieldValue.increment(1)
            });

            return { success: true, enrollmentId: enrollmentRef.id };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    // Assessment Management
    async createAssessment(courseId, questions) {
        try {
            const assessmentRef = await this.db.collection('assessments').add({
                courseId,
                questions,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                isActive: true
            });
            return { success: true, assessmentId: assessmentRef.id };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    // Certificate Management
    async generateCertificate(userId, courseId, score) {
        try {
            const certificateId = this.generateCertificateId();
            const certificateRef = await this.db.collection('certificates').add({
                certificateId,
                userId,
                courseId,
                score,
                issuedAt: firebase.firestore.FieldValue.serverTimestamp(),
                verified: true,
                downloadCount: 0
            });
            return { success: true, certificateId: certificateRef.id };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    generateCertificateId() {
        const timestamp = Date.now();
        const random = Math.random().toString(36).substr(2, 9);
        return `MRTC-${timestamp}-${random}`.toUpperCase();
    }

    // Admin Dashboard Data
    async getDashboardStats() {
        try {
            const [
                totalStudents,
                totalCourses,
                totalEnrollments,
                pendingEnrollments,
                totalRevenue
            ] = await Promise.all([
                this.db.collection('users').where('role', '==', 'student').get(),
                this.db.collection('courses').where('status', '==', 'published').get(),
                this.db.collection('enrollments').get(),
                this.db.collection('enrollments').where('completed', '==', false).get(),
                this.db.collection('payments').get()
            ]);

            return {
                totalStudents: totalStudents.size,
                totalCourses: totalCourses.size,
                totalEnrollments: totalEnrollments.size,
                pendingEnrollments: pendingEnrollments.size,
                totalRevenue: totalRevenue.docs.reduce((sum, doc) => sum + (doc.data().amount || 0), 0)
            };
        } catch (error) {
            console.error('Error getting dashboard stats:', error);
            return null;
        }
    }
}

// Initialize and export
window.MRTCFirestore = new MRTCFirestore();