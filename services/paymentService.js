// =============================================
// PAYMENT SERVICE
// =============================================
const admin = require('firebase-admin');

class PaymentService {
  constructor() {
    this.db = admin.firestore();
  }

  // Validate payment amount
  async validatePaymentAmount(requiredAmount, paidAmount) {
    const tolerance = parseFloat(process.env.MIN_AMOUNT_TOLERANCE) || 0.01;
    
    // Check for valid number
    if (isNaN(paidAmount) || paidAmount <= 0) {
      return {
        valid: false,
        message: '❌ Invalid payment amount. Please enter a valid amount.',
        type: 'invalid_amount'
      };
    }
    
    // Check underpayment (strict)
    const shortfall = requiredAmount - paidAmount;
    if (shortfall > tolerance) {
      return {
        valid: false,
        message: `❌ PAYMENT REJECTED!\n\nRequired: $${requiredAmount.toFixed(2)}\nYou entered: $${paidAmount.toFixed(2)}\nShortfall: $${shortfall.toFixed(2)}\n\nPlease enter the exact amount or more.`,
        type: 'underpayment'
      };
    }
    
    // Check for suspicious overpayment
    const overpayment = paidAmount - requiredAmount;
    if (overpayment > 100) {
      return {
        valid: false,
        message: `⚠️ Overpayment detected: $${overpayment.toFixed(2)}\n\nDid you mean to pay $${requiredAmount.toFixed(2)}?\n\nProceed with caution - extra amount cannot be refunded.`,
        type: 'overpayment_warning',
        requiresConfirmation: true
      };
    }
    
    return {
      valid: true,
      message: 'Payment amount is valid',
      type: 'valid',
      overpayment: overpayment > 0 ? overpayment : 0
    };
  }

  // Create payment order
  async createPaymentOrder(userId, courseId, method, amount, metadata = {}) {
    try {
      // Get course details
      const courseDoc = await this.db.collection('courses').doc(courseId).get();
      if (!courseDoc.exists) {
        throw new Error('Course not found');
      }
      
      const courseData = courseDoc.data();
      
      // Generate order ID
      const orderId = this.generateOrderId();
      const paymentId = this.generatePaymentId();
      
      // Calculate fees
      const fees = this.calculateFees(amount, method, courseData.priceUSD);
      
      // Create payment document
      const paymentRef = this.db.collection('payments').doc(paymentId);
      const paymentData = {
        id: paymentId,
        orderId,
        userId,
        courseId,
        courseTitle: courseData.title,
        coursePrice: courseData.priceUSD,
        method,
        status: 'pending',
        amount: {
          requested: amount,
          net: amount - fees.total,
          currency: 'USD'
        },
        fees: {
          platform: fees.platform,
          processing: fees.processing,
          total: fees.total
        },
        metadata,
        history: [{
          status: 'created',
          timestamp: new Date().toISOString(),
          message: 'Payment order created'
        }],
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      };
      
      await paymentRef.set(paymentData);
      
      return {
        success: true,
        paymentId,
        orderId,
        data: paymentData
      };
      
    } catch (error) {
      console.error('Create payment order error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Verify payment
  async verifyPayment(paymentId) {
    try {
      const paymentRef = this.db.collection('payments').doc(paymentId);
      const paymentDoc = await paymentRef.get();
      
      if (!paymentDoc.exists) {
        throw new Error('Payment not found');
      }
      
      const paymentData = paymentDoc.data();
      
      // Update payment status
      await paymentRef.update({
        status: 'completed',
        'history': admin.firestore.FieldValue.arrayUnion({
          status: 'completed',
          timestamp: new Date().toISOString(),
          message: 'Payment verified and completed'
        }),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      
      return {
        success: true,
        paymentId,
        status: 'completed'
      };
      
    } catch (error) {
      console.error('Verify payment error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Calculate fees
  calculateFees(amount, method, coursePrice) {
    const platformFeeRate = parseFloat(process.env.PLATFORM_FEE_RATE) || 0.10;
    
    // Platform fee (10% of course price)
    const platformFee = coursePrice * platformFeeRate;
    
    // Processing fee based on method
    let processingFee = 0;
    switch (method) {
      case 'paychangu':
        processingFee = amount * 0.03; // 3%
        break;
      case 'paypal':
        processingFee = (amount * 0.029) + 0.30; // 2.9% + $0.30
        break;
      case 'bank_transfer':
        processingFee = 0;
        break;
      default:
        processingFee = 0;
    }
    
    return {
      platform: platformFee,
      processing: processingFee,
      total: platformFee + processingFee
    };
  }

  // Generate order ID
  generateOrderId() {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substr(2, 6).toUpperCase();
    return `MRTC-${timestamp}-${random}`;
  }

  // Generate payment ID
  generatePaymentId() {
    return admin.firestore().collection('payments').doc().id;
  }

  // Get payment details
  async getPaymentDetails(paymentId) {
    try {
      const paymentDoc = await this.db.collection('payments').doc(paymentId).get();
      
      if (!paymentDoc.exists) {
        throw new Error('Payment not found');
      }
      
      return {
        success: true,
        data: paymentDoc.data()
      };
      
    } catch (error) {
      console.error('Get payment details error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Update payment status
  async updatePaymentStatus(paymentId, status, message = '') {
    try {
      const paymentRef = this.db.collection('payments').doc(paymentId);
      
      await paymentRef.update({
        status,
        'history': admin.firestore.FieldValue.arrayUnion({
          status,
          timestamp: new Date().toISOString(),
          message
        }),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      
      return { success: true };
      
    } catch (error) {
      console.error('Update payment status error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Check for duplicate payments
  async checkDuplicatePayment(userId, courseId, timeWindowHours = 24) {
    try {
      const cutoffTime = new Date();
      cutoffTime.setHours(cutoffTime.getHours() - timeWindowHours);
      
      const snapshot = await this.db.collection('payments')
        .where('userId', '==', userId)
        .where('courseId', '==', courseId)
        .where('createdAt', '>=', cutoffTime.toISOString())
        .where('status', 'in', ['pending', 'processing', 'completed'])
        .get();
      
      const duplicates = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      
      return {
        success: true,
        hasDuplicates: duplicates.length > 0,
        count: duplicates.length,
        payments: duplicates
      };
      
    } catch (error) {
      console.error('Check duplicate payment error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Get user payments
  async getUserPayments(userId, limit = 50) {
    try {
      const snapshot = await this.db.collection('payments')
        .where('userId', '==', userId)
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .get();
      
      const payments = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      
      return {
        success: true,
        payments,
        count: payments.length
      };
      
    } catch (error) {
      console.error('Get user payments error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Refund payment
  async refundPayment(paymentId, reason = '') {
    try {
      const paymentRef = this.db.collection('payments').doc(paymentId);
      
      await paymentRef.update({
        status: 'refunded',
        refund: {
          reason,
          processedAt: new Date().toISOString()
        },
        'history': admin.firestore.FieldValue.arrayUnion({
          status: 'refunded',
          timestamp: new Date().toISOString(),
          message: `Payment refunded: ${reason}`
        }),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      
      return { success: true };
      
    } catch (error) {
      console.error('Refund payment error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Get payment statistics
  async getPaymentStats(timePeriod = 'month') {
    try {
      const now = new Date();
      let startDate;
      
      switch (timePeriod) {
        case 'day':
          startDate = new Date(now.setDate(now.getDate() - 1));
          break;
        case 'week':
          startDate = new Date(now.setDate(now.getDate() - 7));
          break;
        case 'month':
          startDate = new Date(now.setMonth(now.getMonth() - 1));
          break;
        case 'year':
          startDate = new Date(now.setFullYear(now.getFullYear() - 1));
          break;
        default:
          startDate = new Date(now.setDate(now.getDate() - 30));
      }
      
      const snapshot = await this.db.collection('payments')
        .where('createdAt', '>=', startDate.toISOString())
        .get();
      
      const payments = snapshot.docs.map(doc => doc.data());
      
      const stats = {
        total: payments.length,
        completed: payments.filter(p => p.status === 'completed').length,
        pending: payments.filter(p => p.status === 'pending').length,
        failed: payments.filter(p => p.status === 'failed').length,
        refunded: payments.filter(p => p.status === 'refunded').length,
        totalAmount: payments.reduce((sum, p) => sum + p.amount.requested, 0),
        netAmount: payments.reduce((sum, p) => sum + p.amount.net, 0),
        byMethod: {},
        byDay: {}
      };
      
      // Group by method
      payments.forEach(payment => {
        const method = payment.method;
        stats.byMethod[method] = (stats.byMethod[method] || 0) + 1;
      });
      
      // Group by day
      payments.forEach(payment => {
        const date = new Date(payment.createdAt).toISOString().split('T')[0];
        stats.byDay[date] = (stats.byDay[date] || 0) + 1;
      });
      
      return {
        success: true,
        stats,
        timePeriod,
        startDate: startDate.toISOString(),
        endDate: new Date().toISOString()
      };
      
    } catch (error) {
      console.error('Get payment stats error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = new PaymentService();
module.exports.validatePaymentAmount = PaymentService.prototype.validatePaymentAmount;
module.exports.createPaymentOrder = PaymentService.prototype.createPaymentOrder;
module.exports.verifyPayment = PaymentService.prototype.verifyPayment;