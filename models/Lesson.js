const { db } = require('../index');

class Lesson {
  constructor(data) {
    this.id = data.id;
    this.courseId = data.courseId;
    this.moduleId = data.moduleId || '';
    this.title = data.title;
    this.description = data.description || '';
    this.contentType = data.contentType; // video, html, pdf, text, link
    this.content = data.content || ''; // HTML content, video URL, or text
    this.videoUrl = data.videoUrl || '';
    this.videoDuration = data.videoDuration || 0; // in minutes
    this.pdfUrl = data.pdfUrl || '';
    this.externalLink = data.externalLink || '';
    this.attachments = data.attachments || []; // Additional files
    this.order = data.order || 0;
    this.isFreePreview = data.isFreePreview || false;
    this.requiresCompletion = data.requiresCompletion || true;
    this.completionCriteria = data.completionCriteria || 'watch'; // watch, quiz, both
    this.quizId = data.quizId || null;
    this.createdAt = data.createdAt || new Date().toISOString();
    this.updatedAt = data.updatedAt || new Date().toISOString();
  }

  async save() {
    const lessonRef = this.id 
      ? db.collection('lessons').doc(this.id)
      : db.collection('lessons').doc();
    
    if (!this.id) this.id = lessonRef.id;
    
    await lessonRef.set({
      ...this.toJSON(),
      updatedAt: new Date().toISOString()
    }, { merge: true });
    return this;
  }

  static async findById(id) {
    const lessonDoc = await db.collection('lessons').doc(id).get();
    if (!lessonDoc.exists) return null;
    return new Lesson({ id: lessonDoc.id, ...lessonDoc.data() });
  }

  static async findByCourse(courseId) {
    const snapshot = await db.collection('lessons')
      .where('courseId', '==', courseId)
      .orderBy('order', 'asc')
      .get();
    
    return snapshot.docs.map(doc => new Lesson({ id: doc.id, ...doc.data() }));
  }

  async updateProgress(userId, progress) {
    const progressRef = db.collection('progress').doc(`${userId}_${this.id}`);
    await progressRef.set({
      userId,
      lessonId: this.id,
      courseId: this.courseId,
      progress: progress, // percentage 0-100
      completed: progress === 100,
      lastAccessed: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }, { merge: true });
    
    return { userId, lessonId: this.id, progress };
  }

  toJSON() {
    return {
      id: this.id,
      courseId: this.courseId,
      moduleId: this.moduleId,
      title: this.title,
      description: this.description,
      contentType: this.contentType,
      content: this.content,
      videoUrl: this.videoUrl,
      videoDuration: this.videoDuration,
      pdfUrl: this.pdfUrl,
      externalLink: this.externalLink,
      attachments: this.attachments,
      order: this.order,
      isFreePreview: this.isFreePreview,
      requiresCompletion: this.requiresCompletion,
      completionCriteria: this.completionCriteria,
      quizId: this.quizId,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };
  }
}

module.exports = Lesson;