const { db } = require('../index');

class User {
  constructor(data) {
    this.uid = data.uid;
    this.email = data.email;
    this.displayName = data.displayName || '';
    this.photoURL = data.photoURL || '';
    this.phoneNumber = data.phoneNumber || '';
    this.role = data.role || 'student'; // student, admin
    this.country = data.country || 'Malawi';
    this.city = data.city || '';
    this.bio = data.bio || '';
    this.skills = data.skills || [];
    this.enrolledCourses = data.enrolledCourses || [];
    this.completedCourses = data.completedCourses || [];
    this.certificates = data.certificates || [];
    this.paymentHistory = data.paymentHistory || [];
    this.isActive = data.isActive !== undefined ? data.isActive : true;
    this.tourCompleted = data.tourCompleted || false;
    this.skipTutorial = data.skipTutorial || false;
    this.lastLogin = data.lastLogin || new Date().toISOString();
    this.createdAt = data.createdAt || new Date().toISOString();
    this.updatedAt = new Date().toISOString();
  }

  async save() {
    const userRef = db.collection('users').doc(this.uid);
    await userRef.set({
      ...this.toJSON(),
      updatedAt: new Date().toISOString()
    }, { merge: true });
    return this;
  }

  static async findById(uid) {
    const userDoc = await db.collection('users').doc(uid).get();
    if (!userDoc.exists) return null;
    return new User(userDoc.data());
  }

  static async findByEmail(email) {
    const snapshot = await db.collection('users')
      .where('email', '==', email)
      .limit(1)
      .get();
    
    if (snapshot.empty) return null;
    const doc = snapshot.docs[0];
    return new User({ uid: doc.id, ...doc.data() });
  }

  static async update(uid, updates) {
    const userRef = db.collection('users').doc(uid);
    await userRef.update({
      ...updates,
      updatedAt: new Date().toISOString()
    });
    
    const updatedDoc = await userRef.get();
    return new User(updatedDoc.data());
  }

  static async getAll(limit = 50) {
    const snapshot = await db.collection('users')
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get();
    
    return snapshot.docs.map(doc => new User({ uid: doc.id, ...doc.data() }));
  }

  async enrollCourse(courseId) {
    if (!this.enrolledCourses.includes(courseId)) {
      this.enrolledCourses.push(courseId);
      await this.save();
    }
    return this;
  }

  async completeCourse(courseId, certificateId) {
    if (!this.completedCourses.includes(courseId)) {
      this.completedCourses.push(courseId);
    }
    if (certificateId && !this.certificates.includes(certificateId)) {
      this.certificates.push(certificateId);
    }
    await this.save();
    return this;
  }

  toJSON() {
    return {
      uid: this.uid,
      email: this.email,
      displayName: this.displayName,
      photoURL: this.photoURL,
      phoneNumber: this.phoneNumber,
      role: this.role,
      country: this.country,
      city: this.city,
      bio: this.bio,
      skills: this.skills,
      enrolledCourses: this.enrolledCourses,
      completedCourses: this.completedCourses,
      certificates: this.certificates,
      paymentHistory: this.paymentHistory,
      isActive: this.isActive,
      tourCompleted: this.tourCompleted,
      skipTutorial: this.skipTutorial,
      lastLogin: this.lastLogin,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };
  }
}

module.exports = User;