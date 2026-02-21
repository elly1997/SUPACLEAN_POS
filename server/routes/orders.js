const express = require('express');
const router = express.Router();
const db = require('../database/query');
const { generateReceiptNumber, calculateTotal, formatReceipt, formatReceiptAsync, generateReceiptQRCode } = require('../utils/receipt');
const { sendSMS, generateReadyNotification, generateOrderReceiptSms } = require('../utils/sms');
const { sendSmsWithWhatsAppFallback } = require('../utils/notifications');
const { authenticate, requireBranchAccess, requireBranchFeature, requireBranchFeatureAny } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { getBranchFilter, getEffectiveBranchId } = require('../utils/branchFilter');
const { validatePayment } = require('../utils/paymentValidation');
const { recordPaymentTransaction, logPaymentChange } = require('../utils/paymentTransactions');
const { checkDuplicatePayment } = require('../utils/paymentTransactions');
const multer = require('multer');
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const upload = multer({ dest: uploadsDir });

const roundMoney = (x) => (typeof x !== 'number' || Number.isNaN(x) ? 0 : Math.round(x * 100) / 100);

// All order routes require new_order or order_processing (admin bypasses); collect route adds collection
router.use(authenticate, requireBranchFeatureAny('new_order', 'order_processing'));

// Get all orders
router.get('/', requireBranchAccess(), async (req, res) => {
  const { 
    status, 
    customer_id, 
    date, 
    overdue_only,
    customer,
    date_from,
    date_to,
    min_amount,
    max_amount,
    payment_status,
    limit: limitParam,
    offset: offsetParam,
    page
  } = req.query;
  
  const branchFilter = getBranchFilter(req, 'o');
  
  let query = `
    SELECT o.*, s.name as service_name, c.name as customer_name, c.phone as customer_phone,
           b.name as branch_name
    FROM orders o
    JOIN services s ON o.service_id = s.id
    JOIN customers c ON o.customer_id = c.id
    LEFT JOIN branches b ON o.branch_id = b.id
    WHERE 1=1
    ${branchFilter.clause}
  `;
  let params = [...branchFilter.params];

  if (status) {
    // "pending" tab shows both pending and processing (one in-progress tab)
    if (status === 'pending') {
      query += ' AND (o.status = ? OR o.status = ?)';
      params.push('pending', 'processing');
    } else {
      query += ' AND o.status = ?';
      params.push(status);
    }
  }

  if (customer_id) {
    query += ' AND o.customer_id = ?';
    params.push(customer_id);
  }

  // Search by customer name or phone (case-insensitive)
  if (customer) {
    query += ' AND (c.name ILIKE ? OR c.phone ILIKE ?)';
    const customerSearch = `%${customer}%`;
    params.push(customerSearch, customerSearch);
  }

  if (date) {
    query += ' AND DATE(o.order_date) = ?';
    params.push(date);
  }

  // Date range filters
  if (date_from) {
    query += ' AND DATE(o.order_date) >= ?';
    params.push(date_from);
  }

  if (date_to) {
    query += ' AND DATE(o.order_date) <= ?';
    params.push(date_to);
  }

  // Amount range filters
  if (min_amount) {
    query += ' AND o.total_amount >= ?';
    params.push(parseFloat(min_amount));
  }

  if (max_amount) {
    query += ' AND o.total_amount <= ?';
    params.push(parseFloat(max_amount));
  }

  // Payment status filter
  if (payment_status) {
    query += ' AND o.payment_status = ?';
    params.push(payment_status);
  }

  // Filter for overdue orders (ready but past estimated collection date)
  if (overdue_only === 'true') {
    query += ` AND o.status = 'ready' AND o.estimated_collection_date IS NOT NULL AND o.estimated_collection_date < CURRENT_TIMESTAMP`;
  }

  query += ' ORDER BY o.order_date DESC';

  // Pagination (default 50 for fast first load, max 500)
  const limit = Math.min(parseInt(limitParam, 10) || 50, 500);
  const offset = offsetParam !== undefined ? parseInt(offsetParam, 10) : (page ? (Math.max(1, parseInt(page, 10)) - 1) * limit : 0);
  query += ' LIMIT ? OFFSET ?';
  params.push(limit, offset);

  try {
    const rows = await db.all(query, params);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching orders:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get collection queue (ready orders with queue info) - grouped by receipt number
router.get('/collection-queue', requireBranchAccess(), async (req, res) => {
  const { limit = 20, overdue_only } = req.query;
  const branchFilter = getBranchFilter(req, 'o');
  
  // First, get all ready orders
  let query = `
    SELECT o.*, s.name as service_name, c.name as customer_name, c.phone as customer_phone,
           b.name as branch_name,
           CASE 
             WHEN o.estimated_collection_date IS NOT NULL AND o.estimated_collection_date < CURRENT_TIMESTAMP THEN 1
             ELSE 0
           END as is_overdue,
           CASE 
             WHEN o.estimated_collection_date IS NOT NULL THEN 
               CAST(EXTRACT(EPOCH FROM (NOW() - o.estimated_collection_date)) / 3600 AS INTEGER)
             ELSE NULL
           END as hours_overdue
    FROM orders o
    JOIN services s ON o.service_id = s.id
    JOIN customers c ON o.customer_id = c.id
    LEFT JOIN branches b ON o.branch_id = b.id
    WHERE o.status = 'ready'
    ${branchFilter.clause}
  `;
  
  let params = [...branchFilter.params];
  
  if (overdue_only === 'true') {
    query += ` AND o.estimated_collection_date IS NOT NULL AND o.estimated_collection_date < CURRENT_TIMESTAMP`;
  }
  
  query += ` ORDER BY 
    is_overdue DESC,
    CASE WHEN o.estimated_collection_date IS NOT NULL THEN o.estimated_collection_date ELSE o.ready_date END ASC`;
  
  try {
    const allOrders = await db.all(query, params);
    
    // Group orders by receipt_number
    const receiptGroups = {};
    allOrders.forEach(order => {
      const receiptNum = order.receipt_number;
      if (!receiptGroups[receiptNum]) {
        receiptGroups[receiptNum] = [];
      }
      receiptGroups[receiptNum].push(order);
    });
    
    // Create grouped receipt entries with totals
    const groupedReceipts = Object.keys(receiptGroups).map(receiptNum => {
      const items = receiptGroups[receiptNum];
      const firstItem = items[0];
      
      // Calculate totals across all items
      const receiptTotal = items.reduce((sum, o) => sum + (parseFloat(o.total_amount) || 0), 0);
      const receiptPaid = items.reduce((sum, o) => sum + (parseFloat(o.paid_amount) || 0), 0);
      
      return {
        ...firstItem,
        receipt_number: receiptNum,
        total_amount: receiptTotal,
        paid_amount: receiptPaid,
        receipt_item_count: items.length,
        is_overdue: firstItem.is_overdue,
        hours_overdue: firstItem.hours_overdue,
        all_items: items // Include all items for reference
      };
    });
    
    // Sort grouped receipts and limit
    groupedReceipts.sort((a, b) => {
      if (a.is_overdue !== b.is_overdue) return b.is_overdue - a.is_overdue;
      const aDate = a.estimated_collection_date || a.ready_date;
      const bDate = b.estimated_collection_date || b.ready_date;
      return new Date(aDate) - new Date(bDate);
    });
    
    const limited = groupedReceipts.slice(0, parseInt(limit));
    res.json(limited);
  } catch (err) {
    console.error('Error fetching collection queue:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get order by receipt number - returns ALL items for the receipt with aggregated totals
// Case-insensitive receipt number search
router.get('/receipt/:receiptNumber', requireBranchAccess(), async (req, res) => {
  const { receiptNumber } = req.params;
  const branchFilter = getBranchFilter(req, 'o');
  
  try {
    // Get ALL orders for this receipt number (case-insensitive)
    // Join with items table to get item names
    const allOrders = await db.all(
      `SELECT o.*, s.name as service_name, s.description as service_description,
              c.name as customer_name, c.phone as customer_phone, c.email as customer_email,
              i.name as item_name, i.category as item_category,
              b.name as branch_name
       FROM orders o
       JOIN services s ON o.service_id = s.id
       JOIN customers c ON o.customer_id = c.id
       LEFT JOIN items i ON o.item_id = i.id
       LEFT JOIN branches b ON o.branch_id = b.id
       WHERE UPPER(o.receipt_number) = UPPER(?)
       ${branchFilter.clause}
       ORDER BY o.id`,
      [receiptNumber, ...branchFilter.params]
    );
    
    if (!allOrders || allOrders.length === 0) {
      return res.status(404).json({ error: 'Receipt not found' });
    }
    
    // Calculate receipt totals
    const receiptTotal = allOrders.reduce((sum, o) => sum + (parseFloat(o.total_amount) || 0), 0);
    const receiptPaid = allOrders.reduce((sum, o) => sum + (parseFloat(o.paid_amount) || 0), 0);
    
    // Return first order with receipt totals and all items
    const mainOrder = {
      ...allOrders[0],
      total_amount: receiptTotal,
      paid_amount: receiptPaid,
      receipt_item_count: allOrders.length,
      all_items: allOrders
    };
    
    res.json(mainOrder);
  } catch (err) {
    console.error('Error fetching order by receipt:', err);
    res.status(500).json({ error: err.message });
  }
});

// Send receipt SMS after order created and receipt printed (customer name, ID, items, amount, status)
router.post('/receipt/:receiptNumber/send-receipt-sms', requireBranchAccess(), async (req, res) => {
  const { receiptNumber } = req.params;
  const branchFilter = getBranchFilter(req, 'o');

  try {
    const allOrders = await db.all(
      `SELECT o.*, s.name as service_name,
              c.id as customer_id, c.name as customer_name, c.phone as customer_phone,
              c.sms_notifications_enabled
       FROM orders o
       JOIN services s ON o.service_id = s.id
       JOIN customers c ON o.customer_id = c.id
       WHERE UPPER(o.receipt_number) = UPPER(?)
       ${branchFilter.clause}
       ORDER BY o.id`,
      [receiptNumber, ...branchFilter.params]
    );

    if (!allOrders || allOrders.length === 0) {
      return res.status(404).json({ error: 'Receipt not found' });
    }

    const first = allOrders[0];
    const customerId = first.customer_id;
    const customerName = first.customer_name;
    const customerPhone = first.customer_phone;
    const smsEnabled = first.sms_notifications_enabled !== 0;

    if (!customerPhone) {
      return res.status(400).json({ error: 'Customer has no phone number for SMS' });
    }
    if (!smsEnabled) {
      return res.status(400).json({ error: 'SMS notifications are disabled for this customer' });
    }

    const receiptTotal = allOrders.reduce((sum, o) => sum + (parseFloat(o.total_amount) || 0), 0);
    const paymentStatus = first.payment_status || 'not_paid';

    const itemParts = allOrders.map((o) => {
      const qty = o.quantity || 1;
      const svc = o.service_name || 'Item';
      const extra = [o.color, o.garment_type].filter(Boolean).join(' ');
      return extra ? `${qty}x ${svc} (${extra})` : `${qty}x ${svc}`;
    });
    const itemsDescription = itemParts.join('; ');

    const message = generateOrderReceiptSms(
      customerName,
      customerId,
      itemsDescription,
      receiptTotal,
      paymentStatus
    );

    const result = await sendSmsWithWhatsAppFallback(customerPhone, message, {
      customerId,
      orderId: first.id,
      notificationType: 'receipt_sms'
    });

    if (!result.success) {
      return res.status(500).json({ error: result.error || 'Failed to send', sent: false });
    }
    res.json({ success: true, sent: true, channel: result.channel || 'sms', preview: message });
  } catch (err) {
    console.error('Error sending receipt SMS:', err);
    res.status(500).json({ error: err.message });
  }
});

// Search orders by customer phone or name
router.get('/search/customer', requireBranchAccess(), async (req, res) => {
  const { phone, name, status } = req.query;
  
  if (!phone && !name) {
    return res.status(400).json({ error: 'Phone number or customer name is required' });
  }

  const branchFilter = getBranchFilter(req, 'o');

  let query = `
    SELECT o.*, s.name as service_name, s.description as service_description,
           c.name as customer_name, c.phone as customer_phone, c.email as customer_email,
           b.name as branch_name
    FROM orders o
    JOIN services s ON o.service_id = s.id
    JOIN customers c ON o.customer_id = c.id
    LEFT JOIN branches b ON o.branch_id = b.id
    WHERE 1=1
    ${branchFilter.clause}
  `;
  let params = [...branchFilter.params];

  if (phone) {
    query += ' AND c.phone ILIKE ?';
    params.push(`%${phone}%`);
  }

  if (name) {
    query += ' AND c.name ILIKE ?';
    params.push(`%${name}%`);
  }

  if (status) {
    query += ' AND o.status = ?';
    params.push(status);
  }

  query += ' ORDER BY o.order_date DESC LIMIT 20';

  try {
    const rows = await db.all(query, params);
    res.json(rows);
  } catch (err) {
    console.error('Error searching orders by customer:', err);
    res.status(500).json({ error: err.message });
  }
});

// Generate receipt number endpoint (for batch orders)
router.get('/generate-receipt-number', (req, res) => {
  generateReceiptNumber((err, receipt_number) => {
    if (err) {
      return res.status(500).json({ error: 'Error generating receipt number' });
    }
    res.json({ receipt_number });
  });
});

// Generate QR code for receipt
router.get('/receipt/:receiptNumber/qrcode', async (req, res) => {
  const { receiptNumber } = req.params;
  
  try {
    const order = await db.get(
      `SELECT o.*, s.name as service_name, s.description as service_description,
              c.name as customer_name, c.phone as customer_phone, c.email as customer_email
       FROM orders o
       JOIN services s ON o.service_id = s.id
       JOIN customers c ON o.customer_id = c.id
       WHERE o.receipt_number = ?
       LIMIT 1`,
      [receiptNumber]
    );
    
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    const customer = {
      name: order.customer_name,
      phone: order.customer_phone,
      email: order.customer_email,
      id: order.customer_id
    };
    
    const service = {
      name: order.service_name,
      description: order.service_description,
      id: order.service_id
    };
    
    const qrCodeDataURL = await generateReceiptQRCode(order, customer, service);
    
    if (qrCodeDataURL) {
      res.json({ qrCode: qrCodeDataURL });
    } else {
      res.status(500).json({ error: 'Failed to generate QR code' });
    }
  } catch (error) {
    console.error('Error generating QR code:', error);
    res.status(500).json({ error: 'Failed to generate QR code: ' + error.message });
  }
});

// Helper function to generate receipt number (uses async version directly)
async function generateReceiptNumberPromise() {
  const { generateReceiptNumberAsync } = require('../utils/receipt');
  return generateReceiptNumberAsync();
}

// Create new order (cashiers, managers, and admins can create)
router.post('/', requireBranchAccess(), requirePermission('canCreateOrders'), async (req, res) => {
  try {
    console.log('POST /api/orders - Request received');
    console.log('User:', req.user?.username, 'Role:', req.user?.role, 'BranchId:', req.user?.branchId);
    
    const {
      customer_id,
      service_id,
      quantity,
      weight_kg,
      color,
      special_instructions,
      delivery_type,
      express_surcharge_multiplier,
      total_amount, // Optional: if provided, use this total (for items with custom pricing)
      paid_amount,
      payment_status,
      payment_method,
      created_by,
      receipt_number, // Optional: if provided, use this receipt number (for batch orders)
      estimated_collection_date, // Estimated collection date/time
      branch_id // Optional: for admins to specify which branch to create the order for
    } = req.body;

    console.log('Order data:', { customer_id, service_id, quantity, payment_status, branch_id });

    if (!customer_id || !service_id) {
      return res.status(400).json({ error: 'Customer ID and Service ID are required' });
    }

    // Get service details and settings to calculate total
    console.log('Fetching service with id:', service_id);
    const service = await db.get('SELECT * FROM services WHERE id = ?', [service_id]);
    
    if (!service) {
      console.error('Service not found with id:', service_id);
      return res.status(404).json({ error: 'Service not found' });
    }
    console.log('Service found:', service.name);

    // Get express multipliers from settings if not provided
    let expressMultiplier = express_surcharge_multiplier || 0;
    if (delivery_type && !expressMultiplier) {
      try {
        const settings = await db.all('SELECT setting_key, setting_value FROM settings WHERE setting_key IN (?, ?)', 
          ['express_same_day_multiplier', 'express_next_day_multiplier']);
        
        if (settings && settings.length > 0) {
          if (delivery_type === 'same_day') {
            const setting = settings.find(s => s.setting_key === 'express_same_day_multiplier');
            expressMultiplier = setting ? parseFloat(setting.setting_value) : 2;
          } else if (delivery_type === 'next_day') {
            const setting = settings.find(s => s.setting_key === 'express_next_day_multiplier');
            expressMultiplier = setting ? parseFloat(setting.setting_value) : 3;
          }
        }
      } catch (settingsErr) {
        console.error('Error fetching express multipliers:', settingsErr);
        // Use defaults if settings fetch fails
      }
    }

    // Helper function to create order (with retry logic)
    const createOrder = async (receiptNumberToUse = null, retryCount = 0) => {
      // Use provided total_amount if available (for items with custom pricing), otherwise calculate it
      let final_total_amount = total_amount;
      if (final_total_amount === undefined || final_total_amount === null) {
        // Calculate total with express surcharge using service pricing
        final_total_amount = calculateTotal(service, quantity || 1, weight_kg || 0, delivery_type || 'standard', expressMultiplier);
      } else {
        // Ensure it's a number
        final_total_amount = parseFloat(final_total_amount) || 0;
      }
      
      // Validate payment data
      const paymentData = {
        paid_amount: paid_amount !== undefined ? paid_amount : (payment_status === 'paid_full' ? final_total_amount : 0),
        payment_status: payment_status || 'not_paid',
        payment_method: payment_method || 'cash'
      };
      
      const validation = validatePayment(paymentData, final_total_amount);
      if (!validation.valid) {
        return res.status(400).json({ error: validation.error });
      }
      
      const insertOrder = async (receiptNumberToInsert) => {
        const finalReceiptNumber = receiptNumberToInsert || receipt_number;
        const final_paid_amount = paymentData.paid_amount;
        
        // Insert order
        // For admins: use branch_id from request body if provided, otherwise use user's branchId
        // For regular users: use their branchId (requireBranchAccess ensures they have one)
        const branchId = req.user.role === 'admin' 
          ? (branch_id || req.user?.branchId || null)
          : (req.user?.branchId || null);
        
        console.log('Creating order with branchId:', branchId, 'for user:', req.user.username, 'role:', req.user.role);
        
        try {
          const result = await db.run(
            `INSERT INTO orders (receipt_number, customer_id, service_id, quantity, 
              weight_kg, color, garment_type, special_instructions, delivery_type, express_surcharge_multiplier, total_amount, paid_amount, payment_status, payment_method, created_by, estimated_collection_date, branch_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
            [finalReceiptNumber, customer_id, service_id,
              quantity || 1, weight_kg || null, color || null, req.body.garment_type || null, special_instructions || null,
              delivery_type || 'standard', expressMultiplier,
              final_total_amount, final_paid_amount, payment_status || 'not_paid', payment_method || 'cash', created_by || null, estimated_collection_date || null, branchId]
          );
          const orderId = result.lastID;

          const orderObj = {
            id: orderId,
            receipt_number: finalReceiptNumber,
            branch_id: branchId
          };

          // Create transaction record if payment was made
          if (final_paid_amount > 0 && (payment_status === 'paid_full' || payment_status === 'advance')) {
            recordPaymentTransaction(orderObj, final_paid_amount, payment_method || 'cash', created_by || 'System')
              .then((transactionId) => {
                console.log(`✅ Payment transaction recorded: Transaction ID ${transactionId} for Order ${orderId}`);
              })
              .catch((err) => {
                console.error('Error recording payment transaction:', err);
                // Don't fail the order creation if transaction recording fails
              });
          }

          // Log payment creation to audit log
          logPaymentChange({
            order_id: orderId,
            action: 'created',
            new_payment_status: payment_status || 'not_paid',
            new_paid_amount: final_paid_amount,
            new_payment_method: payment_method || 'cash',
            changed_by: created_by || 'System',
            notes: 'Order created'
          }).catch((err) => {
            console.error('Error logging payment change:', err);
          });

          // Get customer details for receipt
          const customer = await db.get('SELECT * FROM customers WHERE id = ?', [customer_id]);
          let branchName = null;
          if (branchId) {
            const branchRow = await db.get('SELECT name FROM branches WHERE id = ?', [branchId]).catch(() => null);
            branchName = branchRow?.name || null;
          }
          const order = {
            id: orderId,
            receipt_number: finalReceiptNumber,
            branch_id: branchId,
            branch_name: branchName,
            customer_id,
            service_id,
            quantity: quantity || 1,
            weight_kg,
            color: color || null,
            garment_type: req.body.garment_type || null,
            special_instructions,
            delivery_type: delivery_type || 'standard',
            express_surcharge_multiplier: expressMultiplier,
            total_amount: final_total_amount,
            paid_amount: final_paid_amount,
            payment_status: payment_status || 'not_paid',
            payment_method: payment_method || 'cash',
            status: 'pending',
            order_date: new Date().toISOString(),
            estimated_collection_date: estimated_collection_date || null
          };

          const receipt = formatReceipt(order, customer, service);

          // Send SMS when order is recorded and receipt is printed (default on; set SEND_ORDER_CONFIRMATION_SMS=false to disable)
          const sendConfirmationSms = process.env.SEND_ORDER_CONFIRMATION_SMS !== 'false';
          if (sendConfirmationSms && customer.phone) {
            const smsEnabled = customer.sms_notifications_enabled !== 0;
            if (smsEnabled) {
              const { generateOrderConfirmation } = require('../utils/sms');
              const confirmationMessage = generateOrderConfirmation(
                finalReceiptNumber,
                customer.name,
                total_amount,
                estimated_collection_date
              );
              sendSmsWithWhatsAppFallback(customer.phone, confirmationMessage, {
                customerId: customer.id,
                orderId: orderId,
                notificationType: 'order_confirmation'
              }).then(result => {
                if (result.success) {
                  console.log(`✅ Order confirmation SMS sent via ${result.channel || 'sms'} to ${customer.phone}`);
                }
              }).catch(err => {
                console.error('Error sending order confirmation SMS:', err);
              });
            }
          }

          res.json({
            order,
            receipt,
            customer,
            service
          });
        } catch (insertErr) {
          // Log the full error for debugging
          console.error('Order insertion error:', {
            error: insertErr.message,
            code: insertErr.code,
            receiptNumber: finalReceiptNumber,
            retryCount: retryCount
          });
          
          // Handle UNIQUE constraint error (duplicate receipt number) by retrying
          // NOTE: We removed UNIQUE constraint from receipt_number to allow multiple items per receipt
          // But if it still exists (old database), we'll handle it here
          const errorMsg = insertErr.message || '';
          const errorCode = insertErr.code || '';
          const isUniqueError = (errorMsg.includes('UNIQUE constraint failed') || 
                                errorMsg.includes('SQLITE_CONSTRAINT') ||
                                errorMsg.includes('UNIQUE constraint') ||
                                errorCode === 'SQLITE_CONSTRAINT_UNIQUE' ||
                                errorCode === 'SQLITE_CONSTRAINT') && 
                               (errorMsg.includes('receipt_number') || errorMsg.includes('receipt') || errorMsg.includes('orders'));
          
          if (isUniqueError && retryCount < 5) {
            console.log(`Duplicate receipt number detected: ${finalReceiptNumber}. Retrying (attempt ${retryCount + 1}/5)...`);
            // Retry with a new receipt number
            try {
              const newReceiptNumber = await generateReceiptNumberPromise();
              console.log(`Generated new receipt number for retry: ${newReceiptNumber}`);
              return createOrder(newReceiptNumber, retryCount + 1);
            } catch (receiptErr) {
              console.error('Error generating receipt number after retry:', receiptErr);
              return res.status(500).json({ error: 'Error generating receipt number after retry: ' + receiptErr.message });
            }
          }
          
          // If we've exhausted retries or it's a non-unique error
          if (isUniqueError && retryCount >= 5) {
            console.error(`Failed after ${retryCount} retries. Receipt number: ${finalReceiptNumber}`);
            return res.status(500).json({ 
              error: 'Duplicate receipt number detected. Please contact administrator.',
              details: `Receipt: ${finalReceiptNumber}, Retries: ${retryCount}. Error: ${errorMsg}`
            });
          }
          
          // Return the actual error for non-unique errors
          return res.status(500).json({ 
            error: insertErr.message,
            code: errorCode
          });
        }
      };

      // If receipt number was provided in request (for batch orders), use it directly
      if (receipt_number) {
        await insertOrder(receipt_number);
      }
      // If receipt number was provided as parameter (for retry), use it
      else if (receiptNumberToUse) {
        await insertOrder(receiptNumberToUse);
      } else {
        // Generate receipt number (format: {sequence}-{DD}-{MM} ({YY}))
        try {
          const generatedReceiptNumber = await generateReceiptNumberPromise();
          await insertOrder(generatedReceiptNumber);
        } catch (receiptErr) {
          return res.status(500).json({ error: 'Error generating receipt number: ' + receiptErr.message });
        }
      }
    };

    // Call createOrder to start the process
    await createOrder();
  } catch (error) {
    console.error('Error in order creation route:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Update order status (managers, processors, and admins can update)
router.put('/:id/status', requireBranchAccess(), requirePermission('canManageOrders'), async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  const validStatuses = ['pending', 'processing', 'ready', 'collected'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  try {
    // Verify user has access: match by branch, or allow orders with null branch_id (legacy) and assign to current branch
    const branchFilter = getBranchFilter(req, 'o');
    let order = await db.get(
      `SELECT o.id, o.total_amount, o.paid_amount, o.branch_id FROM orders o WHERE o.id = ? ${branchFilter.clause}`,
      [id, ...branchFilter.params]
    );
    if (!order && (branchFilter.clause || branchFilter.params?.length)) {
      order = await db.get('SELECT id, total_amount, paid_amount, branch_id FROM orders WHERE id = ?', [id]);
      if (order && order.branch_id != null) {
        return res.status(403).json({ error: 'Order belongs to another branch. You can only update orders for your branch.' });
      }
    }
    if (!order) {
      return res.status(404).json({ error: 'Order not found or access denied' });
    }

    // Cannot mark as collected without payment
    if (status === 'collected') {
      const total = roundMoney(parseFloat(order.total_amount) || 0);
      const paid = roundMoney(parseFloat(order.paid_amount) || 0);
      const balanceDue = roundMoney(total - paid);
      if (balanceDue > 0) {
        return res.status(400).json({
          error: 'Cannot mark as collected without payment. Receive payment first (Pay button) or use the Collection page to collect with payment.'
        });
      }
    }

    // User has access, proceed with update
    const branchId = req.user?.branchId;
    let updateQuery = 'UPDATE orders SET status = ?';
    const params = [status];
    // If order had no branch (legacy), assign it to current user's branch
    if (order.branch_id == null && branchId != null) {
      updateQuery += ', branch_id = ?';
      params.push(branchId);
    }
    if (status === 'ready') {
      updateQuery += ', ready_date = CURRENT_TIMESTAMP';
      if (branchId) {
        updateQuery += ', ready_at_branch_id = ?';
        params.push(branchId);
      }
    }
    if (status === 'collected') {
      updateQuery += ', collected_date = CURRENT_TIMESTAMP';
      if (branchId) {
        updateQuery += ', collected_at_branch_id = ?';
        params.push(branchId);
      }
    }
    updateQuery += ' WHERE id = ?';
    params.push(id);
    
    const result = await db.run(updateQuery, params);
    
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    // Send SMS notification when order becomes ready
    if (status === 'ready') {
      try {
        const orderWithCustomer = await db.get(
          `SELECT o.*, c.name as customer_name, c.phone as customer_phone, 
                  c.sms_notifications_enabled
           FROM orders o
           JOIN customers c ON o.customer_id = c.id
           WHERE o.id = ?`,
          [id]
        );
        
        if (orderWithCustomer) {
          // Check if customer has SMS notifications enabled (default to true if null)
          const smsEnabled = orderWithCustomer.sms_notifications_enabled !== 0;
          
          if (smsEnabled && orderWithCustomer.customer_phone) {
            const message = generateReadyNotification(
              orderWithCustomer.receipt_number, 
              orderWithCustomer.customer_name,
              orderWithCustomer.estimated_collection_date
            );
            
            // Try SMS first; if SMS fails, send via WhatsApp (don't block the response)
            sendSmsWithWhatsAppFallback(orderWithCustomer.customer_phone, message, {
              customerId: orderWithCustomer.customer_id,
              orderId: orderWithCustomer.id,
              notificationType: 'ready'
            }).then(result => {
              if (result.success) {
                console.log(`✅ Ready notification sent via ${result.channel || 'sms'} to ${orderWithCustomer.customer_phone} for order ${orderWithCustomer.receipt_number}`);
              } else {
                console.error(`❌ Failed to send to ${orderWithCustomer.customer_phone}:`, result.error);
              }
            }).catch(err => {
              console.error(`❌ Error sending ready notification:`, err);
            });
          } else if (!smsEnabled) {
            console.log(`📱 SMS notifications disabled for customer ${orderWithCustomer.customer_name}`);
          }
        }
      } catch (smsErr) {
        console.error('Error fetching order for SMS:', smsErr);
        // Don't fail the status update if SMS fetch fails
      }
    }
    
    res.json({ message: 'Order status updated successfully' });
  } catch (err) {
    console.error('Error updating order status:', err);
    res.status(500).json({ error: err.message });
  }
});

// Update estimated collection date (managers, processors, and admins can update)
router.put('/:id/estimated-collection-date', requireBranchAccess(), requirePermission('canManageOrders'), async (req, res) => {
  const { id } = req.params;
  const { estimated_collection_date } = req.body;

  if (!estimated_collection_date) {
    return res.status(400).json({ error: 'Estimated collection date is required' });
  }

  try {
    // Verify user has access to this order
    const branchFilter = getBranchFilter(req, 'o');
    const order = await db.get(
      `SELECT id FROM orders WHERE id = ? ${branchFilter.clause}`,
      [id, ...branchFilter.params]
    );
    
    if (!order) {
      return res.status(404).json({ error: 'Order not found or access denied' });
    }

    const result = await db.run(
        'UPDATE orders SET estimated_collection_date = ? WHERE id = ?',
        [estimated_collection_date, id]
      );
      
      if (result.changes === 0) {
        return res.status(404).json({ error: 'Order not found' });
      }
      
      res.json({ message: 'Estimated collection date updated successfully' });
  } catch (err) {
    console.error('Error updating estimated collection date:', err);
    res.status(500).json({ error: err.message });
  }
});

// Collect order (by receipt number) with optional payment (managers, processors, and admins can collect)
// This endpoint handles ALL items on a receipt together - collects the entire receipt, not individual items
router.post('/collect/:receiptNumber', requireBranchFeature('collection'), requireBranchAccess(), requirePermission('canManageOrders'), async (req, res) => {
  const { receiptNumber } = req.params;
  const { payment_amount, payment_method = 'cash', notes } = req.body;
  
  try {
    // Get ALL orders for this receipt number (not just one) - case-insensitive
    // Join with items table to get item names
    const branchFilter = getBranchFilter(req, 'o');
    const allOrders = await db.all(
      `SELECT o.*, c.name as customer_name, c.phone as customer_phone,
              s.name as service_name, i.name as item_name, i.category as item_category
       FROM orders o
       JOIN customers c ON o.customer_id = c.id
       LEFT JOIN services s ON o.service_id = s.id
       LEFT JOIN items i ON o.item_id = i.id
       WHERE UPPER(o.receipt_number) = UPPER(?)
       ${branchFilter.clause}
       ORDER BY o.id`,
      [receiptNumber, ...branchFilter.params]
    );
    
    if (!allOrders || allOrders.length === 0) {
      return res.status(404).json({ error: 'Receipt not found' });
    }

    // Check if any order is already collected
    const alreadyCollected = allOrders.some(o => o.status === 'collected');
    if (alreadyCollected) {
      return res.status(400).json({ error: 'Receipt already collected' });
    }

    // Calculate totals across ALL items on the receipt (rounded to 2 decimals)
    const receiptTotal = roundMoney(allOrders.reduce((sum, o) => sum + (parseFloat(o.total_amount) || 0), 0));
    const receiptPaid = roundMoney(allOrders.reduce((sum, o) => sum + (parseFloat(o.paid_amount) || 0), 0));
    const balanceDue = roundMoney(receiptTotal - receiptPaid);
    
    // Use the first order for customer info (all orders have same customer)
    const firstOrder = allOrders[0];
    let finalPaidAmount = receiptPaid;
    let finalPaymentStatus = firstOrder.payment_status;

    // Function to update ALL orders after payment processing
    const updateAllOrders = async () => {
      // Update ALL orders with the same receipt number (case-insensitive)
      await db.run(
        `UPDATE orders 
         SET status = ?, collected_date = CURRENT_TIMESTAMP, 
             paid_amount = ?, payment_status = ?, payment_method = ?
         WHERE UPPER(receipt_number) = UPPER(?)
         ${branchFilter.clause}`,
        ['collected', finalPaidAmount, finalPaymentStatus, payment_method, receiptNumber, ...branchFilter.params]
      );
      
      // Award loyalty points on collection (only if fully paid) - use receipt total
      if (finalPaymentStatus === 'paid_full' && receiptTotal > 0) {
        try {
          const { awardPointsOnCollection } = require('./loyalty');
          const result = await awardPointsOnCollection(firstOrder.customer_id, firstOrder.id, receiptTotal);
          console.log(`✅ Loyalty points awarded: ${result?.points_earned ?? 0} points to customer ${firstOrder.customer_id}`);
        } catch (err) {
          console.error('Error awarding loyalty points:', err);
        }
      }
      
      // Get all updated orders for response (case-insensitive)
      // Join with items table to get item names
      const updatedOrders = await db.all(
        `SELECT o.*, s.name as service_name, c.name as customer_name, c.phone as customer_phone,
                i.name as item_name, i.category as item_category
         FROM orders o
         JOIN services s ON o.service_id = s.id
         JOIN customers c ON o.customer_id = c.id
         LEFT JOIN items i ON o.item_id = i.id
         WHERE UPPER(o.receipt_number) = UPPER(?)
         ${branchFilter.clause}
         ORDER BY o.id`,
        [receiptNumber, ...branchFilter.params]
      );
      
      // Calculate final totals for response
      const finalReceiptTotal = updatedOrders.reduce((sum, o) => sum + (parseFloat(o.total_amount) || 0), 0);
      const finalReceiptPaid = updatedOrders.reduce((sum, o) => sum + (parseFloat(o.paid_amount) || 0), 0);
      
      // Return the first order as main order, but with receipt totals
      const mainOrder = {
        ...updatedOrders[0],
        total_amount: finalReceiptTotal,
        paid_amount: finalReceiptPaid,
        receipt_item_count: updatedOrders.length
      };
      
      res.json({ 
        message: `Receipt collected successfully (${updatedOrders.length} ${updatedOrders.length === 1 ? 'item' : 'items'})`, 
        order: mainOrder,
        all_orders: updatedOrders,
        payment_collected: payment_amount || 0,
        balance_remaining: finalReceiptTotal - finalReceiptPaid,
        receipt_total: finalReceiptTotal,
        receipt_paid: finalReceiptPaid
      });
    };

    // Handle payment if provided (collect balance due, not full receipt total)
    if (payment_amount !== undefined && payment_amount > 0) {
      const paymentAmount = roundMoney(parseFloat(payment_amount));
      
      try {
        const tol = 0.01;
        if (paymentAmount <= 0) {
          return res.status(400).json({
            error: 'Payment amount must be greater than 0.'
          });
        }
        if (paymentAmount > balanceDue + tol) {
          return res.status(400).json({
            error: `Payment cannot exceed the balance due of TSh ${balanceDue.toLocaleString()}.`
          });
        }
        
        // Check for duplicate payment using first order ID
        const timestamp = new Date().toISOString();
        const isDuplicate = await checkDuplicatePayment(firstOrder.id, paymentAmount, timestamp);
        
        if (isDuplicate) {
          return res.status(400).json({ error: 'Duplicate payment detected. This payment was already recorded.' });
        }
        
        // Add payment to existing paid amount (collect balance due, not receipt total)
        finalPaidAmount = roundMoney(receiptPaid + paymentAmount);
        finalPaymentStatus = (finalPaidAmount >= receiptTotal - tol) ? 'paid_full' : 'advance';

        // Record payment transaction using utility function
        const orderObj = {
          id: firstOrder.id,
          receipt_number: receiptNumber,
          branch_id: firstOrder.branch_id || null
        };
        
        const transactionId = await recordPaymentTransaction(orderObj, paymentAmount, payment_method, 'Cashier');
        console.log(`✅ Payment transaction recorded: Transaction ID ${transactionId} for Receipt ${receiptNumber}`);
        
        // Log payment change to audit log (for first order, but represents entire receipt)
        logPaymentChange({
          order_id: firstOrder.id,
          action: 'collected',
          old_payment_status: firstOrder.payment_status,
          new_payment_status: finalPaymentStatus,
          old_paid_amount: receiptPaid,
          new_paid_amount: finalPaidAmount,
          old_payment_method: firstOrder.payment_method,
          new_payment_method: payment_method,
          changed_by: 'Cashier',
          notes: notes || `Payment at collection for receipt ${receiptNumber} (${allOrders.length} items)`
        }).catch((err) => {
          console.error('Error logging payment change:', err);
        });
        
        // Continue with order update
        await updateAllOrders();
      } catch (err) {
        console.error('Error processing payment:', err);
        return res.status(500).json({ error: 'Error processing payment: ' + err.message });
      }
    } else {
      // No payment provided — only allow when already fully paid
      if (balanceDue > 0) {
        return res.status(400).json({
          error: 'Cannot collect without payment. Record the balance due in the payment modal, or receive payment first (Orders or Collection page).'
        });
      }
      await updateAllOrders();
    }
  } catch (err) {
    console.error('Error collecting order:', err);
    res.status(500).json({ error: err.message });
  }
});

// Receive payment for an order (without collecting) - uses RECEIPT-level totals for multi-item receipts
router.post('/:id/receive-payment', requireBranchAccess(), requirePermission('canManageCash'), async (req, res) => {
  const { id } = req.params;
  const { payment_amount, payment_method = 'cash', notes } = req.body;

  if (!payment_amount || payment_amount <= 0) {
    return res.status(400).json({ error: 'Payment amount must be greater than 0' });
  }

  const branchFilter = getBranchFilter(req, 'o');

  try {
    const order = await db.get(
      `SELECT o.*, c.name as customer_name, c.phone as customer_phone
       FROM orders o
       JOIN customers c ON o.customer_id = c.id
       WHERE o.id = ? ${branchFilter.clause}`,
      [id, ...branchFilter.params]
    );
    
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Load ALL orders for this receipt so we validate and apply at receipt level (single receipt = all items)
    const allOrders = await db.all(
      `SELECT o.* FROM orders o WHERE o.receipt_number = ? ${branchFilter.clause} ORDER BY o.id`,
      [order.receipt_number, ...branchFilter.params]
    );

    const receiptTotal = roundMoney(allOrders.reduce((sum, o) => sum + (parseFloat(o.total_amount) || 0), 0));
    const receiptPaid = roundMoney(allOrders.reduce((sum, o) => sum + (parseFloat(o.paid_amount) || 0), 0));
    const balanceDue = roundMoney(receiptTotal - receiptPaid);
    const paymentAmount = roundMoney(parseFloat(payment_amount));
    
    const tol = 0.01;
    if (balanceDue <= 0) {
      return res.status(400).json({ error: 'Receipt is already fully paid.' });
    }
    if (paymentAmount < balanceDue - tol) {
      return res.status(400).json({
        error: `Payment must equal the balance due of TSh ${balanceDue.toLocaleString()}. Partial payments are not allowed.`
      });
    }
    if (paymentAmount > balanceDue + tol) {
      return res.status(400).json({
        error: `Payment cannot exceed the balance due of TSh ${balanceDue.toLocaleString()}.`
      });
    }

    // Check for duplicate payment (use first order id)
    const timestamp = new Date().toISOString();
    const isDuplicate = await checkDuplicatePayment(allOrders[0].id, paymentAmount, timestamp);
    
    if (isDuplicate) {
      return res.status(400).json({ error: 'Duplicate payment detected. This payment was already recorded.' });
    }
    
    // Record one transaction for the full receipt payment
    const orderObj = {
      id: allOrders[0].id,
      receipt_number: order.receipt_number,
      branch_id: order.branch_id || null
    };
    const transactionId = await recordPaymentTransaction(orderObj, paymentAmount, payment_method, 'Cashier');
    console.log(`✅ Payment transaction recorded: Transaction ID ${transactionId} for Receipt ${order.receipt_number} (${allOrders.length} items)`);
    
    // Apply full payment across ALL orders on the receipt (each line gets its total as paid)
    for (const o of allOrders) {
      const oTotal = roundMoney(parseFloat(o.total_amount) || 0);
      await db.run(
        `UPDATE orders SET paid_amount = ?, payment_status = ?, payment_method = ? WHERE id = ?`,
        [oTotal, 'paid_full', payment_method, o.id]
      );
      logPaymentChange({
        order_id: o.id,
        action: 'payment_received',
        old_payment_status: o.payment_status,
        new_payment_status: 'paid_full',
        old_paid_amount: parseFloat(o.paid_amount) || 0,
        new_paid_amount: oTotal,
        old_payment_method: o.payment_method,
        new_payment_method: payment_method,
        changed_by: 'Cashier',
        notes: notes || `Payment for receipt ${order.receipt_number} (${allOrders.length} items)`
      }).catch((err) => console.error('Error logging payment change:', err));
    }
    
    const newReceiptPaid = roundMoney(receiptPaid + paymentAmount);
    
    res.json({ 
      message: 'Payment received successfully', 
      order: { ...order, total_amount: receiptTotal, paid_amount: newReceiptPaid, receipt_item_count: allOrders.length },
      payment_received: paymentAmount,
      total_paid: newReceiptPaid,
      balance_remaining: 0,
      receipt_total: receiptTotal,
      receipt_item_count: allOrders.length
    });
  } catch (err) {
    console.error('Error receiving payment:', err);
    res.status(500).json({ error: err.message });
  }
});

// Upload Excel file and import stock/orders
router.post('/upload-stock-excel', requireBranchAccess(), requirePermission('canManageOrders'), upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const filePath = req.file.path;
  let data = [];

  try {
    // Read Excel file using ExcelJS (more secure than xlsx)
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    const worksheet = workbook.worksheets[0];
    
    // Convert worksheet to JSON array
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // Skip header row
      const rowData = {};
      row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
        const header = worksheet.getRow(1).getCell(colNumber).value;
        if (header) {
          rowData[header] = cell.value;
        }
      });
      if (Object.keys(rowData).length > 0) {
        data.push(rowData);
      }
    });

    if (data.length === 0) {
      fs.unlinkSync(filePath);
      return res.status(400).json({ error: 'Excel file is empty' });
    }
  } catch (error) {
    // Clean up uploaded file on error
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (unlinkErr) {
      console.error('Error deleting file:', unlinkErr);
    }
    return res.status(500).json({ error: 'Error processing Excel file: ' + error.message });
  }

  let imported = 0;
  let skipped = 0;
  const errors = [];
  let processed = 0;

  // Define sendResponse function before db.get so it's accessible from nested callbacks
  function sendResponse() {
    // Clean up uploaded file
    try {
      fs.unlinkSync(filePath);
    } catch (unlinkErr) {
      console.error('Error deleting file:', unlinkErr);
    }

    res.json({
      imported,
      skipped,
      total: data.length,
      errors: errors.slice(0, 20) // Limit errors to first 20
    });
  }

  // Get default service (first active service) as fallback
  try {
    const defaultService = await db.get('SELECT id FROM services WHERE is_active = TRUE LIMIT 1', []);
    const defaultServiceId = defaultService ? defaultService.id : null;

    const branchId = getEffectiveBranchId(req);
    if (branchId == null) {
      fs.unlinkSync(filePath);
      return res.status(400).json({ error: 'Select a branch to upload stock' });
    }

    // Process each row sequentially. Key columns (any casing): id, name, phone, amount, paid/not paid.
    // All uploaded stock is created as uncollected (status 'ready').
    for (let index = 0; index < data.length; index++) {
      const row = data[index];
      const getVal = (...names) => {
        for (const n of names) {
          const v = row[n];
          if (v !== undefined && v !== null && String(v).trim() !== '') return v;
        }
        return null;
      };

      // Primary format: id, name, phone, amount, paid (or payment_status)
      const receiptId = String(getVal('id', 'Id', 'ID', 'Receipt ID', 'Receipt', 'Receipt Number', 'receipt_id') || '').trim();
      const customerName = String(getVal('name', 'Name', 'NAME', 'Customer Name', 'Customer name', 'Customer') || '').trim();
      const phone = String(getVal('phone', 'Phone', 'PHONE', 'Phone Number', 'Mobile') || '').trim();
      const amount = parseFloat(getVal('amount', 'Amount', 'AMOUNT', 'Total Amount', 'Total', 'total amount') || 0);
      const paidRaw = getVal('paid', 'Paid', 'PAID', 'payment_status', 'Payment Status', 'Payment');
      const paidAmountCol = parseFloat(getVal('paid_amount', 'Paid Amount', 'Paid amount') || NaN);
      const unpaidBalance = parseFloat(getVal('unpaid_balance', 'Unpaid Balance', 'Balance', 'balance') || NaN);

      const serviceName = String(getVal('Service', 'service', 'Service Name') || '').trim();
      const quantity = parseInt(getVal('Quantity', 'quantity', 'Qty', 'qty') || 1);

      if (!receiptId || !customerName) {
        errors.push(`Row ${index + 2}: Missing id (or receipt) and/or name`);
        skipped++;
        processed++;
        if (processed === data.length) { sendResponse(); }
        continue;
      }

      const finalTotalAmount = amount > 0 ? amount : 0;
      let paidAmount = 0;
      let paymentStatus = 'not_paid';
      if (!Number.isNaN(paidAmountCol) && paidAmountCol >= 0) {
        paidAmount = paidAmountCol;
        paymentStatus = paidAmount >= finalTotalAmount ? 'paid_full' : (paidAmount > 0 ? 'advance' : 'not_paid');
      } else if (!Number.isNaN(unpaidBalance) && unpaidBalance >= 0) {
        paidAmount = Math.max(0, finalTotalAmount - unpaidBalance);
        paymentStatus = paidAmount >= finalTotalAmount ? 'paid_full' : (paidAmount > 0 ? 'advance' : 'not_paid');
      } else if (paidRaw != null) {
        const paidStr = String(paidRaw).toLowerCase().trim();
        const isPaid = /^(paid|yes|1|true|full)$/.test(paidStr) || paidStr === 'y';
        paidAmount = isPaid ? finalTotalAmount : 0;
        paymentStatus = isPaid ? 'paid_full' : 'not_paid';
      }

      // Find or create customer
      try {
        let customer = await db.get('SELECT id FROM customers WHERE LOWER(name) = LOWER(?)', [customerName]);
        let customerId = customer ? customer.id : null;

        // If customer not found and phone is provided, create customer
        if (!customerId && phone) {
          try {
            const result = await db.run(
              'INSERT INTO customers (name, phone) VALUES (?, ?) RETURNING id',
              [customerName, phone]
            );
            customerId = result.lastID;
          } catch (insertErr) {
            errors.push(`Row ${index + 2}: Error creating customer - ${insertErr.message}`);
            skipped++;
            processed++;
            if (processed === data.length) {
              sendResponse();
              return;
            }
            continue;
          }
        } else if (!customerId) {
          errors.push(`Row ${index + 2}: Customer "${customerName}" not found and no phone provided`);
          skipped++;
          processed++;
          if (processed === data.length) {
            sendResponse();
            return;
          }
          continue;
        }

        // Find service by name if provided, otherwise use default
        let serviceId = defaultServiceId;
        if (serviceName) {
          try {
            const service = await db.get('SELECT id FROM services WHERE LOWER(name) = LOWER(?) AND is_active = TRUE', [serviceName]);
            if (service) {
              serviceId = service.id;
            }
          } catch (serviceErr) {
            // Use default service if service lookup fails
          }
        }

        if (!serviceId) {
          errors.push(`Row ${index + 2}: No service found and no default service available`);
          skipped++;
          processed++;
          if (processed === data.length) {
            sendResponse();
            return;
          }
          continue;
        }

        // Check if order with this receipt number already exists
        const existingOrder = await db.get('SELECT id FROM orders WHERE receipt_number = ?', [receiptId]);
        
        if (existingOrder) {
          errors.push(`Row ${index + 2}: Order with receipt "${receiptId}" already exists`);
          skipped++;
          processed++;
          if (processed === data.length) {
            sendResponse();
            return;
          }
          continue;
        }

        // Create order as uncollected stock (status 'ready')
        try {
          const result = await db.run(
            `INSERT INTO orders (receipt_number, customer_id, service_id, quantity, total_amount, paid_amount, payment_status, payment_method, status, order_date, branch_id, created_at_branch_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ready', CURRENT_TIMESTAMP, ?, ?) RETURNING id`,
            [receiptId, customerId, serviceId, quantity, finalTotalAmount, paidAmount, paymentStatus, 'cash', branchId, branchId]
          );
          
          processed++;
          imported++;

          // Create transaction record if payment was made
          if (paidAmount > 0) {
            try {
              await db.run(
                'INSERT INTO transactions (order_id, transaction_type, amount, payment_method, branch_id) VALUES (?, ?, ?, ?, ?) RETURNING id',
                [result.lastID, 'payment', paidAmount, 'cash', branchId]
              );
            } catch (transErr) {
              console.error(`Error creating transaction for order ${result.lastID}:`, transErr);
            }
          }
        } catch (insertErr) {
          processed++;
          errors.push(`Row ${index + 2}: Error creating order - ${insertErr.message}`);
          skipped++;
        }

        if (processed === data.length) {
          sendResponse();
          return;
        }
      } catch (rowErr) {
        errors.push(`Row ${index + 2}: Error processing row - ${rowErr.message}`);
        skipped++;
        processed++;
        if (processed === data.length) {
          sendResponse();
          return;
        }
      }
    }
  } catch (err) {
    fs.unlinkSync(filePath);
    return res.status(500).json({ error: 'Error getting default service: ' + err.message });
  }
});

// Get notification history for an order or customer
router.get('/notifications', async (req, res) => {
  const { order_id, customer_id, limit = 50 } = req.query;
  
  let query = `
    SELECT n.*, c.name as customer_name, o.receipt_number
    FROM notifications n
    JOIN customers c ON n.customer_id = c.id
    LEFT JOIN orders o ON n.order_id = o.id
    WHERE 1=1
  `;
  let params = [];
  
  if (order_id) {
    query += ' AND n.order_id = ?';
    params.push(order_id);
  }
  
  if (customer_id) {
    query += ' AND n.customer_id = ?';
    params.push(customer_id);
  }
  
  query += ' ORDER BY n.created_at DESC LIMIT ?';
  params.push(parseInt(limit));
  
  try {
    const rows = await db.all(query, params);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching notifications:', err);
    res.status(500).json({ error: err.message });
  }
});

// Manually send notification
router.post('/:id/send-notification', requireBranchAccess(), requirePermission('canManageOrders'), async (req, res) => {
  const { id } = req.params;
  const { notification_type = 'ready' } = req.body;
  
  try {
    const order = await db.get(
      `SELECT o.*, c.name as customer_name, c.phone as customer_phone, 
              c.sms_notifications_enabled, c.id as customer_id
       FROM orders o
       JOIN customers c ON o.customer_id = c.id
       WHERE o.id = ?`,
      [id]
    );
    
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    const smsEnabled = order.sms_notifications_enabled !== 0;
    if (!smsEnabled) {
      return res.status(400).json({ error: 'SMS notifications are disabled for this customer' });
    }
    
    if (!order.customer_phone) {
      return res.status(400).json({ error: 'Customer phone number not available' });
    }
    
    let message;
    if (notification_type === 'ready') {
      message = generateReadyNotification(
        order.receipt_number,
        order.customer_name,
        order.estimated_collection_date
      );
    } else if (notification_type === 'reminder') {
      const { generateCollectionReminder } = require('../utils/sms');
      const hoursOverdue = order.estimated_collection_date 
        ? Math.max(0, Math.floor((new Date() - new Date(order.estimated_collection_date)) / (1000 * 60 * 60)))
        : 0;
      message = generateCollectionReminder(order.receipt_number, order.customer_name, hoursOverdue);
    } else {
      return res.status(400).json({ error: 'Invalid notification type' });
    }
    
    const result = await sendSmsWithWhatsAppFallback(order.customer_phone, message, {
      customerId: order.customer_id,
      orderId: order.id,
      notificationType: notification_type
    });
    
    if (result.success) {
      res.json({ 
        message: 'Notification sent successfully',
        channel: result.channel || 'sms',
        notification_id: result.notificationId
      });
    } else {
      res.status(500).json({ 
        error: 'Failed to send notification',
        details: result.error
      });
    }
  } catch (err) {
    console.error('Error sending notification:', err);
    res.status(500).json({ error: 'Error sending notification: ' + err.message });
  }
});

// Send collection reminder for a specific order
router.post('/:id/send-reminder', requireBranchAccess(), requirePermission('canManageOrders'), async (req, res) => {
  const { id } = req.params;
  const { channels = ['sms'] } = req.body;
  const { sendCollectionReminder } = require('../utils/notifications');

  try {
    const result = await sendCollectionReminder(null, id, Array.isArray(channels) ? channels : [channels]);
    if (result.success) {
      res.json({
        message: 'Reminder sent successfully',
        result
      });
    } else {
      res.status(400).json({
        error: result.error || 'Failed to send reminder',
        result
      });
    }
  } catch (err) {
    console.error('Error sending reminder:', err);
    res.status(500).json({ error: 'Error sending reminder: ' + err.message });
  }
});

module.exports = router;
