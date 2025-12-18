// Payment Model
class Payment {
  constructor(data = {}) {
    this.id = data.id || null;
    this.orderId = data.orderId || null;
    this.userId = data.userId || null;
    this.courseId = data.courseId || null;
    this.amount = parseFloat(data.amount) || 0;
    this.currency = data.currency || 'USD';
    this.method = data.method || null; // paychangu, paypal, bank_transfer
    this.network = data.network || null; // airtel, mpamba
    this.phoneNumber = data.phoneNumber || null;
    this.status = data.status || 'pending'; // pending, processing, completed, failed, refunded, expired
    this.transactionId = data.transactionId || null;
    this.paymentProvider = data.paymentProvider || null;
    this.fileUrl = data.fileUrl || null;
    this.fileId = data.fileId || null;
    this.enrolled = data.enrolled || false;
    this.enrolledAt = data.enrolledAt || null;
    this.completedAt = data.completedAt || null;
    this.createdAt = data.createdAt || new Date().toISOString();
    this.updatedAt = data.updatedAt || new Date().toISOString();
    this.expiresAt = data.expiresAt || new Date(Date.now() + 15 * 60 * 1000).toISOString();
    this.adminNotes = data.adminNotes || null;
  }

  validate() {
    const errors = [];

    if (!this.orderId) errors.push('Order ID is required');
    if (!this.userId) errors.push('User ID is required');
    if (!this.courseId) errors.push('Course ID is required');
    if (!this.amount || this.amount <= 0) errors.push('Valid amount is required');
    if (!this.method) errors.push('Payment method is required');

    if (this.method === 'paychangu') {
      if (!this.phoneNumber) errors.push('Phone number is required for PayChangu');
      if (!this.network) errors.push('Network is required for PayChangu');
    }

    if (this.method === 'bank_transfer') {
      if (!this.fileUrl) errors.push('Transfer proof is required for bank transfer');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  toJSON() {
    return {
      id: this.id,
      orderId: this.orderId,
      userId: this.userId,
      courseId: this.courseId,
      amount: this.amount,
      currency: this.currency,
      method: this.method,
      network: this.network,
      phoneNumber: this.phoneNumber,
      status: this.status,
      transactionId: this.transactionId,
      paymentProvider: this.paymentProvider,
      fileUrl: this.fileUrl,
      fileId: this.fileId,
      enrolled: this.enrolled,
      enrolledAt: this.enrolledAt,
      completedAt: this.completedAt,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      expiresAt: this.expiresAt,
      adminNotes: this.adminNotes
    };
  }

  toPublicJSON() {
    const data = this.toJSON();
    // Remove sensitive information
    delete data.phoneNumber;
    delete data.paymentProvider;
    delete data.fileUrl;
    delete data.adminNotes;
    delete data.transactionId;
    return data;
  }
}

module.exports = Payment;