/**
 * Payment Validation Utilities
 * Validates payment data before order creation or payment updates
 */

/**
 * Validate payment data
 * @param {Object} paymentData - Payment data object
 * @param {number} totalAmount - Total order amount
 * @returns {Object} Validation result with valid flag and error message
 */
function validatePayment(paymentData, totalAmount) {
  const paidAmount = parseFloat(paymentData.paid_amount || 0);
  const paymentStatus = paymentData.payment_status || 'not_paid';
  const paymentMethod = paymentData.payment_method || 'cash';

  // Validate payment amount is not negative
  if (paidAmount < 0) {
    return { valid: false, error: 'Payment amount cannot be negative' };
  }

  // Validate payment status and amount consistency
  if (paymentStatus === 'paid_full') {
    if (Math.abs(paidAmount - totalAmount) > 0.01) { // Allow 0.01 tolerance for rounding
      return { 
        valid: false, 
        error: `Paid amount (${paidAmount.toFixed(2)}) must equal total amount (${totalAmount.toFixed(2)}) for full payment` 
      };
    }
  } else if (paymentStatus === 'advance') {
    if (paidAmount <= 0) {
      return { valid: false, error: 'Advance payment must be greater than zero' };
    }
    if (paidAmount >= totalAmount) {
      return { 
        valid: false, 
        error: `Advance payment (${paidAmount.toFixed(2)}) must be less than total amount (${totalAmount.toFixed(2)})` 
      };
    }
  } else if (paymentStatus === 'not_paid') {
    if (paidAmount > 0) {
      return { valid: false, error: 'Cannot have paid amount for unpaid orders' };
    }
  } else {
    return { valid: false, error: `Invalid payment status: ${paymentStatus}` };
  }

  // Validate payment method
  const validPaymentMethods = ['cash', 'card', 'mobile_money', 'book'];
  if (!validPaymentMethods.includes(paymentMethod)) {
    return { valid: false, error: `Invalid payment method: ${paymentMethod}` };
  }

  return { valid: true };
}

/**
 * Validate payment update (when updating existing order payment)
 * @param {Object} currentOrder - Current order data
 * @param {Object} newPaymentData - New payment data
 * @returns {Object} Validation result
 */
function validatePaymentUpdate(currentOrder, newPaymentData) {
  const totalAmount = parseFloat(currentOrder.total_amount || 0);
  const newPaidAmount = parseFloat(newPaymentData.paid_amount || currentOrder.paid_amount || 0);
  const newPaymentStatus = newPaymentData.payment_status || currentOrder.payment_status;
  
  // Calculate total already paid (including existing transactions)
  // This will be handled by checking transactions table in the route handler
  
  return validatePayment({
    paid_amount: newPaidAmount,
    payment_status: newPaymentStatus,
    payment_method: newPaymentData.payment_method || currentOrder.payment_method
  }, totalAmount);
}

module.exports = {
  validatePayment,
  validatePaymentUpdate
};
