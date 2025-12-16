// Backend API Routes for Payments
const express = require('express');
const admin = require('firebase-admin');
const router = express.Router();

// Initialize Firestore
const db = admin.firestore();

// Create payment order
router.post('/create-order', async (req, res) => {
    try {
        const { userId, courseId, amount, currency, paymentMethod } = req.body;
        
        // Validate input
        if (!userId || !courseId || !amount) {
            return res.status(400).json({ error: 'Missing required fields' });
        }
        
        // Generate order ID
        const orderId = generateOrderId();
        
        // Calculate fees
        const fees = calculateFees(amount, paymentMethod);
        
        // Create order
        const order = {
            orderId: orderId,
            userId: userId,
            courseId: courseId,
            amount: fees.amount,
            platformFee: fees.platformFee,
            paymentFee: fees.paymentFee,
            totalAmount: fees.totalAmount,
            currency: currency || 'USD',
            paymentMethod: paymentMethod,
            status: 'pending',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            expiresAt: new Date(Date.now() + 30 * 60 * 1000) // 30 minutes
        };
        
        // Save to Firestore
        await db.collection('payment_orders').doc(orderId).set(order);
        
        res.json({
            success: true,
            orderId: orderId,
            order: order
        });
        
    } catch (error) {
        console.error('Error creating order:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get payment order status
router.get('/order/:orderId', async (req, res) => {
    try {
        const { orderId } = req.params;
        
        const orderDoc = await db.collection('payment_orders').doc(orderId).get();
        
        if (!orderDoc.exists) {
            return res.status(404).json({ error: 'Order not found' });
        }
        
        res.json({
            success: true,
            order: orderDoc.data()
        });
        
    } catch (error) {
        console.error('Error getting order:', error);
        res.status(500).json({ error: error.message });
    }
});

// Process PayChangu payment
router.post('/paychangu/initiate', async (req, res) => {
    try {
        const { orderId, phoneNumber, network } = req.body;
        
        // Get order
        const orderDoc = await db.collection('payment_orders').doc(orderId).get();
        if (!orderDoc.exists) {
            return res.status(404).json({ error: 'Order not found' });
        }
        
        const order = orderDoc.data();
        
        // Update order status
        await orderDoc.ref.update({
            status: 'processing',
            paymentNetwork: network,
            paymentPhone: phoneNumber,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        
        // In production, call PayChangu API here
        const paymentResponse = await callPayChanguAPI(order, phoneNumber, network);
        
        res.json({
            success: true,
            paymentUrl: paymentResponse.payment_url,
            transactionId: paymentResponse.transaction_id
        });
        
    } catch (error) {
        console.error('Error initiating PayChangu payment:', error);
        res.status(500).json({ error: error.message });
    }
});

// Helper functions
function generateOrderId() {
    const prefix = 'MRTC';
    const date = new Date();
    const timestamp = date.getTime().toString().slice(-6);
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    return `${prefix}-${date.getFullYear()}${(date.getMonth() + 1).toString().padStart(2, '0')}${date.getDate().toString().padStart(2, '0')}-${timestamp}${random}`;
}

function calculateFees(amount, paymentMethod) {
    const PLATFORM_FEE_RATE = 0.10; // 10%
    const USD_TO_MWK = 800;
    
    let paymentFeeRate = 0;
    let fixedFee = 0;
    
    switch(paymentMethod) {
        case 'paychangu': paymentFeeRate = 0.03; break;
        case 'paypal': paymentFeeRate = 0.029; fixedFee = 0.30; break;
        case 'card': paymentFeeRate = 0.035; break;
        case 'bank': paymentFeeRate = 0; break;
        default: paymentFeeRate = 0.03;
    }
    
    const platformFee = amount * PLATFORM_FEE_RATE;
    const paymentFee = (amount * paymentFeeRate) + fixedFee;
    const totalAmount = amount + platformFee + paymentFee;
    const amountMWK = totalAmount * USD_TO_MWK;
    
    return {
        amount: parseFloat(amount.toFixed(2)),
        platformFee: parseFloat(platformFee.toFixed(2)),
        paymentFee: parseFloat(paymentFee.toFixed(2)),
        totalAmount: parseFloat(totalAmount.toFixed(2)),
        amountMWK: parseFloat(amountMWK.toFixed(2))
    };
}

async function callPayChanguAPI(order, phoneNumber, network) {
    // This would make actual API call to PayChangu
    // For now, simulate response
    
    return {
        success: true,
        transaction_id: `PCHG-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`,
        payment_url: `https://payments.paychangu.com/pay/${order.orderId}`,
        status: 'pending'
    };
}

module.exports = router;