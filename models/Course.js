const { db } = require('../index');

class Course {
  constructor(data) {
    this.id = data.id;
    this.title = data.title;
    this.description = data.description;
    this.shortDescription = data.shortDescription || '';
    this.instructor = data.instructor || 'MRTC eCampus';
    this.category = data.category; // digital, business, agriculture, etc.
    this.subcategory = data.subcategory || '';
    this.level = data.level || 'beginner'; // beginner, intermediate, advanced
    this.duration = data.duration || 0; // in hours
    this.lessons = data.lessons || 0;
    this.price = data.price || 0; // in USD
    this.isFree = data.isFree || (data.price === 0);
    this.currency = data.currency || 'USD';
    this.mwkPrice = data.mwkPrice || (data.price ? data.price * 800 : 0);
    this.discount = data.discount || 0;
    this.rating = data.rating || 0;
    this.totalRatings = data.totalRatings || 0;
    this.studentsEnrolled = data.studentsEnrolled || 0;
    this.studentsCompleted = data.studentsCompleted || 0;
    this.thumbnail = data.thumbnail || '';
    this.promoVideo = data.promoVideo || '';
    this.prerequisites = data.prerequisites || [];
    this.learningObjectives = data.learningObjectives || [];
    this.curriculum = data.curriculum || []; // Array of lesson objects
    this.resources = data.resources || []; // PDFs, links, etc.
    this.assessmentIds = data.assessmentIds || []; // Mid and final assessments
    this.certificateTemplate = data.certificateTemplate || '';
    this.isPublished = data.isPublished || false;
    this.isFeatured = data.isFeatured || false;
    this.tags = data.tags || [];
    this.language = data.language || 'English';
    this.captions = data.captions || ['English'];
    this.createdBy = data.createdBy || 'admin';
    this.createdAt = data.createdAt || new Date().toISOString();
    this.updatedAt = data.updatedAt || new Date().toISOString();
    this.publishedAt = data.publishedAt || null;
  }

  async save() {
    const courseRef = this.id 
      ? db.collection('courses').doc(this.id)
      : db.collection('courses').doc();
    
    if (!this.id) this.id = courseRef.id;
    
    const courseData = this.toJSON();
    courseData.updatedAt = new Date().toISOString();
    
    await courseRef.set(courseData, { merge: true });
    return this;
  }

  static async findById(id) {
    const courseDoc = await db.collection('courses').doc(id).get();
    if (!courseDoc.exists) return null;
    return new Course({ id: courseDoc.id, ...courseDoc.data() });
  }

  static async findByCategory(category, limit = 20) {
    const snapshot = await db.collection('courses')
      .where('category', '==', category)
      .where('isPublished', '==', true)
      .limit(limit)
      .get();
    
    return snapshot.docs.map(doc => new Course({ id: doc.id, ...doc.data() }));
  }

  static async getFeatured(limit = 10) {
    const snapshot = await db.collection('courses')
      .where('isPublished', '==', true)
      .where('isFeatured', '==', true)
      .limit(limit)
      .get();
    
    return snapshot.docs.map(doc => new Course({ id: doc.id, ...doc.data() }));
  }

  static async getAll(limit = 50) {
    const snapshot = await db.collection('courses')
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get();
    
    return snapshot.docs.map(doc => new Course({ id: doc.id, ...doc.data() }));
  }

  async addAssessment(assessmentId, type = 'mid') {
    this.assessmentIds.push({
      id: assessmentId,
      type: type,
      addedAt: new Date().toISOString()
    });
    await this.save();
    return this;
  }

  async updateRating(newRating) {
    const totalScore = (this.rating * this.totalRatings) + newRating;
    this.totalRatings += 1;
    this.rating = totalScore / this.totalRatings;
    await this.save();
    return this;
  }

  async incrementEnrollment() {
    this.studentsEnrolled += 1;
    await this.save();
    return this;
  }

  async incrementCompletion() {
    this.studentsCompleted += 1;
    await this.save();
    return this;
  }

  toJSON() {
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
      price: this.price,
      isFree: this.isFree,
      currency: this.currency,
      mwkPrice: this.mwkPrice,
      discount: this.discount,
      rating: this.rating,
      totalRatings: this.totalRatings,
      studentsEnrolled: this.studentsEnrolled,
      studentsCompleted: this.studentsCompleted,
      thumbnail: this.thumbnail,
      promoVideo: this.promoVideo,
      prerequisites: this.prerequisites,
      learningObjectives: this.learningObjectives,
      curriculum: this.curriculum,
      resources: this.resources,
      assessmentIds: this.assessmentIds,
      certificateTemplate: this.certificateTemplate,
      isPublished: this.isPublished,
      isFeatured: this.isFeatured,
      tags: this.tags,
      language: this.language,
      captions: this.captions,
      createdBy: this.createdBy,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      publishedAt: this.publishedAt
    };
  }
}

module.exports = Course;