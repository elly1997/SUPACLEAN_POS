const express = require('express');
const router = express.Router();
const db = require('../database/query');
const { authenticate, requireBranchAccess, requireBranchFeature } = require('../middleware/auth');
const { requirePermission, requireAnyPermission } = require('../middleware/permissions');
const { getBranchFilter, getEffectiveBranchId } = require('../utils/branchFilter');
const { branchCustomerMatchSql, customerBelongsToBranch } = require('../utils/customerBranch');
const { normalizePhoneDigits, isPlaceholderPhone } = require('../utils/customerPhone');

async function phoneNormalizedForCustomer(phone, excludeId = null, branchId = null) {
  const normalized = normalizePhoneDigits(String(phone || '').trim());
  if (!normalized) return null;
  const params = [normalized];
  let sql = 'SELECT id FROM customers WHERE phone_normalized = ?';
  if (branchId != null) {
    sql += ' AND primary_branch_id = ?';
    params.push(branchId);
  } else {
    sql += ' AND primary_branch_id IS NULL';
  }
  if (excludeId) {
    sql += ' AND id <> ?';
    params.push(excludeId);
  }
  sql += ' LIMIT 1';
  const existing = await db.get(sql, params);
  return existing ? null : normalized;
}
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

/** Find a customer by phone inside one branch. The same phone at another branch is a different record. */
async function findCustomerByPhone(phone, branchId = null) {
  if (!phone || !phone.trim()) return null;
  const trimmed = phone.trim();
  if (isPlaceholderPhone(trimmed)) return null;
  const normalized = normalizePhoneDigits(trimmed);
  const digitsOnly = trimmed.replace(/\D/g, '');
  const branchSql = branchId != null ? 'AND primary_branch_id = ?' : 'AND primary_branch_id IS NULL';
  const branchParam = branchId != null ? [branchId] : [];
  const rows = await db.all(
    `SELECT * FROM customers
     WHERE (
        phone_normalized = ?
        OR TRIM(phone) = ?
        OR phone = ?
        OR regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g') = ?
     )
     ${branchSql}
     ORDER BY
       CASE WHEN phone_normalized = ? THEN 0 ELSE 1 END,
       id ASC
     LIMIT 1`,
    [normalized, trimmed, normalized, digitsOnly, ...branchParam, normalized]
  );
  return rows && rows[0] ? rows[0] : null;
}


async function formatExistingCustomerResponse(existing, extras = {}) {
  let home_branch_name = null;
  let home_branch_code = null;
  if (existing.primary_branch_id) {
    const branch = await db.get('SELECT name, code FROM branches WHERE id = ?', [existing.primary_branch_id]);
    home_branch_name = branch?.name || null;
    home_branch_code = branch?.code || null;
  }
  const branchLabel = home_branch_code || home_branch_name;
  return {
    id: existing.id,
    name: existing.name,
    phone: existing.phone,
    email: existing.email ?? extras.email ?? null,
    address: existing.address ?? extras.address ?? null,
    existing: true,
    home_branch_id: existing.primary_branch_id ?? null,
    home_branch_name,
    home_branch_code,
    message: branchLabel
      ? `Customer already registered at ${branchLabel}.`
      : 'Customer with this phone already exists at this branch.',
  };
}

router.use(authenticate, requireBranchFeature('customers'));

// Fast typeahead search for New Order / Collection autocomplete (must be before /:id).
// Results stay inside the branch that is open, so a WP customer cannot be picked at another branch.
router.get('/search', async (req, res) => {
  const q = String(req.query.q || req.query.search || '').trim();
  if (q.length < 2) {
    return res.json([]);
  }

  const branchId = getEffectiveBranchId(req);
  if (branchId == null) {
    return res.status(400).json({
      error: 'Select a branch before searching customers. Each branch keeps its own customer list.',
    });
  }

  const limit = Math.min(parseInt(req.query.limit, 10) || 15, 30);
  const digitsOnly = q.replace(/\D/g, '');
  let normalizedPhone = digitsOnly;
  if (digitsOnly.length === 10 && digitsOnly.startsWith('0')) {
    normalizedPhone = '255' + digitsOnly.slice(1);
  } else if (digitsOnly.length === 9) {
    normalizedPhone = '255' + digitsOnly;
  }

  const searchConditions = ['c.name ILIKE ?', 'c.phone ILIKE ?'];
  const params = [`${q}%`, `${q}%`];
  if (normalizedPhone.length >= 3) {
    searchConditions.push('c.phone_normalized LIKE ?');
    params.push(`${normalizedPhone}%`);
  }

  const whereClause = ` WHERE ${branchCustomerMatchSql('c')} AND (${searchConditions.join(' OR ')})`;
  params.unshift(branchId, branchId);

  try {
    const rows = await db.all(
      `SELECT c.id, c.name, c.phone, c.email, c.primary_branch_id AS branch_id, b.name AS branch_name, b.code AS branch_code
       FROM customers c
       LEFT JOIN branches b ON b.id = c.primary_branch_id
       ${whereClause}
       ORDER BY c.name ASC
       LIMIT ?`,
      [...params, limit]
    );
    res.json(rows || []);
  } catch (err) {
    console.error('Error searching customers:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get all customers with optional outstanding balance (?light=1 for fast list, no JOIN)
router.get('/', async (req, res) => {
  const { search, limit: limitParam, offset: offsetParam, page, light } = req.query;
  const useLight = light === '1' || light === 'true';
  const limit = Math.min(parseInt(limitParam, 10) || (useLight ? 50 : 200), 500);
  const offset = offsetParam !== undefined ? parseInt(offsetParam, 10) : (page ? (Math.max(1, parseInt(page, 10)) - 1) * limit : 0);

  const effectiveBranchId = getEffectiveBranchId(req);

  if (useLight) {
    const whereConditions = [];
    const params = [];
    if (effectiveBranchId != null) {
      whereConditions.push(branchCustomerMatchSql('c'));
      params.push(effectiveBranchId, effectiveBranchId);
    }
    if (search) {
      whereConditions.push('(c.name ILIKE ? OR c.phone ILIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }
    const whereClause = whereConditions.length > 0 ? ' WHERE ' + whereConditions.join(' AND ') : '';
    try {
      const rows = await db.all(
        `SELECT c.*,
                c.primary_branch_id AS branch_id,
                b.name AS branch_name
         FROM customers c
         LEFT JOIN branches b ON b.id = c.primary_branch_id
         ${whereClause} ORDER BY c.created_at DESC LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      );
      const formattedRows = (rows || []).map(row => ({
        ...row,
        tags: row.tags || null,
        sms_notifications_enabled: row.sms_notifications_enabled !== undefined ? row.sms_notifications_enabled : 1,
        outstanding_balance: 0,
        branch_id: row.branch_id != null ? row.branch_id : null,
        branch_name: row.branch_name || null
      }));
      return res.json(formattedRows);
    } catch (err) {
      console.error('Error fetching customers (light):', err);
      return res.status(500).json({ error: err.message });
    }
  }

  // Full list with outstanding balance (and branch isolation: only customers with orders at this branch)
  const branchFilter = getBranchFilter(req, 'o');
  const branchCondition = branchFilter.clause 
    ? branchFilter.clause.replace(/^AND\s+/, '') 
    : '1=1';
  
  let query = `
    SELECT c.*,
           (SELECT o.branch_id FROM orders o WHERE o.customer_id = c.id ORDER BY o.order_date DESC LIMIT 1) AS branch_id,
           (SELECT b.name FROM orders o JOIN branches b ON o.branch_id = b.id WHERE o.customer_id = c.id ORDER BY o.order_date DESC LIMIT 1) AS branch_name,
           COALESCE(SUM(CASE 
             WHEN o.id IS NOT NULL 
             AND o.status != 'collected' 
             AND COALESCE(o.is_voided, FALSE) = FALSE
             AND (o.total_amount - COALESCE(o.paid_amount, 0)) > 0
             AND ${branchCondition}
             THEN (o.total_amount - o.paid_amount) 
             ELSE 0 
           END), 0) as outstanding_balance
    FROM customers c
    LEFT JOIN orders o ON c.id = o.customer_id 
      AND o.status != 'collected' 
      AND COALESCE(o.is_voided, FALSE) = FALSE
      AND (o.total_amount - COALESCE(o.paid_amount, 0)) > 0
      ${branchFilter.clause}
  `;
  let params = branchFilter.clause ? [...branchFilter.params, ...branchFilter.params] : [...branchFilter.params];

  const whereConditions = [];
  if (effectiveBranchId != null) {
    whereConditions.push(branchCustomerMatchSql('c'));
    params.push(effectiveBranchId, effectiveBranchId);
  }
  if (search) {
    whereConditions.push('(c.name ILIKE ? OR c.phone ILIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }
  if (whereConditions.length > 0) {
    query += ' WHERE ' + whereConditions.join(' AND ');
  }

  query += ' GROUP BY c.id ORDER BY c.created_at DESC';
  query += ' LIMIT ? OFFSET ?';
  params.push(limit, offset);

  try {
    const rows = await db.all(query, params);
    // Ensure all rows have required fields with defaults
    const formattedRows = (rows || []).map(row => ({
      ...row,
      tags: row.tags || null,
      sms_notifications_enabled: row.sms_notifications_enabled !== undefined ? row.sms_notifications_enabled : 1,
      outstanding_balance: parseFloat(row.outstanding_balance || 0)
    }));
    res.json(formattedRows);
  } catch (err) {
    console.error('Error fetching customers:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get customer by ID
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const row = await db.get('SELECT * FROM customers WHERE id = ?', [id]);
    const branchId = getEffectiveBranchId(req);
    if (!row || (branchId != null && !(await customerBelongsToBranch(db, row, branchId)))) {
      return res.status(404).json({ error: 'Customer not found in this branch' });
    }
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Quick-add customer for billing (name, phone, TIN, VRN) – canCreateOrders. Find-or-create by phone.
router.post('/quick-add', requirePermission('canCreateOrders'), async (req, res) => {
  const { name, phone, tin, vrn } = req.body;
  if (!name || !phone) {
    return res.status(400).json({ error: 'Name and phone are required' });
  }
  try {
    const branchId = getEffectiveBranchId(req) ?? req.user?.branchId ?? null;
    if (!branchId) {
      return res.status(400).json({ error: 'Select a branch before adding a customer. Customers stay in the branch where they are created.' });
    }
    const existing = await findCustomerByPhone(phone, branchId);
    if (existing) {
      const c = await db.get('SELECT id, name, phone, tin, vrn, primary_branch_id FROM customers WHERE id = ?', [existing.id]);
      const payload = await formatExistingCustomerResponse(existing, { tin: c?.tin, vrn: c?.vrn });
      return res.status(200).json({ ...c, ...payload, existing: true });
    }
    const normalizedPhone = await phoneNormalizedForCustomer(phone, null, branchId);
    const r = await db.run(
      'INSERT INTO customers (name, phone, phone_normalized, tin, vrn, primary_branch_id) VALUES (?, ?, ?, ?, ?, ?) RETURNING id',
      [name.trim(), phone.trim(), normalizedPhone, (tin || '').trim() || null, (vrn || '').trim() || null, branchId]
    );
    const id = r?.row?.id ?? r?.lastID;
    const c = await db.get('SELECT id, name, phone, tin, vrn FROM customers WHERE id = ?', [id]);
    res.status(201).json(c);
  } catch (err) {
    if (err.message && (err.message.includes('UNIQUE') || err.message.includes('customers_phone_key')) && err.message.includes('phone')) {
      const existing = await findCustomerByPhone(phone, getEffectiveBranchId(req)).catch(() => null);
      if (existing) {
        const c = await db.get('SELECT id, name, phone, tin, vrn FROM customers WHERE id = ?', [existing.id]);
        const payload = await formatExistingCustomerResponse(existing, { tin: c?.tin, vrn: c?.vrn });
        return res.status(200).json({ ...c, ...payload, existing: true });
      }
      return res.status(400).json({
        error: 'This phone is already saved at another branch. Add the customer again after the server restarts so this branch can keep its own copy.',
      });
    }
    res.status(500).json({ error: err.message });
  }
});

// Create customer in the open branch. A matching phone at another branch is not reused.
router.post('/', requireBranchAccess(), requireAnyPermission('canManageCustomers', 'canCreateOrders'), async (req, res) => {
  const { name, phone, email, address } = req.body;
  const branchId = getEffectiveBranchId(req) ?? req.user?.branchId ?? req.branch?.id ?? null;

  if (!name || !phone) {
    return res.status(400).json({ error: 'Name and phone are required' });
  }
  if (!branchId) {
    return res.status(400).json({ error: 'Select a branch before adding a customer. Customers stay in the branch where they are created.' });
  }

  try {
    const existing = await findCustomerByPhone(phone, branchId);
    if (existing) {
      return res.status(200).json(await formatExistingCustomerResponse(existing, { email, address }));
    }
    const normalizedPhone = await phoneNormalizedForCustomer(phone, null, branchId);
    const result = await db.run(
      branchId
        ? 'INSERT INTO customers (name, phone, phone_normalized, email, address, primary_branch_id) VALUES (?, ?, ?, ?, ?, ?) RETURNING id'
        : 'INSERT INTO customers (name, phone, phone_normalized, email, address) VALUES (?, ?, ?, ?, ?) RETURNING id',
      branchId
        ? [name.trim(), phone.trim(), normalizedPhone, email ? email.trim() || null : null, address ? address.trim() || null : null, branchId]
        : [name.trim(), phone.trim(), normalizedPhone, email ? email.trim() || null : null, address ? address.trim() || null : null]
    );
    const id = result?.row?.id ?? result?.lastID;
    res.status(201).json({ id, name: name.trim(), phone: phone.trim(), email: email || null, address: address || null });
  } catch (err) {
    if (err.message && (err.message.includes('UNIQUE') || err.message.includes('unique constraint') || err.message.includes('customers_phone_key'))) {
      const existing = await findCustomerByPhone(phone, branchId).catch(() => null);
      if (existing) {
        return res.status(200).json(await formatExistingCustomerResponse(existing, { email, address }));
      }
      return res.status(400).json({
        error: 'This phone is already saved at another branch. Add the customer again after the server restarts so this branch can keep its own copy.',
      });
    }
    res.status(500).json({ error: err.message });
  }
});

// Update customer (managers and admins only)
router.put('/:id', requireBranchAccess(), requirePermission('canManageCustomers'), async (req, res) => {
  const { id } = req.params;
  const { name, phone, email, address, tags, sms_notifications_enabled } = req.body;

  // SMS deactivation is an admin-only capability.
  // This prevents branch managers from disabling customer SMS notifications.
  if (sms_notifications_enabled !== undefined && req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Only admins can change SMS notification settings for customers.' });
  }

  // Convert tags array to comma-separated string if it's an array
  const tagsString = Array.isArray(tags) ? tags.join(',') : (tags || '');

  try {
    const current = await db.get('SELECT * FROM customers WHERE id = ?', [id]);
    const openBranchId = getEffectiveBranchId(req);
    if (!current || (openBranchId != null && !(await customerBelongsToBranch(db, current, openBranchId)))) {
      return res.status(404).json({ error: 'Customer not found in this branch' });
    }
    const branchId = current.primary_branch_id ?? openBranchId;
    if (phone != null && phone.trim()) {
      const existing = await findCustomerByPhone(phone, branchId);
      if (existing && String(existing.id) !== String(id)) {
        return res.status(400).json({ error: 'Phone number already in use by another customer at this branch' });
      }
    }
    const normalizedPhone = await phoneNormalizedForCustomer(phone, id, branchId);
    const result = await db.run(
      'UPDATE customers SET name = ?, phone = ?, phone_normalized = ?, email = ?, address = ?, tags = ?, sms_notifications_enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [name, phone, normalizedPhone, email || null, address || null, tagsString || null, sms_notifications_enabled !== undefined ? sms_notifications_enabled : null, id]
    );
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Customer not found' });
    }
    res.json({ message: 'Customer updated successfully' });
  } catch (err) {
    if (err.message && (err.message.includes('UNIQUE') || err.message.includes('customers_phone_key'))) {
      return res.status(400).json({ error: 'Phone number already in use by another customer at this branch' });
    }
    res.status(500).json({ error: err.message });
  }
});

// Update customer tags
router.put('/:id/tags', async (req, res) => {
  const { id } = req.params;
  const { tags } = req.body;

  const tagsString = Array.isArray(tags) ? tags.join(',') : (tags || '');

  try {
    const result = await db.run(
      'UPDATE customers SET tags = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [tagsString || null, id]
    );
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Customer not found' });
    }
    res.json({ message: 'Customer tags updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get customers by tag
router.get('/by-tag/:tag', async (req, res) => {
  const { tag } = req.params;
  
  try {
    const branchId = getEffectiveBranchId(req);
    const params = [`%${tag},%`, `%,${tag},%`, `%,${tag}%`];
    let branchSql = '';
    if (branchId != null) {
      branchSql = ' AND primary_branch_id = ?';
      params.push(branchId);
    }
    const rows = await db.all(
      `SELECT * FROM customers 
       WHERE (tags ILIKE ? OR tags ILIKE ? OR tags ILIKE ?)
       ${branchSql}
       ORDER BY name ASC`,
      params
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all unique tags
router.get('/tags/all', async (req, res) => {
  try {
    const rows = await db.all(
      'SELECT DISTINCT tags FROM customers WHERE tags IS NOT NULL AND tags != \'\'',
      []
    );
    
    // Extract all unique tags
    const allTags = new Set();
    rows.forEach(row => {
      if (row.tags) {
        row.tags.split(',').forEach(tag => {
          const trimmedTag = tag.trim();
          if (trimmedTag) {
            allTags.add(trimmedTag);
          }
        });
      }
    });
    
    res.json(Array.from(allTags).sort());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Upload Excel file and import customers
router.post('/upload-excel', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const filePath = req.file.path;

  try {
    // Read Excel file using ExcelJS (more secure than xlsx)
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    const worksheet = workbook.worksheets[0];
    
    if (!worksheet || worksheet.rowCount === 0) {
      fs.unlinkSync(filePath);
      return res.status(400).json({ error: 'Excel file is empty' });
    }

    // Convert worksheet to JSON array
    const data = [];
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
      return res.status(400).json({ error: 'Excel file contains no data rows' });
    }

    const importBranchId = getEffectiveBranchId(req);
    if (!importBranchId) {
      fs.unlinkSync(filePath);
      return res.status(400).json({ error: 'Select a branch before importing customers. Imported customers stay in that branch.' });
    }

    let imported = 0;
    let skipped = 0;
    const errors = [];

    // Process each row sequentially
    for (let index = 0; index < data.length; index++) {
      const row = data[index];
      // Try to find name and phone in various column formats
      const name = row.Name || row.name || row['Customer Name'] || row['Customer name'] || row['NAME'] || row['Full Name'] || row['full name'] || '';
      const phone = String(row.Phone || row.phone || row['Phone Number'] || row['Phone number'] || row['PHONE'] || row['Phone'] || row['Mobile'] || row['mobile'] || '').trim();
      const email = row.Email || row.email || row['E-mail'] || row['E-Mail'] || row['EMAIL'] || row['Email Address'] || '';
      const address = row.Address || row.address || row['ADDRESS'] || row['Location'] || row['location'] || '';

      if (!name || !phone) {
        errors.push(`Row ${index + 2}: Missing name or phone`);
        skipped++;
        continue;
      }

      try {
        const existing = await findCustomerByPhone(phone, importBranchId);
        if (existing) {
          skipped++;
          continue;
        }
        const normalizedPhone = await phoneNormalizedForCustomer(phone, null, importBranchId);
        await db.run(
          'INSERT INTO customers (name, phone, phone_normalized, email, address, primary_branch_id) VALUES (?, ?, ?, ?, ?, ?) RETURNING id',
          [name, phone, normalizedPhone, email || null, address || null, importBranchId]
        );
        imported++;
      } catch (insertErr) {
        if (insertErr.message && (insertErr.message.includes('UNIQUE') || insertErr.message.includes('customers_phone_key'))) {
          skipped++;
        } else {
          errors.push(`Row ${index + 2}: ${insertErr.message}`);
          skipped++;
        }
      }
    }

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
      errors: errors.slice(0, 10) // Limit errors to first 10
    });
  } catch (error) {
    // Clean up uploaded file on error
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (unlinkErr) {
      console.error('Error deleting file:', unlinkErr);
    }
    res.status(500).json({ error: 'Error processing Excel file: ' + error.message });
  }
});

// Get customer orders
router.get('/:id/orders', async (req, res) => {
  const { id } = req.params;
  try {
    const branchId = getEffectiveBranchId(req);
    const customer = await db.get('SELECT id, primary_branch_id FROM customers WHERE id = ?', [id]);
    if (!customer || (branchId != null && !(await customerBelongsToBranch(db, customer, branchId)))) {
      return res.status(404).json({ error: 'Customer not found in this branch' });
    }
    const branchFilter = getBranchFilter(req, 'o');
    const rows = await db.all(
      `SELECT o.*, s.name as service_name, c.name as customer_name, c.phone as customer_phone,
              COALESCE(tx.total_received, 0) as receipt_total_received,
              COALESCE(tx.payments_count, 0) as receipt_payments_count,
              tx.last_payment_at as receipt_last_payment_at
       FROM orders o
       JOIN services s ON o.service_id = s.id
       JOIN customers c ON o.customer_id = c.id
       LEFT JOIN (
         SELECT ro.receipt_number,
                ro.customer_id,
                SUM(t.amount) as total_received,
                COUNT(t.id) as payments_count,
                MAX(t.transaction_date) as last_payment_at
         FROM orders ro
         JOIN transactions t ON t.order_id = ro.id
         WHERE t.transaction_type = 'payment_received'
         GROUP BY ro.receipt_number, ro.customer_id
       ) tx ON tx.receipt_number = o.receipt_number AND tx.customer_id = o.customer_id
       WHERE o.customer_id = ?
       AND COALESCE(o.is_voided, FALSE) = FALSE
       ${branchFilter.clause}
       ORDER BY o.order_date DESC`,
      [id, ...branchFilter.params]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Send balance reminder to customer
router.post('/:id/send-balance-reminder', async (req, res) => {
  const { id } = req.params;
  const { channels = ['sms'] } = req.body;
  const { sendBalanceReminder } = require('../utils/notifications');

  try {
    const result = await sendBalanceReminder(id, Array.isArray(channels) ? channels : [channels]);
    if (result.skippedDuplicate) {
      return res.json({
        message: 'A balance reminder was already sent recently for this customer; not sending again.',
        skipped_duplicate: true,
        result
      });
    }

    // Global SMS suppression (don’t treat as a generic failure).
    if (result?.channels?.sms?.smsSuppressed && !result?.channels?.whatsapp?.success) {
      return res.json({
        message: 'SMS sending is globally disabled by admin',
        channel: null,
        sent: false,
        sms_suppressed: true,
        result
      });
    }

    if (result.success) {
      res.json({
        message: 'Balance reminder sent successfully',
        result
      });
    } else {
      res.status(400).json({
        error: result.error || 'Failed to send reminder',
        result
      });
    }
  } catch (err) {
    res.status(500).json({ error: 'Error sending reminder: ' + err.message });
  }
});

module.exports = router;
