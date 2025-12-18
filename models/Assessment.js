const { db } = require('../index');

class Assessment {
  constructor(data) {
    this.id = data.id;
    this.courseId = data.courseId;
    this.type = data.type; // 'mid' or 'final'
    this.title = data.title;
    this.description = data.description || '';
    this.passingScore = data.passingScore || 80; // percentage
    this.timeLimit = data.timeLimit || 60; // minutes
    this.totalQuestions = data.totalQuestions || 0;
    this.questions = data.questions || []; // Array of question objects
    this.isActive = data.isActive || true;
    this.shuffleQuestions = data.shuffleQuestions || true;
    this.shuffleOptions = data.shuffleOptions || true;
    this.preventCheating = data.preventCheating || true;
    this.allowRetake = data.allowRetake || true;
    this.maxAttempts = data.maxAttempts || 3;
    this.showResults = data.showResults || true;
    this.requireWebcam = data.requireWebcam || false;
    this.createdBy = data.createdBy || 'admin';
    this.createdAt = data.createdAt || new Date().toISOString();
    this.updatedAt = data.updatedAt || new Date().toISOString();
  }

  async save() {
    const assessmentRef = this.id 
      ? db.collection('assessments').doc(this.id)
      : db.collection('assessments').doc();
    
    if (!this.id) this.id = assessmentRef.id;
    
    await assessmentRef.set({
      ...this.toJSON(),
      updatedAt: new Date().toISOString(),
      totalQuestions: this.questions.length
    }, { merge: true });
    return this;
  }

  static async findById(id) {
    const assessmentDoc = await db.collection('assessments').doc(id).get();
    if (!assessmentDoc.exists) return null;
    return new Assessment({ id: assessmentDoc.id, ...assessmentDoc.data() });
  }

  static async findByCourse(courseId, type = null) {
    let query = db.collection('assessments').where('courseId', '==', courseId);
    
    if (type) {
      query = query.where('type', '==', type);
    }
    
    const snapshot = await query.get();
    return snapshot.docs.map(doc => new Assessment({ id: doc.id, ...doc.data() }));
  }

  static async getRandomQuestions(assessmentId, count = 40) {
    const assessment = await Assessment.findById(assessmentId);
    if (!assessment) return null;

    const questions = [...assessment.questions];
    
    if (assessment.shuffleQuestions) {
      // Fisher-Yates shuffle
      for (let i = questions.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [questions[i], questions[j]] = [questions[j], questions[i]];
      }
    }

    // Take only the requested number of questions
    const selectedQuestions = questions.slice(0, Math.min(count, questions.length));

    // Shuffle options if needed
    if (assessment.shuffleOptions) {
      selectedQuestions.forEach(question => {
        if (question.type === 'multiple_choice' && question.options) {
          const options = [...question.options];
          for (let i = options.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [options[i], options[j]] = [options[j], options[i]];
          }
          question.options = options;
        }
      });
    }

    return {
      assessmentId: assessment.id,
      courseId: assessment.courseId,
      title: assessment.title,
      type: assessment.type,
      passingScore: assessment.passingScore,
      timeLimit: assessment.timeLimit,
      totalQuestions: selectedQuestions.length,
      questions: selectedQuestions,
      preventCheating: assessment.preventCheating,
      maxAttempts: assessment.maxAttempts
    };
  }

  async addQuestion(question) {
    question.id = `q${this.questions.length + 1}`;
    question.createdAt = new Date().toISOString();
    this.questions.push(question);
    await this.save();
    return question;
  }

  async submitAttempt(userId, answers) {
    // Calculate score
    let correct = 0;
    const results = [];

    this.questions.forEach(question => {
      const userAnswer = answers[question.id];
      const isCorrect = userAnswer === question.correctAnswer;
      
      if (isCorrect) correct++;
      
      results.push({
        questionId: question.id,
        question: question.text,
        userAnswer,
        correctAnswer: question.correctAnswer,
        isCorrect,
        explanation: question.explanation || ''
      });
    });

    const score = Math.round((correct / this.questions.length) * 100);
    const passed = score >= this.passingScore;

    // Save attempt
    const attemptRef = db.collection('assessment_attempts').doc();
    const attemptData = {
      id: attemptRef.id,
      assessmentId: this.id,
      courseId: this.courseId,
      userId,
      score,
      passed,
      totalQuestions: this.questions.length,
      correctAnswers: correct,
      wrongAnswers: this.questions.length - correct,
      answers: answers,
      results: results,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      ipAddress: '', // Would be set from request
      userAgent: '', // Would be set from request
      cheatingDetected: false // Would be set by security checks
    };

    await attemptRef.set(attemptData);

    return {
      score,
      passed,
      correctAnswers: correct,
      totalQuestions: this.questions.length,
      results,
      attemptId: attemptRef.id
    };
  }

  toJSON() {
    return {
      id: this.id,
      courseId: this.courseId,
      type: this.type,
      title: this.title,
      description: this.description,
      passingScore: this.passingScore,
      timeLimit: this.timeLimit,
      totalQuestions: this.totalQuestions,
      questions: this.questions,
      isActive: this.isActive,
      shuffleQuestions: this.shuffleQuestions,
      shuffleOptions: this.shuffleOptions,
      preventCheating: this.preventCheating,
      allowRetake: this.allowRetake,
      maxAttempts: this.maxAttempts,
      showResults: this.showResults,
      requireWebcam: this.requireWebcam,
      createdBy: this.createdBy,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };
  }
}

module.exports = Assessment;