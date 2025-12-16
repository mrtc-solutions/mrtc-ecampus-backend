// PayPal Webhook Handler for Backend
const express = require('express');
const crypto = require('crypto');
const router = express.Router();

// Verify PayPal webhook signature
const verifyPaypalSignature = async (req) => {
    const paypal = require('@paypal/checkout-server-sdk');
    
    // In production, verify with PayPal API
    // This is a simplified version
    
    const signature = req.headers['paypal-transmission-id'];
    const timestamp = req.headers['paypal-transmission-time'];
    const webhookId = process.env.PAYPAL_WEBHOOK_ID;
    
    if (!signature || !timestamp || !webhookId) {
        return false;
    }
    
    // For now, we'll trust the webhook in development
    // In production, implement proper verification
    return true;
};

// Handle PayPal webhook
router.post('/paypal', async (req, res) => {
    try {
        // Verify signature (simplified for development)
        if (process.env.NODE_ENV === 'production') {
            const isValid = await verifyPaypalSignature(req);
            if (!isValid) {
                return res.status(401).json({ error: 'Invalid signature' });
            }
        }
        
        const event = req.body;
        console.log('PayPal webhook received:', event.event_type);
        
        // Process based on event type
        switch (event.event_type) {
            case 'PAYMENT.CAPTURE.COMPLETED':
                await handlePaymentCaptureCompleted(event);
                break;
                
            case 'PAYMENT.CAPTURE.DENIED':
                await handlePaymentCaptureDenied(event);
                break;
                
            case 'PAYMENT.CAPTURE.PENDING':
                await handlePaymentCapturePending(event);
                break;
                
            case 'PAYMENT.CAPTURE.REFUNDED':
                await handlePaymentCaptureRefunded(event);
                break;
                
            default:
                console.log('Unhandled PayPal event:', event.event_type);
        }
        
        res.json({ received: true });
        
    } catch (error) {
        console.error('Error processing PayPal webhook:', error);
        res.status(500).json({ error: error.message });
    }
});

// Handle completed PayPal payment
async function handlePaymentCaptureCompleted(event) {
    const paymentData = event.resource;
    const orderId = paymentData.custom_id || paymentData.invoice_id;
    
    console.log(`PayPal payment completed: ${orderId}, Amount: ${paymentData.amount.value} ${paymentData.amount.currency_code}`);
    
    const admin = require('firebase-admin');
    const db = admin.firestore();
    
    try {
        // Find order
        const ordersSnapshot = await db.collection('payment_orders')
            .where('orderId', '==', orderId)
            .limit(1)
            .get();
        
        if (ordersSnapshot.empty) {
            console.error('Order not found:', orderId);
            return;
        }
        
        const orderDoc = ordersSnapshot.docs[0];
        const order = orderDoc.data();
        
        // Update order status
        await orderDoc.ref.update({
            status: 'completed',
            paymentStatus: 'completed',
            transactionId: paymentData.id,
            payerId: paymentData.payer?.payer_id,
            paymentEmail: paymentData.payer?.email_address,
            completedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        
        // Create payment record
        const paymentId = `PAYPAL-${paymentData.id}`;
        await db.collection('payments').doc(paymentId).set({
            paymentId: paymentId,
            orderId: order.orderId,
            userId: order.userId,
            courseId: order.courseId,
            amount: order.totalAmount,
            amountMWK: order.amountMWK,
            currency: order.currency,
            paymentMethod: 'paypal',
            transactionId: paymentData.id,
            payerId: paymentData.payer?.payer_id,
            payerEmail: paymentData.payer?.email_address,
            status: 'completed',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            metadata: paymentData
        });
        
        // Enroll user in course
        await enrollUserInCourse(order.userId, order.courseId, order.orderId);
        
        console.log(`User ${order.userId} enrolled via PayPal`);
        
    } catch (error) {
        console.error('Error handling PayPal payment:', error);
        throw error;
    }
}

// Handle other PayPal events (simplified)
async function handlePaymentCaptureDenied(event) {
    const paymentData = event.resource;
    const orderId = paymentData.custom_id;
    
    console.log(`PayPal payment denied: ${orderId}`);
    
    const admin = require('firebase-admin');
    const db = admin.firestore();
    
    try {
        const ordersSnapshot = await db.collection('payment_orders')
            .where('orderId', '==', orderId)
            .limit(1)
            .get();
        
        if (!ordersSnapshot.empty) {
            const orderDoc = ordersSnapshot.docs[0];
            await orderDoc.ref.update({
                status: 'failed',
                paymentStatus: 'denied',
                failureReason: 'Payment denied by PayPal',
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
        }
        
    } catch (error) {
        console.error('Error handling denied payment:', error);
    }
}

async function handlePaymentCapturePending(event) {
    const paymentData = event.resource;
    const orderId = paymentData.custom_id;
    
    console.log(`PayPal payment pending: ${orderId}`);
    
    const admin = require('firebase-admin');
    const db = admin.firestore();
    
    try {
        const ordersSnapshot = await db.collection('payment_orders')
            .where('orderId', '==', orderId)
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

async function handlePaymentCaptureRefunded(event) {
    const paymentData = event.resource;
    const orderId = paymentData.custom_id;
    
    console.log(`PayPal payment refunded: ${orderId}`);
    
    const admin = require('firebase-admin');
    const db = admin.firestore();
    
    try {
        const ordersSnapshot = await db.collection('payment_orders')
            .where('orderId', '==', orderId)
            .limit(1)
            .get();
        
        if (!ordersSnapshot.empty) {
            const orderDoc = ordersSnapshot.docs[0];
            
            // Update order
            await orderDoc.ref.update({
                status: 'refunded',
                paymentStatus: 'refunded',
                refundAmount: paymentData.amount.value,
                refundCurrency: paymentData.amount.currency_code,
                refundedAt: admin.firestore.FieldValue.serverTimestamp(),
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            
            // Update enrollment
            const enrollmentId = `${orderDoc.data().userId}_${orderDoc.data().courseId}`;
            const enrollmentRef = db.collection('enrollments').doc(enrollmentId);
            await enrollmentRef.update({
                status: 'refunded',
                refundedAt: admin.firestore.FieldValue.serverTimestamp()
            });
        }
        
    } catch (error) {
        console.error('Error handling refund:', error);
    }
}

// Reuse enrollUserInCourse from paychangu.js
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
        
        await db.collection('courses').doc(courseId).update({
            enrollmentCount: admin.firestore.FieldValue.increment(1),
            lastEnrollment: admin.firestore.FieldValue.serverTimestamp()
        });
        
        console.log(`User ${userId} enrolled via PayPal`);
        
    } catch (error) {
        console.error('Error enrolling user:', error);
        throw error;
    }
}

module.exports = router;