const admin = require('firebase-admin');

class Course {
  constructor(data = {}) {
    // 🔑 CORE FIELDS
    this.id = data.id || null;
    this.title = data.title || '';
    this.description = data.description || '';
    this.shortDescription = data.shortDescription || '';
    this.instructor = data.instructor || 'MRTC eCampus';
    this.instructorEmail = data.instructorEmail || '';

    // 📚 COURSE CATEGORIZATION
    this.category = data.category || 'general';
    this.subcategory = data.subcategory || '';
    this.level = data.level || 'beginner'; // beginner, intermediate, advanced
    this.language = data.language || 'English';
    this.tags = data.tags || [];

    // ⏱️ COURSE DURATION & STRUCTURE
    this.duration = data.duration || 0; // in hours
    this.lessons = data.lessons || 0;
    this.contentCount = data.contentCount || 0; // 🆕 Count of uploaded files

    // 💰 PRICING
    this.price = parseFloat(data.price) || 0;
    this.isFree = data.isFree || (data.price === 0 || parseFloat(data.price) === 0);
    this.currency = data.currency || 'USD';
    this.mwkPrice = data.mwkPrice || (data.price ? parseFloat(data.price) * 800 : 0);
    this.discount = parseFloat(data.discount) || 0;
    this.discountPercentage = data.discountPercentage || 0;

    // ⭐ RATINGS & REVIEWS
    this.averageRating = parseFloat(data.averageRating) || 0;
    this.reviewCount = data.reviewCount || 0;
    this.totalRatings = data.totalRatings || 0; // Legacy
    this.rating = parseFloat(data.rating) || 0; // Legacy

    // 👥 ENROLLMENT STATS
    this.enrollmentCount = data.enrollmentCount || 0; // 🆕 Real enrollment count
    this.studentsEnrolled = data.studentsEnrolled || 0; // Legacy
    this.studentsCompleted = data.studentsCompleted || 0;
    this.completionRate = data.completionRate || 0; // percentage

    // 🎥 MEDIA & RESOURCES
    this.thumbnail = data.thumbnail || '';
    this.promoVideo = data.promoVideo || '';
    this.promoVideoType = data.promoVideoType || 'youtube'; // youtube, drive, file
    this.prerequisites = data.prerequisites || [];
    this.learningObjectives = data.learningObjectives || [];
    this.curriculum = data.curriculum || [];
    this.resources = data.resources || [];
    this.captions = data.captions || ['English'];

    // 📝 ASSESSMENTS & CERTIFICATES
    this.assessmentIds = data.assessmentIds || [];
    this.certificateTemplate = data.certificateTemplate || '';
    this.requiresAssessment = data.requiresAssessment || false;
    this.minPassingScore = data.minPassingScore || 60;

    // 🔧 GOOGLE DRIVE INTEGRATION (🆕)
    this.driveFolderId = data.driveFolderId || null; // Root folder for course
    this.courseContentCount = data.courseContentCount || 0; // Count of items on Drive
    this.storageUsageGB = data.storageUsageGB || 0; // Total storage used

    // 📊 STATUS & VISIBILITY
    this.status = data.status || 'draft'; // draft, published, archived
    this.isPublished = data.isPublished || (data.status === 'published');
    this.isFeatured = data.isFeatured || false;
    this.isActive = data.isActive !== undefined ? data.isActive : true;
    this.visibility = data.visibility || 'public'; // public, private, restricted

    // 🔐 METADATA
    this.createdBy = data.createdBy || null;
    this.createdAt = data.createdAt || new Date().toISOString();
    this.updatedAt = data.updatedAt || new Date().toISOString();
    this.publishedAt = data.publishedAt || null;
    this.lastUpdated = data.lastUpdated || new Date().toISOString();

    // 📈 SEO
    this.seoTitle = data.seoTitle || '';
    this.seoDescription = data.seoDescription || '';
    this.seoKeywords = data.seoKeywords || [];

    // 🏷️ CUSTOM FIELDS
    this.customFields = data.customFields || {};
  }

  // ========================================
  // 💾 SAVE & PERSIST OPERATIONS
  // ========================================

  /**
   * Save course to Firestore
   * Creates new or updates existing document
   */
  async save() {
    try {
      const db = admin.firestore();
      
      // Generate ID if new
      const courseRef = this.id 
        ? db.collection('courses').doc(this.id)
        : db.collection('courses').doc();

      if (!this.id) {
        this.id = courseRef.id;
      }

      // Prepare data
      const courseData = this.toJSON();
      courseData.updatedAt = admin.firestore.FieldValue.serverTimestamp();
      courseData.lastUpdated = admin.firestore.FieldValue.serverTimestamp();

      // Save to Firestore
      await courseRef.set(courseData, { merge: true });

      console.log(`✅ Course saved: ${this.id}`);
      return this;

    } catch (error) {
      console.error('❌ Error saving course:', error.message);
      throw error;
    }
  }

  /**
   * Publish course (change status to published)
   */
  async publish() {
    try {
      this.status = 'published';
      this.isPublished = true;
      this.publishedAt = new Date().toISOString();
      
      await this.save();
      
      console.log(`✅ Course published: ${this.id}`);
      return this;

    } catch (error) {
      console.error('❌ Error publishing course:', error.message);
      throw error;
    }
  }

  /**
   * Unpublish course
   */
  async unpublish() {
    try {
      this.status = 'draft';
      this.isPublished = false;
      
      await this.save();
      
      console.log(`✅ Course unpublished: ${this.id}`);
      return this;

    } catch (error) {
      console.error('❌ Error unpublishing course:', error.message);
      throw error;
    }
  }

  /**
   * Archive course
   */
  async archive() {
    try {
      this.status = 'archived';
      this.isActive = false;
      
      await this.save();
      
      console.log(`✅ Course archived: ${this.id}`);
      return this;

    } catch (error) {
      console.error('❌ Error archiving course:', error.message);
      throw error;
    }
  }

  /**
   * Delete course and all associated content
   */
  async delete() {
    try {
      const db = admin.firestore();

      // Delete all course contents
      const contentsSnap = await db.collection('course_contents')
        .where('courseId', '==', this.id)
        .get();

      const batch = db.batch();

      contentsSnap.docs.forEach(doc => {
        batch.delete(doc.ref);
      });

      await batch.commit();

      // Delete course document
      await db.collection('courses').doc(this.id).delete();

      console.log(`✅ Course deleted: ${this.id}`);
      return true;

    } catch (error) {
      console.error('❌ Error deleting course:', error.message);
      throw error;
    }
  }

  // ========================================
  // 📖 QUERY OPERATIONS (Static Methods)
  // ========================================

  /**
   * Find course by ID
   */
  static async findById(id) {
    try {
      const db = admin.firestore();
      const courseDoc = await db.collection('courses').doc(id).get();

      if (!courseDoc.exists) {
        return null;
      }

      return new Course({
        id: courseDoc.id,
        ...courseDoc.data()
      });

    } catch (error) {
      console.error('❌ Error finding course:', error.message);
      throw error;
    }
  }

  /**
   * Find courses by category
   */
  static async findByCategory(category, limit = 20) {
    try {
      const db = admin.firestore();
      const snapshot = await db.collection('courses')
        .where('category', '==', category)
        .where('isPublished', '==', true)
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .get();

      return snapshot.docs.map(doc => new Course({
        id: doc.id,
        ...doc.data()
      }));

    } catch (error) {
      console.error('❌ Error finding courses by category:', error.message);
      throw error;
    }
  }

  /**
   * Get featured courses
   */
  static async getFeatured(limit = 10) {
    try {
      const db = admin.firestore();
      const snapshot = await db.collection('courses')
        .where('isPublished', '==', true)
        .where('isFeatured', '==', true)
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .get();

      return snapshot.docs.map(doc => new Course({
        id: doc.id,
        ...doc.data()
      }));

    } catch (error) {
      console.error('❌ Error getting featured courses:', error.message);
      throw error;
    }
  }

  /**
   * Get all published courses
   */
  static async getPublished(limit = 50, startAt = null) {
    try {
      const db = admin.firestore();
      let query = db.collection('courses')
        .where('isPublished', '==', true)
        .orderBy('createdAt', 'desc');

      if (startAt) {
        query = query.startAt(startAt);
      }

      const snapshot = await query.limit(limit).get();

      return snapshot.docs.map(doc => new Course({
        id: doc.id,
        ...doc.data()
      }));

    } catch (error) {
      console.error('❌ Error getting published courses:', error.message);
      throw error;
    }
  }

  /**
   * Get all courses (including drafts)
   */
  static async getAll(limit = 50) {
    try {
      const db = admin.firestore();
      const snapshot = await db.collection('courses')
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .get();

      return snapshot.docs.map(doc => new Course({
        id: doc.id,
        ...doc.data()
      }));

    } catch (error) {
      console.error('❌ Error getting all courses:', error.message);
      throw error;
    }
  }

  /**
   * Get courses by status
   */
  static async getByStatus(status, limit = 50) {
    try {
      const db = admin.firestore();
      const snapshot = await db.collection('courses')
        .where('status', '==', status)
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .get();

      return snapshot.docs.map(doc => new Course({
        id: doc.id,
        ...doc.data()
      }));

    } catch (error) {
      console.error('❌ Error getting courses by status:', error.message);
      throw error;
    }
  }

  /**
   * Search courses by title or description
   */
  static async search(searchTerm, limit = 20) {
    try {
      const db = admin.firestore();
      const lowerSearchTerm = searchTerm.toLowerCase();

      const snapshot = await db.collection('courses')
        .where('isPublished', '==', true)
        .get();

      const results = snapshot.docs
        .filter(doc => {
          const data = doc.data();
          return (
            data.title.toLowerCase().includes(lowerSearchTerm) ||
            data.description.toLowerCase().includes(lowerSearchTerm) ||
            (data.tags && data.tags.some(tag => tag.toLowerCase().includes(lowerSearchTerm)))
          );
        })
        .slice(0, limit)
        .map(doc => new Course({
          id: doc.id,
          ...doc.data()
        }));

      return results;

    } catch (error) {
      console.error('❌ Error searching courses:', error.message);
      throw error;
    }
  }

  /**
   * Get courses by level
   */
  static async getByLevel(level, limit = 20) {
    try {
      const db = admin.firestore();
      const snapshot = await db.collection('courses')
        .where('level', '==', level)
        .where('isPublished', '==', true)
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .get();

      return snapshot.docs.map(doc => new Course({
        id: doc.id,
        ...doc.data()
      }));

    } catch (error) {
      console.error('❌ Error getting courses by level:', error.message);
      throw error;
    }
  }

  /**
   * Get top-rated courses
   */
  static async getTopRated(limit = 10) {
    try {
      const db = admin.firestore();
      const snapshot = await db.collection('courses')
        .where('isPublished', '==', true)
        .orderBy('averageRating', 'desc')
        .limit(limit)
        .get();

      return snapshot.docs.map(doc => new Course({
        id: doc.id,
        ...doc.data()
      }));

    } catch (error) {
      console.error('❌ Error getting top-rated courses:', error.message);
      throw error;
    }
  }

  /**
   * Get most popular courses (by enrollment)
   */
  static async getMostPopular(limit = 10) {
    try {
      const db = admin.firestore();
      const snapshot = await db.collection('courses')
        .where('isPublished', '==', true)
        .orderBy('enrollmentCount', 'desc')
        .limit(limit)
        .get();

      return snapshot.docs.map(doc => new Course({
        id: doc.id,
        ...doc.data()
      }));

    } catch (error) {
      console.error('❌ Error getting popular courses:', error.message);
      throw error;
    }
  }

  /**
   * Get courses by creator
   */
  static async getByCreator(creatorId, limit = 50) {
    try {
      const db = admin.firestore();
      const snapshot = await db.collection('courses')
        .where('createdBy', '==', creatorId)
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .get();

      return snapshot.docs.map(doc => new Course({
        id: doc.id,
        ...doc.data()
      }));

    } catch (error) {
      console.error('❌ Error getting creator courses:', error.message);
      throw error;
    }
  }

  // ========================================
  // 🆕 GOOGLE DRIVE INTEGRATION METHODS
  // ========================================

  /**
   * Set Google Drive folder ID for course
   */
  setDriveFolderId(folderId) {
    this.driveFolderId = folderId;
    return this;
  }

  /**
   * Update storage usage
   */
  async updateStorageUsage(sizeGB) {
    this.storageUsageGB = parseFloat(sizeGB);
    await this.save();
    return this;
  }

  /**
   * Update content count
   */
  async updateContentCount(count) {
    this.contentCount = parseInt(count);
    await this.save();
    return this;
  }

  /**
   * Increment content count
   */
  async incrementContentCount() {
    this.contentCount = (this.contentCount || 0) + 1;
    await this.save();
    return this;
  }

  /**
   * Decrement content count
   */
  async decrementContentCount() {
    this.contentCount = Math.max(0, (this.contentCount || 1) - 1);
    await this.save();
    return this;
  }

  // ========================================
  // 👥 ENROLLMENT & STATISTICS
  // ========================================

  /**
   * Add assessment
   */
  async addAssessment(assessmentId, type = 'mid') {
    this.assessmentIds.push({
      id: assessmentId,
      type: type,
      addedAt: new Date().toISOString()
    });
    await this.save();
    return this;
  }

  /**
   * Update rating (when new review is added)
   */
  async updateRating(newRating) {
    const totalScore = (this.averageRating * this.reviewCount) + newRating;
    this.reviewCount += 1;
    this.averageRating = totalScore / this.reviewCount;
    await this.save();
    return this;
  }

  /**
   * Increment enrollment count
   */
  async incrementEnrollment() {
    this.enrollmentCount = (this.enrollmentCount || 0) + 1;
    this.studentsEnrolled = this.enrollmentCount; // Keep legacy field in sync
    await this.save();
    return this;
  }

  /**
   * Decrement enrollment count
   */
  async decrementEnrollment() {
    this.enrollmentCount = Math.max(0, (this.enrollmentCount || 1) - 1);
    this.studentsEnrolled = this.enrollmentCount;
    await this.save();
    return this;
  }

  /**
   * Increment completion count
   */
  async incrementCompletion() {
    this.studentsCompleted = (this.studentsCompleted || 0) + 1;
    
    // Calculate completion rate
    if (this.enrollmentCount > 0) {
      this.completionRate = (this.studentsCompleted / this.enrollmentCount) * 100;
    }
    
    await this.save();
    return this;
  }

  /**
   * Update course statistics
   */
  async updateStatistics(stats) {
    if (stats.enrollmentCount !== undefined) {
      this.enrollmentCount = stats.enrollmentCount;
      this.studentsEnrolled = stats.enrollmentCount;
    }
    if (stats.completedCount !== undefined) {
      this.studentsCompleted = stats.completedCount;
    }
    if (stats.averageRating !== undefined) {
      this.averageRating = stats.averageRating;
    }
    if (stats.reviewCount !== undefined) {
      this.reviewCount = stats.reviewCount;
    }

    // Recalculate completion rate
    if (this.enrollmentCount > 0) {
      this.completionRate = (this.studentsCompleted / this.enrollmentCount) * 100;
    }

    await this.save();
    return this;
  }

  /**
   * Get course statistics
   */
  getStatistics() {
    return {
      enrollmentCount: this.enrollmentCount,
      completedCount: this.studentsCompleted,
      completionRate: this.completionRate,
      averageRating: this.averageRating,
      reviewCount: this.reviewCount,
      contentCount: this.contentCount,
      storageUsageGB: this.storageUsageGB
    };
  }

  // ========================================
  // 🔄 CONVERSION & SERIALIZATION
  // ========================================

  /**
   * Convert course to JSON
   */
  toJSON() {
    return {
      id: this.id,
      title: this.title,
      description: this.description,
      shortDescription: this.shortDescription,
      instructor: this.instructor,
      instructorEmail: this.instructorEmail,
      category: this.category,
      subcategory: this.subcategory,
      level: this.level,
      language: this.language,
      tags: this.tags,
      duration: this.duration,
      lessons: this.lessons,
      contentCount: this.contentCount,
      price: this.price,
      isFree: this.isFree,
      currency: this.currency,
      mwkPrice: this.mwkPrice,
      discount: this.discount,
      discountPercentage: this.discountPercentage,
      averageRating: this.averageRating,
      reviewCount: this.reviewCount,
      enrollmentCount: this.enrollmentCount,
      studentsCompleted: this.studentsCompleted,
      completionRate: this.completionRate,
      thumbnail: this.thumbnail,
      promoVideo: this.promoVideo,
      promoVideoType: this.promoVideoType,
      prerequisites: this.prerequisites,
      learningObjectives: this.learningObjectives,
      curriculum: this.curriculum,
      resources: this.resources,
      captions: this.captions,
      assessmentIds: this.assessmentIds,
      certificateTemplate: this.certificateTemplate,
      requiresAssessment: this.requiresAssessment,
      minPassingScore: this.minPassingScore,
      driveFolderId: this.driveFolderId,
      contentCount: this.contentCount,
      storageUsageGB: this.storageUsageGB,
      status: this.status,
      isPublished: this.isPublished,
      isFeatured: this.isFeatured,
      isActive: this.isActive,
      visibility: this.visibility,
      createdBy: this.createdBy,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      publishedAt: this.publishedAt,
      lastUpdated: this.lastUpdated,
      seoTitle: this.seoTitle,
      seoDescription: this.seoDescription,
      seoKeywords: this.seoKeywords,
      customFields: this.customFields
    };
  }

  /**
   * Convert to public JSON (for frontend display)
   */
  toPublicJSON() {
    return {
      id: this.id,
      title: this.title,
      description: this.description,
      shortDescription: this.shortDescription,
      instructor: this.instructor,
      category: this.category,
      subcategory: this.subcategory,
      level: this.level,
      duration: this.duration,
      lessons: this.lessons,
      contentCount: this.contentCount,
      price: this.price,
      isFree: this.isFree,
      currency: this.currency,
      mwkPrice: this.mwkPrice,
      discount: this.discount,
      averageRating: this.averageRating,
      reviewCount: this.reviewCount,
      enrollmentCount: this.enrollmentCount,
      completionRate: this.completionRate,
      thumbnail: this.thumbnail,
      promoVideo: this.promoVideo,
      learningObjectives: this.learningObjectives,
      language: this.language,
      tags: this.tags,
      isFeatured: this.isFeatured,
      certificateTemplate: this.certificateTemplate,
      requiresAssessment: this.requiresAssessment,
      minPassingScore: this.minPassingScore
    };
  }

  /**
   * Create from Firestore document
   */
  static fromFirestore(doc) {
    return new Course({
      id: doc.id,
      ...doc.data()
    });
  }
}

module.exports = Course;