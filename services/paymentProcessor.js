// Payment Processor Service
class PaymentProcessor {
  constructor() {
    this.exchangeRate = parseInt(process.env.EXCHANGE_RATE) || 800;
    this.platformFeeRate = 0.10;
  }

  // Calculate total amount with fees
  calculateTotal(amount, method) {
    let feeRate = 0;
    let fixedFee = 0;

    switch (method) {
      case 'paychangu':
        feeRate = 0.03; // 3%
        break;
      case 'paypal':
        feeRate = 0.029; // 2.9%
        fixedFee = 0.30;
        break;
      case 'bank_transfer':
        feeRate = 0;
        break;
      default:
        feeRate = 0.03;
    }

    const platformFee = amount * this.platformFeeRate;
    const paymentFee = (amount * feeRate) + fixedFee;
    const total = amount + platformFee + paymentFee;

    return {
      amount,
      platformFee,
      paymentFee,
      total,
      breakdown: {
        amount,
        platformFee,
        paymentFee,
        total,
        feeRate: feeRate * 100,
        fixedFee,
        platformFeeRate: this.platformFeeRate * 100
      }
    };
  }

  // Validate payment amount
  validateAmount(paidAmount, requiredAmount) {
    const tolerance = 0.01; // $0.01

    if (Math.abs(paidAmount - requiredAmount) > tolerance && paidAmount < requiredAmount) {
      const shortfall = requiredAmount - paidAmount;
      return {
        valid: false,
        type: 'underpayment',
        message: `Underpayment detected. Shortfall: $${shortfall.toFixed(2)}`,
        shortfall
      };
    }

    const overpayment = paidAmount - requiredAmount;
    if (overpayment > 100) {
      return {
        valid: true,
        type: 'overpayment_warning',
        message: `Overpayment detected: $${overpayment.toFixed(2)}`,
        overpayment,
        requiresConfirmation: true
      };
    }

    return {
      valid: true,
      type: 'valid',
      overpayment: overpayment > 0 ? overpayment : 0
    };
  }

  // Convert currency
  convertCurrency(amount, fromCurrency, toCurrency) {
    if (fromCurrency === toCurrency) return amount;

    if (fromCurrency === 'USD' && toCurrency === 'MWK') {
      return amount * this.exchangeRate;
    }

    if (fromCurrency === 'MWK' && toCurrency === 'USD') {
      return amount / this.exchangeRate;
    }

    throw new Error('Unsupported currency conversion');
  }

  // Generate unique transaction ID
  generateTransactionId(prefix = 'TXN') {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 10).toUpperCase();
    return `${prefix}-${timestamp}-${random}`;
  }

  // Format amount for display
  formatAmount(amount, currency = 'USD') {
    if (currency === 'MWK') {
      return `MK ${Math.round(amount).toLocaleString()}`;
    }

    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  }
}

module.exports = PaymentProcessor;