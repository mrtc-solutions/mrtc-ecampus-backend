// =============================================
// COURSE SERVICE - Backend Business Logic
// =============================================
const admin = require('firebase-admin');
const { googleDriveService } = require('./googleDriveService');

class CourseService {
  constructor() {
    this.db = admin.firestore();
  }

  // Get all published courses with pagination
  async getCourses({ page = 1, limit = 12, category = null, filter = 'all', search = '' }) {
    try {
      let query = this.db.collection('courses').where('isPublished', '==', true);

      // Apply filters
      if (category && category !== 'all') {
        query = query.where('category', '==', category);
      }

      if (filter === 'free') {
        query = query.where('price', '==', 0);
      } else if (filter === 'paid') {
        query = query.where('price', '>', 0);
      } else if (filter === 'featured') {
        query = query.where('isFeatured', '==', true);
      }

      // Apply search
      if (search) {
        // This is a simple search - for production, consider using Algolia or ElasticSearch
        query = query.orderBy('title');
      }

      query = query.orderBy('createdAt', 'desc');

      const snapshot = await query.get();
      const allCourses = [];

      snapshot.forEach(doc => {
        const courseData = doc.data();
        // Apply search filter in memory
        if (search) {
          const searchLower = search.toLowerCase();
          const matches = 
            courseData.title?.toLowerCase().includes(searchLower) ||
            courseData.description?.toLowerCase().includes(searchLower) ||
            courseData.category?.toLowerCase().includes(searchLower) ||
            courseData.tags?.some(tag => tag.toLowerCase().includes(searchLower));

          if (!matches) return;
        }

        allCourses.push({
          id: doc.id,
          ...courseData,
          createdAt: courseData.createdAt?.toDate(),
          updatedAt: courseData.updatedAt?.toDate()
        });
      });

      // Pagination
      const total = allCourses.length;
      const totalPages = Math.ceil(total / limit);
      const startIndex = (page - 1) * limit;
      const endIndex = startIndex + limit;
      const courses = allCourses.slice(startIndex, endIndex);

      // Add enrollment stats
      const coursesWithStats = await Promise.all(
        courses.map(async (course) => {
          const stats = await this.getCourseStats(course.id);
          return { ...course, ...stats };
        })
      );

      return {
        courses: coursesWithStats,
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1
        }
      };
    } catch (error) {
      console.error('Error getting courses:', error);
      throw error;
    }
  }

  // Get single course by ID
  async getCourseById(courseId) {
    try {
      const courseDoc = await this.db.collection('courses').doc(courseId).get();
      
      if (!courseDoc.exists) {
        throw new Error('Course not found');
      }

      const course = {
        id: courseDoc.id,
        ...courseDoc.data()
      };

      // Get course statistics
      const stats = await this.getCourseStats(courseId);
      
      // Get instructor details
      if (course.instructorId) {
        const instructor = await this.getInstructor(course.instructorId);
        course.instructor = instructor;
      }

      // Get curriculum
      const curriculum = await this.getCourseCurriculum(courseId);
      course.curriculum = curriculum;

      return { ...course, ...stats };
    } catch (error) {
      console.error('Error getting course:', error);
      throw error;
    }
  }

  // Get course statistics
  async getCourseStats(courseId) {
    try {
      const enrollmentsSnapshot = await this.db.collection('enrollments')
        .where('courseId', '==', courseId)
        .where('status', '==', 'active')
        .get();

      const reviewsSnapshot = await this.db.collection('course_reviews')
        .where('courseId', '==', courseId)
        .get();

      const completionsSnapshot = await this.db.collection('enrollments')
        .where('courseId', '==', courseId)
        .where('progress', '==', 100)
        .get();

      // Calculate average rating
      let totalRating = 0;
      reviewsSnapshot.forEach(doc => {
        totalRating += doc.data().rating || 0;
      });

      return {
        totalStudents: enrollmentsSnapshot.size,
        totalReviews: reviewsSnapshot.size,
        totalCompletions: completionsSnapshot.size,
        averageRating: reviewsSnapshot.size > 0 
          ? (totalRating / reviewsSnapshot.size).toFixed(1) 
          : 0,
        ratingDistribution: await this.getRatingDistribution(courseId)
      };
    } catch (error) {
      console.error('Error getting course stats:', error);
      return {
        totalStudents: 0,
        totalReviews: 0,
        totalCompletions: 0,
        averageRating: 0,
        ratingDistribution: {}
      };
    }
  }

  // Get rating distribution
  async getRatingDistribution(courseId) {
    try {
      const reviewsSnapshot = await this.db.collection('course_reviews')
        .where('courseId', '==', courseId)
        .get();

      const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      
      reviewsSnapshot.forEach(doc => {
        const rating = Math.round(doc.data().rating) || 0;
        if (rating >= 1 && rating <= 5) {
          distribution[rating]++;
        }
      });

      return distribution;
    } catch (error) {
      console.error('Error getting rating distribution:', error);
      return { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    }
  }

  // Get instructor details
  async getInstructor(instructorId) {
    try {
      const instructorDoc = await this.db.collection('instructors').doc(instructorId).get();
      
      if (!instructorDoc.exists) {
        return {
          name: 'MRTC eCampus',
          title: 'Lead Instructor',
          bio: 'Professional instructor with years of experience',
          image: 'assets/images/user-avatar-placeholder.png',
          rating: 4.5,
          totalStudents: 0,
          totalCourses: 0
        };
      }

      const data = instructorDoc.data();
      
      // Get instructor statistics
      const coursesSnapshot = await this.db.collection('courses')
        .where('instructorId', '==', instructorId)
        .where('isPublished', '==', true)
        .get();

      const enrollmentsSnapshot = await this.db.collection('enrollments')
        .where('courseId', 'in', coursesSnapshot.docs.map(doc => doc.id))
        .get();

      const reviewsSnapshot = await this.db.collection('instructor_reviews')
        .where('instructorId', '==', instructorId)
        .get();

      let totalRating = 0;
      reviewsSnapshot.forEach(doc => {
        totalRating += doc.data().rating || 0;
      });

      return {
        id: instructorDoc.id,
        name: data.name || 'MRTC eCampus',
        title: data.title || 'Lead Instructor',
        bio: data.bio || 'Professional instructor with years of experience',
        image: data.image || 'assets/images/user-avatar-placeholder.png',
        rating: reviewsSnapshot.size > 0 ? (totalRating / reviewsSnapshot.size).toFixed(1) : 4.5,
        totalStudents: enrollmentsSnapshot.size,
        totalCourses: coursesSnapshot.size,
        socialLinks: data.socialLinks || {}
      };
    } catch (error) {
      console.error('Error getting instructor:', error);
      return {
        name: 'MRTC eCampus',
        title: 'Lead Instructor',
        bio: 'Professional instructor with years of experience',
        image: 'assets/images/user-avatar-placeholder.png',
        rating: 4.5,
        totalStudents: 0,
        totalCourses: 0
      };
    }
  }

  // Get course curriculum
  async getCourseCurriculum(courseId) {
    try {
      const curriculumSnapshot = await this.db.collection('course_curriculum')
        .where('courseId', '==', courseId)
        .orderBy('order', 'asc')
        .get();

      const curriculum = [];
      
      curriculumSnapshot.forEach(doc => {
        const data = doc.data();
        curriculum.push({
          id: doc.id,
          ...data
        });
      });

      return curriculum;
    } catch (error) {
      console.error('Error getting curriculum:', error);
      return [];
    }
  }

  // Enroll student in course
  async enrollStudent(courseId, studentId, studentEmail, isFree = false) {
    try {
      // Check if already enrolled
      const existingEnrollment = await this.db.collection('enrollments')
        .where('courseId', '==', courseId)
        .where('studentId', '==', studentId)
        .get();

      if (!existingEnrollment.empty) {
        throw new Error('Student is already enrolled in this course');
      }

      // Get course details
      const course = await this.getCourseById(courseId);

      // Create enrollment record
      const enrollmentId = this.db.collection('enrollments').doc().id;
      const enrollmentData = {
        enrollmentId,
        studentId,
        studentEmail,
        studentName: studentEmail.split('@')[0],
        courseId,
        courseTitle: course.title,
        coursePrice: course.price || 0,
        enrollmentDate: admin.firestore.FieldValue.serverTimestamp(),
        startDate: admin.firestore.FieldValue.serverTimestamp(),
        progress: 0,
        completedLessons: [],
        status: 'active',
        isPaid: !isFree,
        paymentAmount: isFree ? 0 : course.price,
        paymentMethod: isFree ? 'free' : null,
        paymentStatus: isFree ? 'completed' : 'pending',
        certificateEligible: false,
        lastAccessed: admin.firestore.FieldValue.serverTimestamp()
      };

      await this.db.collection('enrollments').doc(enrollmentId).set(enrollmentData);

      // Update course student count
      await this.db.collection('courses').doc(courseId).update({
        totalStudents: admin.firestore.FieldValue.increment(1),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      // Create initial progress record
      await this.db.collection('student_progress').doc(`${studentId}_${courseId}`).set({
        studentId,
        courseId,
        enrollmentId,
        progress: 0,
        completedModules: [],
        quizScores: {},
        lastActivity: admin.firestore.FieldValue.serverTimestamp(),
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      // Send enrollment confirmation email
      await this.sendEnrollmentEmail(studentEmail, course.title, isFree);

      return {
        success: true,
        enrollmentId,
        courseTitle: course.title,
        redirectUrl: `/course-player.html?courseId=${courseId}`
      };
    } catch (error) {
      console.error('Error enrolling student:', error);
      throw error;
    }
  }

  // Process course purchase (for paid courses)
  async processCoursePurchase(courseId, studentId, paymentData) {
    try {
      const { amount, method, transactionId } = paymentData;

      // Get course price
      const course = await this.getCourseById(courseId);
      
      // Payment validation - ensure correct amount
      const coursePrice = course.price || 0;
      const paidAmount = parseFloat(amount);

      if (paidAmount < coursePrice) {
        throw new Error(`Payment amount (${paidAmount}) is less than required course price (${coursePrice})`);
      }

      // Create payment record
      const paymentId = this.db.collection('payments').doc().id;
      const paymentRecord = {
        paymentId,
        studentId,
        courseId,
        courseTitle: course.title,
        amount: paidAmount,
        originalPrice: coursePrice,
        discount: paidAmount > coursePrice ? paidAmount - coursePrice : 0,
        currency: 'USD',
        localAmount: coursePrice * 800, // MWK equivalent
        paymentMethod: method,
        transactionId,
        status: 'completed',
        paymentDate: admin.firestore.FieldValue.serverTimestamp(),
        metadata: {
          exchangeRate: 800,
          country: 'Malawi'
        }
      };

      await this.db.collection('payments').doc(paymentId).set(paymentRecord);

      // Enroll student after successful payment
      const enrollment = await this.enrollStudent(courseId, studentId, studentEmail, false);

      // Update enrollment with payment info
      await this.db.collection('enrollments').doc(enrollment.enrollmentId).update({
        isPaid: true,
        paymentAmount: paidAmount,
        paymentMethod: method,
        paymentStatus: 'completed',
        paymentId: paymentId
      });

      // Send payment confirmation email
      await this.sendPaymentConfirmationEmail(studentEmail, course.title, paidAmount, method);

      return {
        success: true,
        paymentId,
        enrollmentId: enrollment.enrollmentId,
        courseTitle: course.title,
        amount: paidAmount,
        redirectUrl: `/course-player.html?courseId=${courseId}`
      };
    } catch (error) {
      console.error('Error processing purchase:', error);
      throw error;
    }
  }

  // Get student's enrolled courses
  async getStudentCourses(studentId) {
    try {
      const enrollmentsSnapshot = await this.db.collection('enrollments')
        .where('studentId', '==', studentId)
        .where('status', '==', 'active')
        .get();

      const courseIds = [];
      const enrollmentMap = {};

      enrollmentsSnapshot.forEach(doc => {
        const data = doc.data();
        courseIds.push(data.courseId);
        enrollmentMap[data.courseId] = {
          enrollmentId: doc.id,
          progress: data.progress || 0,
          enrollmentDate: data.enrollmentDate,
          status: data.status
        };
      });

      if (courseIds.length === 0) return [];

      // Get course details
      const courses = await Promise.all(
        courseIds.map(async (courseId) => {
          const course = await this.getCourseById(courseId);
          return {
            ...course,
            enrollment: enrollmentMap[courseId]
          };
        })
      );

      return courses;
    } catch (error) {
      console.error('Error getting student courses:', error);
      return [];
    }
  }

  // Get course categories
  async getCourseCategories() {
    try {
      const snapshot = await this.db.collection('course_categories')
        .where('isActive', '==', true)
        .orderBy('order', 'asc')
        .get();

      const categories = [];
      
      snapshot.forEach(doc => {
        const data = doc.data();
        categories.push({
          id: doc.id,
          ...data
        });
      });

      return categories;
    } catch (error) {
      console.error('Error getting categories:', error);
      return [];
    }
  }

  // Create or update course (admin function)
  async saveCourse(courseData, userId) {
    try {
      const courseId = courseData.id || this.db.collection('courses').doc().id;
      const isNew = !courseData.id;

      const course = {
        title: courseData.title,
        description: courseData.description,
        shortDescription: courseData.shortDescription || '',
        category: courseData.category,
        subcategory: courseData.subcategory || '',
        tags: courseData.tags || [],
        price: parseFloat(courseData.price) || 0,
        salePrice: parseFloat(courseData.salePrice) || null,
        isFree: parseFloat(courseData.price) === 0,
        currency: courseData.currency || 'USD',
        localPrice: (parseFloat(courseData.price) || 0) * 800,
        duration: courseData.duration || 0,
        level: courseData.level || 'beginner',
        language: courseData.language || 'english',
        coverImage: courseData.coverImage || '',
        promoVideo: courseData.promoVideo || '',
        instructorId: courseData.instructorId || userId,
        instructorName: courseData.instructorName || '',
        instructorImage: courseData.instructorImage || '',
        isFeatured: Boolean(courseData.isFeatured),
        isPublished: Boolean(courseData.isPublished),
        isApproved: Boolean(courseData.isApproved),
        learningOutcomes: courseData.learningOutcomes || [],
        prerequisites: courseData.prerequisites || [],
        targetAudience: courseData.targetAudience || [],
        totalStudents: isNew ? 0 : courseData.totalStudents || 0,
        totalReviews: isNew ? 0 : courseData.totalReviews || 0,
        averageRating: isNew ? 0 : courseData.averageRating || 0,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: userId
      };

      if (isNew) {
        course.createdAt = admin.firestore.FieldValue.serverTimestamp();
        course.createdBy = userId;
      }

      await this.db.collection('courses').doc(courseId).set(course, { merge: true });

      // Upload course images to Google Drive if provided
      if (courseData.coverImageFile) {
        const driveUrl = await googleDriveService.uploadCourseImage(
          courseData.coverImageFile,
          courseId,
          'cover'
        );
        course.coverImage = driveUrl.url;
      }

      if (courseData.promoVideoFile) {
        const driveUrl = await googleDriveService.uploadCourseImage(
          courseData.promoVideoFile,
          courseId,
          'video'
        );
        course.promoVideo = driveUrl.url;
      }

      return {
        success: true,
        courseId,
        message: isNew ? 'Course created successfully' : 'Course updated successfully'
      };
    } catch (error) {
      console.error('Error saving course:', error);
      throw error;
    }
  }

  // Delete course (admin function)
  async deleteCourse(courseId, userId) {
    try {
      // Check if course has enrolled students
      const enrollmentsSnapshot = await this.db.collection('enrollments')
        .where('courseId', '==', courseId)
        .get();

      if (!enrollmentsSnapshot.empty) {
        // Archive instead of delete
        await this.db.collection('courses').doc(courseId).update({
          isPublished: false,
          isArchived: true,
          archivedAt: admin.firestore.FieldValue.serverTimestamp(),
          archivedBy: userId
        });

        return {
          success: true,
          message: 'Course archived (has enrolled students)'
        };
      }

      // Delete from Google Drive
      await googleDriveService.deleteCourseFiles(courseId);

      // Delete course document
      await this.db.collection('courses').doc(courseId).delete();

      return {
        success: true,
        message: 'Course deleted successfully'
      };
    } catch (error) {
      console.error('Error deleting course:', error);
      throw error;
    }
  }

  // Email functions
  async sendEnrollmentEmail(studentEmail, courseTitle, isFree) {
    // Implementation using your email service
    console.log(`Enrollment email sent to ${studentEmail} for course ${courseTitle}`);
  }

  async sendPaymentConfirmationEmail(studentEmail, courseTitle, amount, method) {
    // Implementation using your email service
    console.log(`Payment confirmation sent to ${studentEmail} for ${courseTitle}`);
  }

  // Generate course certificate
  async generateCourseCertificate(courseId, studentId) {
    // Certificate generation logic
    // This should integrate with your certificate service
    console.log(`Generating certificate for student ${studentId} in course ${courseId}`);
  }

  // Get course recommendations
  async getCourseRecommendations(courseId, limit = 4) {
    try {
      const course = await this.getCourseById(courseId);
      
      // Get similar courses by category
      const snapshot = await this.db.collection('courses')
        .where('category', '==', course.category)
        .where('isPublished', '==', true)
        .where('id', '!=', courseId)
        .limit(limit)
        .get();

      const recommendations = [];
      
      snapshot.forEach(doc => {
        const data = doc.data();
        recommendations.push({
          id: doc.id,
          title: data.title,
          description: data.description,
          category: data.category,
          price: data.price,
          coverImage: data.coverImage,
          instructorName: data.instructorName,
          rating: data.averageRating || 0,
          students: data.totalStudents || 0
        });
      });

      return recommendations;
    } catch (error) {
      console.error('Error getting recommendations:', error);
      return [];
    }
  }

  // Update course rating after review
  async updateCourseRating(courseId, newRating) {
    try {
      const course = await this.getCourseById(courseId);
      const stats = await this.getCourseStats(courseId);

      const newAverage = (
        (course.averageRating * stats.totalReviews) + newRating
      ) / (stats.totalReviews + 1);

      await this.db.collection('courses').doc(courseId).update({
        averageRating: parseFloat(newAverage.toFixed(1)),
        totalReviews: admin.firestore.FieldValue.increment(1),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      return {
        success: true,
        newAverage,
        totalReviews: stats.totalReviews + 1
      };
    } catch (error) {
      console.error('Error updating rating:', error);
      throw error;
    }
  }
}

module.exports = new CourseService();