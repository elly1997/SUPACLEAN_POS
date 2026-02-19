const moment = require('moment');
const QRCode = require('qrcode');
const db = require('../database/query');

// Generate unique receipt number in format: {sequence}-{DD}-{MM} ({YY})
// Example: 1-01-01 (26) for first customer on January 1, 2026
// Format: sequence-day-month (year)
// PostgreSQL-compatible async implementation
async function generateReceiptNumberAsync(retryCount = 0) {
  const today = new Date();
  const day = String(today.getDate()).padStart(2, '0'); // Zero-padded day (01, 02, etc.)
  const month = String(today.getMonth() + 1).padStart(2, '0'); // Zero-padded month (01, 02, etc.)
  const year = today.getFullYear().toString().slice(-2); // Last 2 digits of year
  const dateStr = moment(today).format('YYYY-MM-DD');
  const receiptPattern = `%-${day}-${month} (${year})`; // Pattern without "HQ" prefix
  
  try {
    // PostgreSQL: Extract sequence number from receipt_number format: {sequence}-{DD}-{MM} ({YY})
    // Use SPLIT_PART to extract sequence (everything before the first hyphen)
    const row = await db.get(
      `SELECT MAX(CAST(SPLIT_PART(receipt_number, '-', 1) AS INTEGER)) as max_seq
       FROM orders 
       WHERE DATE(order_date) = $1 
       AND receipt_number LIKE $2`,
      [dateStr, receiptPattern]
    );
    
    let sequence = 1;
    if (row && row.max_seq !== null) {
      sequence = row.max_seq + 1;
    }
    
    const receiptNumber = `${sequence}-${day}-${month} (${year})`;
    return receiptNumber;
  } catch (err) {
    console.error('Error generating receipt number:', err);
    // Fallback: use timestamp-based sequence if query fails
    if (retryCount < 3) {
      return generateReceiptNumberAsync(retryCount + 1);
    }
    // Final fallback: use timestamp
    const timestampSeq = Date.now() % 100000;
    return `${timestampSeq}-${day}-${month} (${year})`;
  }
}

// Callback wrapper for backward compatibility
function generateReceiptNumber(callback, retryCount = 0) {
  generateReceiptNumberAsync(retryCount)
    .then(receiptNumber => callback(null, receiptNumber))
    .catch(err => callback(err, null));
}

// Async version exported for use in routes
async function generateReceiptNumberPromise() {
  return generateReceiptNumberAsync();
}

// Fallback method (deprecated - kept for compatibility, but uses async version)
function generateReceiptNumberFallback(callback, day, month, year, dateStr, receiptPattern, retryCount = 0) {
  // Just use the async version
  generateReceiptNumberAsync()
    .then(receiptNumber => callback(null, receiptNumber))
    .catch(err => {
      // After retries, use timestamp-based fallback
      const timestampSeq = Date.now() % 100000;
      const receiptNumber = `${timestampSeq}-${day}-${month} (${year})`;
      callback(null, receiptNumber);
    });
}

// OLD SQLite fallback - no longer used but kept for reference
function generateReceiptNumberFallback_OLD(callback, day, month, year, dateStr, receiptPattern, retryCount = 0) {
  if (retryCount > 5) {
    // After 5 retries, use timestamp-based fallback
    const timestampSeq = Date.now() % 100000;
    const receiptNumber = `${timestampSeq}-${day}-${month} (${year})`;
    return callback(null, receiptNumber);
  }
  
  db.get(
    `SELECT MAX(CAST(SUBSTR(receipt_number, 1, INSTR(receipt_number || '-', '-') - 1) AS INTEGER)) as max_seq
     FROM orders 
     WHERE DATE(order_date) = ? 
     AND receipt_number LIKE ?`,
    [dateStr, receiptPattern],
    (err, row) => {
      if (err) {
        // Retry with exponential backoff
        setTimeout(() => {
          generateReceiptNumberFallback(callback, day, month, year, dateStr, receiptPattern, retryCount + 1);
        }, 50 * (retryCount + 1));
        return;
      }
      
      let sequence = 1;
      if (row && row.max_seq !== null) {
        sequence = row.max_seq + 1;
      }
      
      const receiptNumber = `${sequence}-${day}-${month} (${year})`;
      callback(null, receiptNumber);
    }
  );
}

// Synchronous version (for backward compatibility, uses a fallback)
function generateReceiptNumberSync() {
  const today = new Date();
  const day = String(today.getDate()).padStart(2, '0'); // Zero-padded day
  const month = String(today.getMonth() + 1).padStart(2, '0'); // Zero-padded month
  const year = today.getFullYear().toString().slice(-2);
  // Fallback: use timestamp-based sequence
  const sequence = Date.now() % 10000;
  return `${sequence}-${day}-${month} (${year})`;
}

// Calculate order total with express service support (sync version - no DB needed)
async function calculateTotal(service, quantity = 1, weight = 0, deliveryType = 'standard', expressMultiplier = 0) {
  
  // base_price should be multiplied by quantity (it's the price per item)
  let baseTotal = (service.base_price || 0) * quantity;
  
  if (service.price_per_item > 0) {
    baseTotal += service.price_per_item * quantity;
  }
  
  if (service.price_per_kg > 0 && weight > 0) {
    baseTotal += service.price_per_kg * weight;
  }
  
  // Apply express surcharge if applicable
  if (deliveryType !== 'standard' && expressMultiplier > 0) {
    return baseTotal * expressMultiplier;
  }
  
  return baseTotal;
}

// Calculate total (synchronous version for backward compatibility)
function calculateTotalSync(service, quantity = 1, weight = 0, deliveryType = 'standard', expressMultiplier = 0) {
  // base_price should be multiplied by quantity (it's the price per item)
  let baseTotal = (service.base_price || 0) * quantity;
  
  if (service.price_per_item > 0) {
    baseTotal += service.price_per_item * quantity;
  }
  
  if (service.price_per_kg > 0 && weight > 0) {
    baseTotal += service.price_per_kg * weight;
  }
  
  // Apply express surcharge if applicable
  if (deliveryType !== 'standard' && expressMultiplier > 0) {
    return baseTotal * expressMultiplier;
  }
  
  return baseTotal;
}

// Generate QR code data URL for receipt
async function generateReceiptQRCode(order, customer, service) {
  try {
    // Create QR code data with receipt information
    const qrData = {
      receiptNumber: order.receipt_number,
      date: moment(order.order_date).format('DD/MM/YYYY HH:mm'),
      customer: customer.name,
      phone: customer.phone,
      service: service.name,
      quantity: order.quantity,
      color: order.color || '',
      amount: order.total_amount,
      status: order.status,
      estimatedCollection: order.estimated_collection_date ? moment(order.estimated_collection_date).format('DD/MM/YYYY HH:mm') : ''
    };
    
    // Convert to string format for QR code
    const qrString = JSON.stringify(qrData);
    
    // Generate QR code as data URL (base64 image)
    const qrCodeDataURL = await QRCode.toDataURL(qrString, {
      width: 200,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      }
    });
    
    return qrCodeDataURL;
  } catch (error) {
    console.error('Error generating QR code:', error);
    return null;
  }
}

// Format receipt for printing (async version with QR code)
async function formatReceiptAsync(order, customer, service) {
  const estimatedCollectionDate = order.estimated_collection_date 
    ? `Est. Collection: ${moment(order.estimated_collection_date).format('DD/MM/YYYY HH:mm')}\n`
    : '';
  
  // Get item name - prefer garment_type (item name) over service name
  const itemName = order.garment_type || service.name;
  
  // Clean special_instructions - remove "Item ID: XX" pattern
  let cleanNotes = order.special_instructions || '';
  if (cleanNotes) {
    // Remove "Item ID: XX" pattern
    cleanNotes = cleanNotes.replace(/Item ID:\s*\d+/gi, '').trim();
    // Remove leading/trailing separators
    cleanNotes = cleanNotes.replace(/^[\s|]*|[\s|]*$/g, '').trim();
  }
  
  // Ensure total_amount is a number and properly formatted
  const totalAmount = parseFloat(order.total_amount) || 0;
  
  // Generate QR code
  const qrCodeDataURL = await generateReceiptQRCode(order, customer, service);
  
  const branchLine = (order.branch_name || order.branch_id) ? `Branch: ${order.branch_name || `ID ${order.branch_id}`}\n` : '';
  const branchLocation = order.branch_name ? order.branch_name + ', Tanzania' : 'Arusha, Tanzania';
  const receipt = {
    text: `
═══════════════════════════════════
         SUPACLEAN
   Laundry & Dry Cleaning
   ${branchLocation}
═══════════════════════════════════

Receipt No: ${order.receipt_number}
${branchLine}Date: ${moment(order.order_date).format('DD/MM/YYYY HH:mm')}
${estimatedCollectionDate}
Customer: ${customer.name}
Phone: ${customer.phone}
───────────────────────────────────
${itemName} x${order.quantity}
${order.color ? `Color: ${order.color}\n` : ''}
───────────────────────────────────
Total: TSh ${totalAmount.toLocaleString()}
${order.payment_status === 'not_paid' ? 'Status: NOT PAID' : order.payment_status === 'paid_full' ? `Status: PAID (${(order.payment_method || 'cash').toUpperCase()})` : `Status: ADVANCE (${(order.payment_method || 'cash').toUpperCase()})\nPaid: TSh ${(order.paid_amount || 0).toLocaleString()}\nBalance: TSh ${(totalAmount - (order.paid_amount || 0)).toLocaleString()}`}
───────────────────────────────────

═══════════════════════════════════
`,
    qrCode: qrCodeDataURL
  };

  return receipt;
}

// Format receipt for printing (synchronous version for backward compatibility)
function formatReceipt(order, customer, service) {
  const estimatedCollectionDate = order.estimated_collection_date 
    ? `Est. Collection: ${moment(order.estimated_collection_date).format('DD/MM/YYYY HH:mm')}\n`
    : '';
  
  // Get item name - prefer garment_type (item name) over service name
  const itemName = order.garment_type || service.name;
  
  // Clean special_instructions - remove "Item ID: XX" pattern
  let cleanNotes = order.special_instructions || '';
  if (cleanNotes) {
    // Remove "Item ID: XX" pattern
    cleanNotes = cleanNotes.replace(/Item ID:\s*\d+/gi, '').trim();
    // Remove leading/trailing separators
    cleanNotes = cleanNotes.replace(/^[\s|]*|[\s|]*$/g, '').trim();
  }
  
  // Ensure total_amount is a number and properly formatted
  const totalAmount = parseFloat(order.total_amount) || 0;
  
  const branchLine = (order.branch_name || order.branch_id) ? `Branch: ${order.branch_name || `ID ${order.branch_id}`}\n` : '';
  const receipt = `
═══════════════════════════════════
         SUPACLEAN
   Laundry & Dry Cleaning
   ${order.branch_name ? order.branch_name + ', Tanzania' : 'Arusha, Tanzania'}
═══════════════════════════════════

Receipt No: ${order.receipt_number}
${branchLine}Date: ${moment(order.order_date).format('DD/MM/YYYY HH:mm')}
${estimatedCollectionDate}
Customer: ${customer.name}
Phone: ${customer.phone}
───────────────────────────────────
${itemName} x${order.quantity}
${order.color ? `Color: ${order.color}\n` : ''}
───────────────────────────────────
Total: TSh ${totalAmount.toLocaleString()}
${order.payment_status === 'not_paid' ? 'Status: NOT PAID' : order.payment_status === 'paid_full' ? `Status: PAID (${(order.payment_method || 'cash').toUpperCase()})` : `Status: ADVANCE (${(order.payment_method || 'cash').toUpperCase()})\nPaid: TSh ${(order.paid_amount || 0).toLocaleString()}\nBalance: TSh ${(totalAmount - (order.paid_amount || 0)).toLocaleString()}`}
───────────────────────────────────

═══════════════════════════════════
`;

  return receipt;
}

module.exports = {
  generateReceiptNumber,
  generateReceiptNumberAsync,
  generateReceiptNumberPromise,
  calculateTotal: calculateTotalSync,
  calculateTotalAsync: calculateTotal,
  formatReceipt,
  formatReceiptAsync,
  generateReceiptQRCode
};
