const axios = require('axios');
const db = require('../database/db');

// SMS notification service
// This is a template - you'll need to integrate with a Tanzanian SMS provider
// Common providers: Africa's Talking, Twilio (Tanzania), SMS Gateway API

async function sendSMS(phone, message, options = {}) {
  const { customerId, orderId, notificationType = 'ready' } = options;
  
  // Remove any non-numeric characters and ensure it starts with country code
  const cleanPhone = phone.replace(/\D/g, '');
  const formattedPhone = cleanPhone.startsWith('255') 
    ? `+${cleanPhone}` 
    : `+255${cleanPhone.slice(-9)}`;

  // Create notification record (await so we have notificationId for status updates, especially on PostgreSQL)
  let notificationId = null;
  if (customerId) {
    try {
      const insertResult = await db.run(
        `INSERT INTO notifications (customer_id, order_id, notification_type, channel, recipient, message, status)
         VALUES (?, ?, ?, 'sms', ?, ?, 'pending')`,
        [customerId, orderId || null, notificationType, formattedPhone, message]
      );
      notificationId = insertResult?.row?.id ?? insertResult?.lastID ?? null;
    } catch (insertErr) {
      console.error('SMS: failed to create notification record:', insertErr.message);
    }
  }

  try {
    const provider = (process.env.SMS_PROVIDER || 'africastalking').toLowerCase();
    const apiKey = process.env.SMS_API_KEY || process.env.TWILIO_AUTH_TOKEN;

    // If no SMS provider configured, just log (for development)
    if (!apiKey) {
      console.log(`📱 SMS (not sent - no API key): ${formattedPhone}`);
      console.log(`Message: ${message}`);
      if (notificationId) {
        db.run(
          `UPDATE notifications SET status = 'logged', sent_at = CURRENT_TIMESTAMP, error_message = 'No API key configured' WHERE id = ?`,
          [notificationId]
        );
      }
      return { success: true, message: 'SMS logged (no API key configured)', notificationId };
    }

    // ----- Twilio -----
    if (provider === 'twilio') {
      const accountSid = process.env.TWILIO_ACCOUNT_SID;
      const authToken = process.env.TWILIO_AUTH_TOKEN;
      const fromNumber = process.env.TWILIO_PHONE_NUMBER;
      if (!accountSid || !authToken || !fromNumber) {
        throw new Error('Twilio requires TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER in .env');
      }
      try {
        const response = await axios.post(
          `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
          new URLSearchParams({
            To: formattedPhone,
            From: fromNumber,
            Body: message
          }),
          {
            auth: { username: accountSid, password: authToken },
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
          }
        );
        if (response.data && response.data.sid) {
          if (notificationId) {
            db.run(
              `UPDATE notifications SET status = 'sent', sent_at = CURRENT_TIMESTAMP WHERE id = ?`,
              [notificationId]
            );
          }
          return { success: true, message: 'SMS sent successfully', notificationId, provider: 'twilio' };
        }
        throw new Error('Twilio returned no message SID');
      } catch (apiError) {
        const errMsg = apiError.response?.data?.message || apiError.message;
        console.error('Twilio SMS error:', errMsg);
        if (notificationId) {
          db.run(
            `UPDATE notifications SET status = 'failed', error_message = ? WHERE id = ?`,
            [errMsg, notificationId]
          );
        }
        return { success: false, error: errMsg, notificationId };
      }
    }

    // ----- Africa's Talking (default) -----
    const smsConfig = {
      apiKey: process.env.SMS_API_KEY,
      apiUrl: process.env.SMS_API_URL || 'https://api.africastalking.com/version1/messaging',
      username: process.env.SMS_USERNAME,
    };
    if (!smsConfig.username) {
      console.warn('📱 SMS: SMS_USERNAME is not set. Set it in .env (e.g. "sandbox" for testing or your Africa\'s Talking app username for production).');
    }
    if (smsConfig.apiKey && smsConfig.username) {
      try {
        const response = await axios.post(
          smsConfig.apiUrl,
          new URLSearchParams({
            username: smsConfig.username,
            message: message,
            to: formattedPhone,
            from: process.env.SMS_SENDER_ID || 'SUPACLEAN'
          }),
          {
            headers: {
              'apiKey': smsConfig.apiKey,
              'Content-Type': 'application/x-www-form-urlencoded',
              'Accept': 'application/json'
            }
          }
        );
        if (response.data && response.data.SMSMessageData) {
          const recipients = response.data.SMSMessageData.Recipients || [];
          const first = recipients[0];
          const success = recipients.length > 0 && (first.status === 'Success' || first.statusCode === 101 || first.statusCode === 102);
          if (success) {
            if (notificationId) {
              db.run(
                `UPDATE notifications SET status = 'sent', sent_at = CURRENT_TIMESTAMP WHERE id = ?`,
                [notificationId]
              );
            }
            return { success: true, message: 'SMS sent successfully', notificationId, provider: 'africas_talking' };
          }
          const apiErrMsg = first?.status || first?.message || response.data.SMSMessageData.Message || 'SMS API returned error status';
          console.error('📱 Africa\'s Talking SMS error:', apiErrMsg, 'Response:', JSON.stringify(response.data));
          throw new Error(apiErrMsg);
        }
        console.error('📱 Africa\'s Talking unexpected response:', JSON.stringify(response.data));
        throw new Error('Unexpected response from SMS API');
      } catch (apiError) {
        const errData = apiError.response?.data;
        const errMsg = errData?.message || errData?.SMSMessageData?.Message || apiError.message;
        console.error('📱 Africa\'s Talking SMS failed:', errMsg, errData ? 'Data: ' + JSON.stringify(errData) : '');
        if (notificationId) {
          db.run(
            `UPDATE notifications SET status = 'failed', error_message = ? WHERE id = ?`,
            [String(errMsg).slice(0, 255), notificationId]
          );
        }
        throw apiError;
      }
    }

    if (notificationId) {
      db.run(
        `UPDATE notifications SET status = 'logged', sent_at = CURRENT_TIMESTAMP, error_message = 'No API key configured' WHERE id = ?`,
        [notificationId]
      );
    }
    return { success: true, message: 'SMS logged (no API key configured)', notificationId, logged: true };
  } catch (error) {
    console.error('Error sending SMS:', error);
    
    // Update notification status with error
    if (notificationId) {
      db.run(
        `UPDATE notifications SET status = 'failed', error_message = ? WHERE id = ?`,
        [error.message, notificationId]
      );
    }
    
    return { success: false, error: error.message, notificationId };
  }
}

function generateReadyNotification(receiptNumber, customerName, estimatedDate = null) {
  let message = `Hello ${customerName}, your laundry is ready for collection! Receipt No: ${receiptNumber}`;
  if (estimatedDate) {
    const date = new Date(estimatedDate);
    const dateStr = date.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
    message += `. Est. collection: ${dateStr}`;
  }
  message += `. Thank you - SUPACLEAN`;
  return message;
}

function generateOrderConfirmation(receiptNumber, customerName, totalAmount, estimatedDate = null) {
  let message = `Hello ${customerName}, thank you for your order! Receipt: ${receiptNumber}. Amount: TSh ${totalAmount.toLocaleString()}`;
  if (estimatedDate) {
    const date = new Date(estimatedDate);
    const dateStr = date.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
    message += `. Est. ready: ${dateStr}`;
  }
  message += `. - SUPACLEAN`;
  return message;
}

/**
 * Format payment_status for display in SMS
 */
function formatPaymentStatusForSms(status) {
  const map = {
    paid_full: 'Paid',
    not_paid: 'Not Paid',
    advance: 'Advance',
    credit: 'Credit'
  };
  return map[status] || (status || 'Not Paid');
}

/**
 * Order receipt SMS – sent after creating order and printing receipt.
 * Includes: customer name, customer ID, item descriptions, total amount, payment status.
 *
 * @param {string} customerName
 * @param {string|number} customerId
 * @param {string} itemsDescription - e.g. "2x Wash & Fold (Blue); 1x Iron (Shirts)"
 * @param {number} totalAmount - Total in TSh
 * @param {string} paymentStatus - paid_full, not_paid, advance, credit
 */
function generateOrderReceiptSms(customerName, customerId, itemsDescription, totalAmount, paymentStatus) {
  const amountStr = typeof totalAmount === 'number' ? totalAmount.toLocaleString() : String(totalAmount);
  const statusStr = formatPaymentStatusForSms(paymentStatus);
  const items = (itemsDescription && itemsDescription.trim()) ? itemsDescription.trim() : 'Order items';
  return `SUPACLEAN: Receipt for ${customerName} (ID:${customerId}). ${items}. Total TSh ${amountStr}. Status: ${statusStr}. Thank you.`;
}

function generateCollectionReminder(receiptNumber, customerName, hoursOverdue = 0) {
  let message = `Hello ${customerName}, reminder: Your laundry (Receipt: ${receiptNumber}) is ready for collection`;
  if (hoursOverdue > 0) {
    message += ` (overdue by ${hoursOverdue} hour${hoursOverdue > 1 ? 's' : ''})`;
  }
  message += `. Thank you - SUPACLEAN`;
  return message;
}

/**
 * Invoice / payment notice reminder for monthly billing
 */
function generateInvoiceReminder(invoiceNumber, companyName, amountDue, dueDate, daysOverdue = 0) {
  const amountStr = typeof amountDue === 'number' ? amountDue.toLocaleString() : String(amountDue);
  let message = `SUPACLEAN: Hello ${companyName}, payment reminder for Invoice ${invoiceNumber}. Amount due: TSh ${amountStr}. Due date: ${dueDate}`;
  if (daysOverdue > 0) {
    message += `. This invoice is ${daysOverdue} day${daysOverdue > 1 ? 's' : ''} overdue. Please arrange payment.`;
  } else {
    message += `. Please pay by due date. Thank you.`;
  }
  return message;
}

/**
 * Short payment notice (fits better in SMS character limits)
 */
function generatePaymentNoticeShort(invoiceNumber, companyName, amountDue, daysOverdue = 0) {
  const amountStr = typeof amountDue === 'number' ? amountDue.toLocaleString() : String(amountDue);
  if (daysOverdue > 0) {
    return `SUPACLEAN: Invoice ${invoiceNumber} (${companyName}) is overdue. Balance: TSh ${amountStr}. Please pay.`;
  }
  return `SUPACLEAN: Invoice ${invoiceNumber} (${companyName}) - TSh ${amountStr} due. Please pay on time.`;
}

module.exports = {
  sendSMS,
  generateReadyNotification,
  generateOrderConfirmation,
  generateCollectionReminder,
  generateInvoiceReminder,
  generatePaymentNoticeShort,
  generateOrderReceiptSms,
  formatPaymentStatusForSms
};
