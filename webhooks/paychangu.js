// PayChangu Webhook Handler for Backend
const express = require('express');
const crypto = require('crypto');
const router = express.Router();

// Webhook secret from PayChangu dashboard
const PAYCHANGU_WEBHOOK_SECRET = process.env.PAYCHANGU_WEBHOOK_SECRET || 'your-webhook-secret-here';

// Verify PayChangu webhook signature
const verifyPaychanguSignature = (req) => {
    const signature = req.headers['x-paychangu-signature'];
    const payload = JSON.stringify(req.body);
    
    if (!signature) {
        return false;
    }
    
    const hmac = crypto.createHmac('sha256', PAYCHANGU_WEBHOOK_SECRET);
    const computedSignature = hmac.update(payload).digest('hex');
    
    return crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(computedSignature)
    );
};

// Handle PayChangu webhook
router.post('/paychangu', async (req, res) => {
    try {
        // Verify signature
        if (!verifyPaychanguSignature(req)) {
            console.error('Invalid PayChangu webhook signature');
            return res.status(401).json({ error: 'Invalid signature' });
        }
        
        const event = req.body;
        console.log('PayChangu webhook received:', event);
        
        // Process based on event type
        switch (event.type) {
            case 'payment.success':
                await handlePaymentSuccess(event.data);
                break;
                
            case 'payment.failed':
                await handlePaymentFailed(event.data);
                break;
                
            case 'payment.pending':
                await handlePaymentPending(event.data);
                break;
                
            default:
                console.log('Unhandled PayChangu event type:', event.type);
        }
        
        res.json({ received: true });
        
    } catch (error) {
        console.error('Error processing PayChangu webhook:', error);
        res.status(500).json({ error: error.message });
    }
});

// Handle successful payment
async function handlePaymentSuccess(paymentData) {
    const { reference, transaction_id, amount, currency, phone, network } = paymentData;
    
    console.log(`Payment successful: ${reference}, Amount: ${amount} ${currency}`);
    
    // Get Firestore instance
    const admin = require('firebase-admin');
    const db = admin.firestore();
    
    try {
        // Find order by reference
        const ordersSnapshot = await db.collection('payment_orders')
            .where('orderId', '==', reference)
            .limit(1)
            .get();
        
        if (ordersSnapshot.empty) {
            console.error('Order not found:', reference);
            return;
        }
        
        const orderDoc = ordersSnapshot.docs[0];
        const order = orderDoc.data();
        
        // Update order status
        await orderDoc.ref.update({
            status: 'completed',
            paymentStatus: 'completed',
            transactionId: transaction_id,
            paymentNetwork: network,
            paymentPhone: phone,
            completedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        
        // Create payment record
        const paymentId = `PCHG-${transaction_id}`;
        await db.collection('payments').doc(paymentId).set({
            paymentId: paymentId,
            orderId: order.orderId,
            userId: order.userId,
            courseId: order.courseId,
            amount: order.totalAmount,
            amountMWK: order.amountMWK,
            currency: order.currency,
            paymentMethod: 'paychangu',
            paymentNetwork: network,
            transactionId: transaction_id,
            status: 'completed',
            phone: phone,
            network: network,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            metadata: paymentData
        });
        
        // Enroll user in course
        await enrollUserInCourse(order.userId, order.courseId, order.orderId);
        
        console.log(`User ${order.userId} enrolled in course ${order.courseId}`);
        
    } catch (error) {
        console.error('Error handling successful payment:', error);
        throw error;
    }
}

// Handle failed payment
async function handlePaymentFailed(paymentData) {
    const { reference, reason } = paymentData;
    
    console.log(`Payment failed: ${reference}, Reason: ${reason}`);
    
    const admin = require('firebase-admin');
    const db = admin.firestore();
    
    try {
        // Find and update order
        const ordersSnapshot = await db.collection('payment_orders')
            .where('orderId', '==', reference)
            .limit(1)
            .get();
        
        if (!ordersSnapshot.empty) {
            const orderDoc = ordersSnapshot.docs[0];
            await orderDoc.ref.update({
                status: 'failed',
                paymentStatus: 'failed',
                failureReason: reason,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
        }
        
    } catch (error) {
        console.error('Error handling failed payment:', error);
    }
}

// Handle pending payment
async function handlePaymentPending(paymentData) {
    const { reference } = paymentData;
    
    console.log(`Payment pending: ${reference}`);
    
    const admin = require('firebase-admin');
    const db = admin.firestore();
    
    try {
        const ordersSnapshot = await db.collection('payment_orders')
            .where('orderId', '==', reference)
            .limit(1)
            .get();
        
        if (!ordersSnapshot.empty) {
            const orderDoc = ordersSnapshot.docs[0];
            await orderDoc.ref.update({
                status: 'pending',
                paymentStatus: 'pending',
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
        }
        
    } catch (error) {
        console.error('Error handling pending payment:', error);
    }
}

// Enroll user in course
async function enrollUserInCourse(userId, courseId, orderId) {
    const admin = require('firebase-admin');
    const db = admin.firestore();
    
    try {
        const enrollmentId = `${userId}_${courseId}`;
        
        const enrollmentData = {
            enrollmentId: enrollmentId,
            userId: userId,
            courseId: courseId,
            orderId: orderId,
            enrolledAt: admin.firestore.FieldValue.serverTimestamp(),
            progress: 0,
            completed: false,
            lastAccessed: admin.firestore.FieldValue.serverTimestamp(),
            status: 'active'
        };
        
        await db.collection('enrollments').doc(enrollmentId).set(enrollmentData);
        
        // Update course enrollment count
        await db.collection('courses').doc(courseId).update({
            enrollmentCount: admin.firestore.FieldValue.increment(1),
            lastEnrollment: admin.firestore.FieldValue.serverTimestamp()
        });
        
        // Send enrollment confirmation email
        await sendEnrollmentConfirmation(userId, courseId);
        
    } catch (error) {
        console.error('Error enrolling user:', error);
        throw error;
    }
}

// Send enrollment confirmation email
async function sendEnrollmentConfirmation(userId, courseId) {
    // This would use your email service (SendGrid, AWS SES, etc.)
    console.log(`Sending enrollment confirmation to user ${userId} for course ${courseId}`);
    
    // Example using SendGrid:
    /*
    const sgMail = require('@sendgrid/mail');
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
    
    const userDoc = await db.collection('users').doc(userId).get();
    const courseDoc = await db.collection('courses').doc(courseId).get();
    
    const msg = {
        to: userDoc.data().email,
        from: 'noreply@mrtc-ecampus.web.app',
        subject: 'Course Enrollment Confirmation',
        html: `<h2>Welcome to ${courseDoc.data().title}!</h2>...`
    };
    
    await sgMail.send(msg);
    */
}

module.exports = router;