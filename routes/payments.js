// =============================================
// PAYMENT ROUTES - MRTC eCampus
// =============================================
const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const { validatePaymentAmount, createPaymentOrder, verifyPayment } = require('../services/paymentService');
const { uploadToGoogleDrive } = require('../services/googleDriveService');

// ===== MIDDLEWARE =====
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const token = authHeader.split('Bearer ')[1];
    const decodedToken = await admin.auth().verifyIdToken(token);
    req.user = decodedToken;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

const validatePaymentData = (req, res, next) => {
  const { amount, courseId, userId } = req.body;
  
  if (!amount || amount <= 0) {
    return res.status(400).json({ error: 'Invalid amount' });
  }
  
  if (!courseId || !userId) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  
  next();
};

// ===== PAYMENT CONFIG =====
router.get('/config/payment-config', (req, res) => {
  res.json({
    success: true,
    config: {
      paychangu: {
        publicKey: process.env.PAYCHANGU_PUBLIC_KEY,
        mode: process.env.PAYCHANGU_MODE || 'test'
      },
      paypal: {
        clientId: process.env.PAYPAL_CLIENT_ID || 'demo',
        merchantId: process.env.PAYPAL_MERCHANT_ID
      },
      currency: {
        base: 'USD',
        mwkRate: parseInt(process.env.EXCHANGE_RATE) || 800,
        tolerance: 0.01
      },
      fees: {
        platform: 0.10,
        paychangu: 0.03,
        paypal: 0.029
      }
    }
  });
});

// ===== VALIDATE AMOUNT =====
router.post('/validate-amount', authenticate, async (req, res) => {
  try {
    const { requiredAmount, paidAmount, courseId } = req.body;
    const userId = req.user.uid;
    
    // Get course price from database
    const courseDoc = await admin.firestore().collection('courses').doc(courseId).get();
    if (!courseDoc.exists) {
      return res.status(404).json({ error: 'Course not found' });
    }
    
    const courseData = courseDoc.data();
    const actualRequired = courseData.priceUSD * (1 + 0.10); // Including platform fee
    
    const validation = await validatePaymentAmount(actualRequired, paidAmount);
    
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        valid: false,
        error: validation.message,
        type: validation.type,
        details: {
          required: actualRequired,
          paid: paidAmount,
          shortfall: actualRequired - paidAmount
        }
      });
    }
    
    res.json({
      success: true,
      valid: true,
      message: 'Amount is valid',
      details: {
        required: actualRequired,
        paid: paidAmount,
        overpayment: validation.overpayment || 0
      }
    });
    
  } catch (error) {
    console.error('Amount validation error:', error);
    res.status(500).json({ error: 'Validation failed' });
  }
});

// ===== CHECK EXISTING PAYMENTS =====
router.post('/check-existing', authenticate, async (req, res) => {
  try {
    const { courseId } = req.body;
    const userId = req.user.uid;
    
    // Check for existing completed payments for this course
    const paymentsSnapshot = await admin.firestore()
      .collection('payments')
      .where('userId', '==', userId)
      .where('courseId', '==', courseId)
      .where('status', 'in', ['completed', 'verified'])
      .limit(1)
      .get();
    
    if (paymentsSnapshot.empty) {
      return res.json({
        exists: false,
        completed: false
      });
    }
    
    const paymentDoc = paymentsSnapshot.docs[0];
    const paymentData = paymentDoc.data();
    
    res.json({
      exists: true,
      completed: true,
      paymentId: paymentDoc.id,
      data: paymentData,
      enrolled: paymentData.enrolled || false
    });
    
  } catch (error) {
    console.error('Check existing payment error:', error);
    res.status(500).json({ error: 'Failed to check existing payments' });
  }
});

// ===== CREATE PAYCHANGU PAYMENT =====
router.post('/create-paychangu', authenticate, validatePaymentData, async (req, res) => {
  try {
    const { courseId, amount, phoneNumber, network, paymentPin } = req.body;
    const userId = req.user.uid;
    
    // Validate amount again
    const courseDoc = await admin.firestore().collection('courses').doc(courseId).get();
    if (!courseDoc.exists) {
      return res.status(404).json({ error: 'Course not found' });
    }
    
    const courseData = courseDoc.data();
    const requiredAmount = courseData.priceUSD * (1 + 0.10); // With platform fee
    
    const validation = await validatePaymentAmount(requiredAmount, amount);
    if (!validation.valid) {
      return res.status(400).json({
        error: validation.message,
        type: validation.type
      });
    }
    
    // Validate phone number format
    if (!phoneNumber || !phoneNumber.match(/^\+?265\d{9}$/)) {
      return res.status(400).json({ error: 'Invalid phone number format' });
    }
    
    // Generate order ID
    const orderId = `MRTC-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
    
    // Create payment record
    const paymentRef = admin.firestore().collection('payments').doc();
    const paymentData = {
      id: paymentRef.id,
      orderId,
      userId,
      courseId,
      courseTitle: courseData.title,
      amount: {
        usd: amount,
        mwk: amount * (parseInt(process.env.EXCHANGE_RATE) || 800)
      },
      method: 'paychangu',
      network: network || 'airtel',
      phoneNumber,
      status: 'pending',
      currency: 'USD',
      fees: {
        platform: courseData.priceUSD * 0.10,
        processing: amount * 0.03 // Paychangu fee
      },
      paymentDetails: {
        provider: 'Paychangu',
        mode: process.env.PAYCHANGU_MODE || 'test',
        timestamp: new Date().toISOString()
      },
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    
    await paymentRef.set(paymentData);
    
    // Create Paychangu payment request
    const paychanguResponse = await createPaychanguPayment({
      amount: paymentData.amount.mwk,
      phoneNumber,
      network,
      orderId,
      description: `MRTC eCampus: ${courseData.title}`,
      callbackUrl: `${process.env.BASE_URL}/api/payments/paychangu-webhook`
    });
    
    if (!paychanguResponse.success) {
      throw new Error('Paychangu payment creation failed');
    }
    
    // Update payment with Paychangu reference
    await paymentRef.update({
      'paymentDetails.transactionId': paychanguResponse.transactionId,
      'paymentDetails.paymentUrl': paychanguResponse.paymentUrl,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    res.json({
      success: true,
      paymentId: paymentRef.id,
      orderId,
      paymentUrl: paychanguResponse.paymentUrl,
      transactionId: paychanguResponse.transactionId,
      amount: {
        usd: amount,
        mwk: paymentData.amount.mwk
      }
    });
    
  } catch (error) {
    console.error('Paychangu payment error:', error);
    res.status(500).json({ 
      error: 'Payment creation failed', 
      details: error.message 
    });
  }
});

// ===== CREATE PAYPAL ORDER =====
router.post('/create-paypal', authenticate, validatePaymentData, async (req, res) => {
  try {
    const { courseId, amount } = req.body;
    const userId = req.user.uid;
    
    // Get course details
    const courseDoc = await admin.firestore().collection('courses').doc(courseId).get();
    if (!courseDoc.exists) {
      return res.status(404).json({ error: 'Course not found' });
    }
    
    const courseData = courseDoc.data();
    
    // Validate amount
    const requiredAmount = courseData.priceUSD * (1 + 0.10);
    const validation = await validatePaymentAmount(requiredAmount, amount);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.message });
    }
    
    // Generate order ID
    const orderId = `MRTC-PAYPAL-${Date.now().toString(36).toUpperCase()}`;
    
    // Create PayPal order
    const paypalResponse = await createPayPalOrder({
      amount,
      currency: 'USD',
      description: `MRTC eCampus: ${courseData.title}`,
      orderId,
      returnUrl: `${process.env.BASE_URL}/payment-success.html?order=${orderId}`,
      cancelUrl: `${process.env.BASE_URL}/payment-cancel.html?order=${orderId}`
    });
    
    if (!paypalResponse.success) {
      throw new Error('PayPal order creation failed');
    }
    
    // Create payment record
    const paymentRef = admin.firestore().collection('payments').doc();
    await paymentRef.set({
      id: paymentRef.id,
      orderId,
      userId,
      courseId,
      courseTitle: courseData.title,
      amount: {
        usd: amount,
        mwk: amount * (parseInt(process.env.EXCHANGE_RATE) || 800)
      },
      method: 'paypal',
      status: 'pending',
      currency: 'USD',
      fees: {
        platform: courseData.priceUSD * 0.10,
        processing: (amount * 0.029) + 0.30 // PayPal fee
      },
      paymentDetails: {
        paypalOrderId: paypalResponse.orderId,
        approveUrl: paypalResponse.approveUrl,
        timestamp: new Date().toISOString()
      },
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    res.json({
      success: true,
      orderId: paypalResponse.orderId,
      approveUrl: paypalResponse.approveUrl,
      paymentId: paymentRef.id
    });
    
  } catch (error) {
    console.error('PayPal order error:', error);
    res.status(500).json({ error: 'PayPal order creation failed' });
  }
});

// ===== VERIFY PAYMENT =====
router.post('/verify-payment', authenticate, async (req, res) => {
  try {
    const { paymentId, orderId, method } = req.body;
    const userId = req.user.uid;
    
    // Get payment document
    let paymentRef;
    if (paymentId) {
      paymentRef = admin.firestore().collection('payments').doc(paymentId);
    } else if (orderId) {
      const snapshot = await admin.firestore().collection('payments')
        .where('orderId', '==', orderId)
        .limit(1)
        .get();
      
      if (snapshot.empty) {
        return res.status(404).json({ error: 'Payment not found' });
      }
      
      paymentRef = snapshot.docs[0].ref;
    } else {
      return res.status(400).json({ error: 'Missing payment identifier' });
    }
    
    const paymentDoc = await paymentRef.get();
    if (!paymentDoc.exists) {
      return res.status(404).json({ error: 'Payment not found' });
    }
    
    const paymentData = paymentDoc.data();
    
    // Verify ownership
    if (paymentData.userId !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    // Verify payment with provider
    const verification = await verifyPayment(paymentData, method);
    
    if (!verification.success) {
      // Update payment status
      await paymentRef.update({
        status: 'failed',
        verificationError: verification.error,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      
      return res.json({
        success: false,
        status: 'failed',
        error: verification.error,
        payment: {
          id: paymentDoc.id,
          ...paymentData
        }
      });
    }
    
    // Update payment status
    await paymentRef.update({
      status: 'completed',
      paymentDetails: {
        ...paymentData.paymentDetails,
        verifiedAt: new Date().toISOString(),
        providerTransactionId: verification.transactionId
      },
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    // Enroll user in course
    const enrollmentResult = await enrollUserInCourse(userId, paymentData.courseId, paymentDoc.id);
    
    res.json({
      success: true,
      status: 'completed',
      verified: true,
      enrolled: enrollmentResult.success,
      payment: {
        id: paymentDoc.id,
        ...paymentData,
        status: 'completed'
      },
      enrollment: enrollmentResult
    });
    
  } catch (error) {
    console.error('Payment verification error:', error);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// ===== ENROLL USER =====
router.post('/enroll-user', authenticate, async (req, res) => {
  try {
    const { courseId, paymentId } = req.body;
    const userId = req.user.uid;
    
    const enrollmentResult = await enrollUserInCourse(userId, courseId, paymentId);
    
    if (!enrollmentResult.success) {
      return res.status(400).json({
        success: false,
        error: enrollmentResult.error
      });
    }
    
    res.json({
      success: true,
      enrollment: enrollmentResult
    });
    
  } catch (error) {
    console.error('Enrollment error:', error);
    res.status(500).json({ error: 'Enrollment failed' });
  }
});

// ===== UPLOAD BANK PROOF =====
router.post('/uploads/bank-proof', authenticate, async (req, res) => {
  try {
    if (!req.files || !req.files.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    const file = req.files.file;
    const { orderId, userId } = req.body;
    
    // Validate file
    const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg', 'application/pdf'];
    if (!allowedTypes.includes(file.mimetype)) {
      return res.status(400).json({ error: 'Invalid file type' });
    }
    
    if (file.size > 10 * 1024 * 1024) { // 10MB
      return res.status(400).json({ error: 'File too large (max 10MB)' });
    }
    
    // Upload to Google Drive
    const driveResult = await uploadToGoogleDrive(
      file.data,
      file.name,
      file.mimetype,
      process.env.GOOGLE_DRIVE_FOLDER_ID
    );
    
    if (!driveResult.success) {
      throw new Error('Google Drive upload failed');
    }
    
    // Create payment record for bank transfer
    const paymentRef = admin.firestore().collection('payments').doc();
    await paymentRef.set({
      id: paymentRef.id,
      orderId,
      userId,
      method: 'bank_transfer',
      status: 'pending_verification',
      proof: {
        fileName: file.name,
        mimeType: file.mimetype,
        size: file.size,
        driveId: driveResult.fileId,
        driveUrl: driveResult.webViewLink,
        downloadUrl: driveResult.downloadUrl,
        uploadedAt: new Date().toISOString()
      },
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    res.json({
      success: true,
      fileUrl: driveResult.webViewLink,
      fileId: driveResult.fileId,
      downloadUrl: driveResult.downloadUrl,
      paymentId: paymentRef.id,
      message: 'Proof uploaded successfully. Payment will be verified within 24 hours.'
    });
    
  } catch (error) {
    console.error('Bank proof upload error:', error);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// ===== PAYCHANGU WEBHOOK =====
router.post('/paychangu-webhook', async (req, res) => {
  try {
    const payload = req.body;
    
    // Verify webhook signature
    const signature = req.headers['x-paychangu-signature'];
    if (!verifyPaychanguWebhook(payload, signature)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }
    
    const { transactionId, status, orderId, amount } = payload;
    
    // Find payment
    const paymentsSnapshot = await admin.firestore()
      .collection('payments')
      .where('orderId', '==', orderId)
      .limit(1)
      .get();
    
    if (paymentsSnapshot.empty) {
      return res.status(404).json({ error: 'Payment not found' });
    }
    
    const paymentDoc = paymentsSnapshot.docs[0];
    const paymentRef = paymentDoc.ref;
    const paymentData = paymentDoc.data();
    
    // Update payment status
    let newStatus;
    switch (status) {
      case 'SUCCESS':
        newStatus = 'completed';
        break;
      case 'FAILED':
        newStatus = 'failed';
        break;
      case 'PENDING':
        newStatus = 'pending';
        break;
      default:
        newStatus = 'processing';
    }
    
    await paymentRef.update({
      status: newStatus,
      'paymentDetails.webhookReceived': true,
      'paymentDetails.webhookStatus': status,
      'paymentDetails.transactionId': transactionId,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    // If payment completed, enroll user
    if (status === 'SUCCESS') {
      await enrollUserInCourse(paymentData.userId, paymentData.courseId, paymentDoc.id);
    }
    
    res.json({ success: true, status: newStatus });
    
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// ===== PAYPAL WEBHOOK =====
router.post('/paypal-webhook', async (req, res) => {
  try {
    const payload = req.body;
    const signature = req.headers['paypal-transmission-id'];
    
    // Verify PayPal webhook
    if (!verifyPayPalWebhook(payload, signature)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }
    
    const { resource_type, event_type, resource } = payload;
    
    if (event_type === 'PAYMENT.CAPTURE.COMPLETED') {
      const orderId = resource.supplementary_data.related_ids.order_id;
      
      // Find payment
      const paymentsSnapshot = await admin.firestore()
        .collection('payments')
        .where('paymentDetails.paypalOrderId', '==', orderId)
        .limit(1)
        .get();
      
      if (!paymentsSnapshot.empty) {
        const paymentDoc = paymentsSnapshot.docs[0];
        const paymentRef = paymentDoc.ref;
        const paymentData = paymentDoc.data();
        
        // Update payment status
        await paymentRef.update({
          status: 'completed',
          'paymentDetails.captureId': resource.id,
          'paymentDetails.captureStatus': resource.status,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        
        // Enroll user
        await enrollUserInCourse(paymentData.userId, paymentData.courseId, paymentDoc.id);
      }
    }
    
    res.json({ success: true });
    
  } catch (error) {
    console.error('PayPal webhook error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// ===== HELPER FUNCTIONS =====
async function enrollUserInCourse(userId, courseId, paymentId) {
  try {
    // Check if already enrolled
    const enrollmentSnapshot = await admin.firestore()
      .collection('enrollments')
      .where('userId', '==', userId)
      .where('courseId', '==', courseId)
      .limit(1)
      .get();
    
    if (!enrollmentSnapshot.empty) {
      return {
        success: false,
        error: 'Already enrolled',
        enrolled: true
      };
    }
    
    // Create enrollment
    const enrollmentRef = admin.firestore().collection('enrollments').doc();
    await enrollmentRef.set({
      id: enrollmentRef.id,
      userId,
      courseId,
      paymentId,
      enrolledAt: new Date().toISOString(),
      status: 'active',
      progress: 0,
      completed: false,
      certificateEligible: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    // Update user's enrolled courses
    const userRef = admin.firestore().collection('users').doc(userId);
    await userRef.update({
      enrolledCourses: admin.firestore.FieldValue.arrayUnion(courseId),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    // Update course enrollment count
    const courseRef = admin.firestore().collection('courses').doc(courseId);
    await courseRef.update({
      totalEnrollments: admin.firestore.FieldValue.increment(1),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    // Send enrollment email
    await sendEnrollmentEmail(userId, courseId);
    
    return {
      success: true,
      enrollmentId: enrollmentRef.id,
      enrolledAt: new Date().toISOString()
    };
    
  } catch (error) {
    console.error('Enrollment error:', error);
    throw error;
  }
}

async function sendEnrollmentEmail(userId, courseId) {
  // Implementation for sending email
  // You can use nodemailer or your email service
  console.log(`Enrollment email sent for user ${userId}, course ${courseId}`);
  return { success: true };
}

async function createPaychanguPayment(data) {
  const { amount, phoneNumber, network, orderId, description, callbackUrl } = data;
  
  try {
    // Paychangu API integration
    const paychanguApi = process.env.PAYCHANGU_MODE === 'live'
      ? 'https://api.paychangu.com/v1'
      : 'https://api-test.paychangu.com/v1';
    
    const response = await fetch(`${paychanguApi}/payment/request`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.PAYCHANGU_SECRET_KEY}`
      },
      body: JSON.stringify({
        amount: Math.round(amount), // Round to whole MK
        currency: 'MWK',
        mobile: phoneNumber,
        network,
        reference: orderId,
        description,
        callback_url: callbackUrl,
        public_key: process.env.PAYCHANGU_PUBLIC_KEY
      })
    });
    
    const result = await response.json();
    
    if (result.status === 'success') {
      return {
        success: true,
        transactionId: result.transaction_id,
        paymentUrl: result.payment_url || result.checkout_url
      };
    } else {
      throw new Error(result.message || 'Paychangu payment failed');
    }
    
  } catch (error) {
    console.error('Paychangu API error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

async function createPayPalOrder(data) {
  const { amount, currency, description, orderId, returnUrl, cancelUrl } = data;
  
  try {
    // PayPal API integration
    const paypalApi = process.env.PAYPAL_MODE === 'live'
      ? 'https://api-m.paypal.com'
      : 'https://api-m.sandbox.paypal.com';
    
    // Get access token
    const authResponse = await fetch(`${paypalApi}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString('base64')}`
      },
      body: 'grant_type=client_credentials'
    });
    
    const authData = await authResponse.json();
    const accessToken = authData.access_token;
    
    // Create order
    const orderResponse = await fetch(`${paypalApi}/v2/checkout/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{
          reference_id: orderId,
          description: description,
          amount: {
            currency_code: currency,
            value: amount.toFixed(2)
          }
        }],
        application_context: {
          brand_name: 'MRTC eCampus',
          landing_page: 'LOGIN',
          user_action: 'PAY_NOW',
          return_url: returnUrl,
          cancel_url: cancelUrl
        }
      })
    });
    
    const orderData = await orderResponse.json();
    
    if (orderData.status === 'CREATED') {
      return {
        success: true,
        orderId: orderData.id,
        approveUrl: orderData.links.find(link => link.rel === 'approve')?.href
      };
    } else {
      throw new Error('PayPal order creation failed');
    }
    
  } catch (error) {
    console.error('PayPal API error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

async function verifyPayment(paymentData, method) {
  switch (method) {
    case 'paychangu':
      return await verifyPaychanguPayment(paymentData);
    case 'paypal':
      return await verifyPayPalPayment(paymentData);
    case 'bank_transfer':
      return await verifyBankTransfer(paymentData);
    default:
      return { success: false, error: 'Invalid payment method' };
  }
}

async function verifyPaychanguPayment(paymentData) {
  try {
    const transactionId = paymentData.paymentDetails?.transactionId;
    
    if (!transactionId) {
      return { success: false, error: 'No transaction ID' };
    }
    
    const paychanguApi = process.env.PAYCHANGU_MODE === 'live'
      ? 'https://api.paychangu.com/v1'
      : 'https://api-test.paychangu.com/v1';
    
    const response = await fetch(`${paychanguApi}/payment/status/${transactionId}`, {
      headers: {
        'Authorization': `Bearer ${process.env.PAYCHANGU_SECRET_KEY}`
      }
    });
    
    const result = await response.json();
    
    if (result.status === 'success' && result.data?.status === 'SUCCESS') {
      return {
        success: true,
        transactionId: result.data.transaction_id,
        verified: true
      };
    } else {
      return {
        success: false,
        error: result.message || 'Payment verification failed'
      };
    }
    
  } catch (error) {
    console.error('Paychangu verification error:', error);
    return { success: false, error: error.message };
  }
}

async function verifyPayPalPayment(paymentData) {
  try {
    const orderId = paymentData.paymentDetails?.paypalOrderId;
    
    if (!orderId) {
      return { success: false, error: 'No PayPal order ID' };
    }
    
    const paypalApi = process.env.PAYPAL_MODE === 'live'
      ? 'https://api-m.paypal.com'
      : 'https://api-m.sandbox.paypal.com';
    
    // Get access token
    const authResponse = await fetch(`${paypalApi}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString('base64')}`
      },
      body: 'grant_type=client_credentials'
    });
    
    const authData = await authResponse.json();
    const accessToken = authData.access_token;
    
    // Check order status
    const orderResponse = await fetch(`${paypalApi}/v2/checkout/orders/${orderId}`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });
    
    const orderData = await orderResponse.json();
    
    if (orderData.status === 'COMPLETED') {
      return {
        success: true,
        transactionId: orderData.id,
        verified: true
      };
    } else {
      return {
        success: false,
        error: `Order status: ${orderData.status}`
      };
    }
    
  } catch (error) {
    console.error('PayPal verification error:', error);
    return { success: false, error: error.message };
  }
}

async function verifyBankTransfer(paymentData) {
  // Bank transfers need manual verification
  // This would typically be done by admin
  return {
    success: false,
    error: 'Bank transfers require manual verification',
    requiresManualVerification: true
  };
}

function verifyPaychanguWebhook(payload, signature) {
  // Implement Paychangu webhook signature verification
  // This should use Paychangu's webhook secret
  const webhookSecret = process.env.PAYCHANGU_WEBHOOK_SECRET;
  
  // Simplified verification - in production, implement proper HMAC verification
  if (!webhookSecret) return true; // For testing
  
  // TODO: Implement proper HMAC signature verification
  return true;
}

function verifyPayPalWebhook(payload, signature) {
  // Implement PayPal webhook signature verification
  // This should use PayPal's webhook verification
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  
  if (!webhookId) return true; // For testing
  
  // TODO: Implement proper PayPal webhook verification
  return true;
}

module.exports = router;