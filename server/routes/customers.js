const express = require('express');
const router = express.Router();
const db = require('../database/query');
const { authenticate, requireBranchAccess } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { getBranchFilter, getEffectiveBranchId } = require('../utils/branchFilter');
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

// Get all customers with optional outstanding balance (?light=1 for fast list, no JOIN)
router.get('/', authenticate, async (req, res) => {
  const { search, limit: limitParam, offset: offsetParam, page, light } = req.query;
  const useLight = light === '1' || light === 'true';
  const limit = Math.min(parseInt(limitParam, 10) || (useLight ? 50 : 200), 500);
  const offset = offsetParam !== undefined ? parseInt(offsetParam, 10) : (page ? (Math.max(1, parseInt(page, 10)) - 1) * limit : 0);

  const effectiveBranchId = getEffectiveBranchId(req);

  if (useLight) {
    const whereConditions = [];
    const params = [];
    if (effectiveBranchId != null) {
      whereConditions.push('c.id IN (SELECT DISTINCT customer_id FROM orders WHERE branch_id = ?)');
      params.push(effectiveBranchId);
    }
    if (search) {
      whereConditions.push('(c.name ILIKE ? OR c.phone ILIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }
    const whereClause = whereConditions.length > 0 ? ' WHERE ' + whereConditions.join(' AND ') : '';
    try {
      const rows = await db.all(
        `SELECT c.*,
                (SELECT b.name FROM orders o JOIN branches b ON o.branch_id = b.id WHERE o.customer_id = c.id ORDER BY o.order_date DESC LIMIT 1) AS branch_name
         FROM customers c${whereClause} ORDER BY c.created_at DESC LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      );
      const formattedRows = (rows || []).map(row => ({
        ...row,
        tags: row.tags || null,
        sms_notifications_enabled: row.sms_notifications_enabled !== undefined ? row.sms_notifications_enabled : 1,
        outstanding_balance: 0,
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
           COALESCE(SUM(CASE 
             WHEN o.id IS NOT NULL 
             AND o.status != 'collected' 
             AND (o.total_amount - COALESCE(o.paid_amount, 0)) > 0
             AND ${branchCondition}
             THEN (o.total_amount - o.paid_amount) 
             ELSE 0 
           END), 0) as outstanding_balance
    FROM customers c
    LEFT JOIN orders o ON c.id = o.customer_id 
      AND o.status != 'collected' 
      AND (o.total_amount - COALESCE(o.paid_amount, 0)) > 0
      ${branchFilter.clause}
  `;
  let params = branchFilter.clause ? [...branchFilter.params, ...branchFilter.params] : [...branchFilter.params];

  const whereConditions = [];
  if (effectiveBranchId != null) {
    whereConditions.push('c.id IN (SELECT DISTINCT customer_id FROM orders WHERE branch_id = ?)');
    params.push(effectiveBranchId);
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
router.get('/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  try {
    const row = await db.get('SELECT * FROM customers WHERE id = ?', [id]);
    if (!row) {
      return res.status(404).json({ error: 'Customer not found' });
    }
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Quick-add customer for billing (name, phone, TIN, VRN) – canCreateOrders
router.post('/quick-add', authenticate, requirePermission('canCreateOrders'), async (req, res) => {
  const { name, phone, tin, vrn } = req.body;
  if (!name || !phone) {
    return res.status(400).json({ error: 'Name and phone are required' });
  }
  try {
    const r = await db.run(
      'INSERT INTO customers (name, phone, tin, vrn) VALUES (?, ?, ?, ?) RETURNING id',
      [name.trim(), phone.trim(), (tin || '').trim() || null, (vrn || '').trim() || null]
    );
    const c = await db.get('SELECT id, name, phone, tin, vrn FROM customers WHERE id = ?', [r.lastID]);
    res.status(201).json(c);
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE') && err.message.includes('phone')) {
      return res.status(400).json({ error: 'Phone number already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

// Create new customer (managers and admins only)
router.post('/', authenticate, requireBranchAccess(), requirePermission('canManageCustomers'), async (req, res) => {
  const { name, phone, email, address } = req.body;

  if (!name || !phone) {
    return res.status(400).json({ error: 'Name and phone are required' });
  }

  try {
    const result = await db.run(
      'INSERT INTO customers (name, phone, email, address) VALUES (?, ?, ?, ?) RETURNING id',
      [name, phone, email || null, address || null]
    );
    res.json({ id: result.lastID, name, phone, email, address });
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE constraint')) {
      return res.status(400).json({ error: 'Phone number already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

// Update customer (managers and admins only)
router.put('/:id', authenticate, requireBranchAccess(), requirePermission('canManageCustomers'), async (req, res) => {
  const { id } = req.params;
  const { name, phone, email, address, tags, sms_notifications_enabled } = req.body;

  // Convert tags array to comma-separated string if it's an array
  const tagsString = Array.isArray(tags) ? tags.join(',') : (tags || '');

  try {
    const result = await db.run(
      'UPDATE customers SET name = ?, phone = ?, email = ?, address = ?, tags = ?, sms_notifications_enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [name, phone, email || null, address || null, tagsString || null, sms_notifications_enabled !== undefined ? sms_notifications_enabled : null, id]
    );
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Customer not found' });
    }
    res.json({ message: 'Customer updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update customer tags
router.put('/:id/tags', authenticate, async (req, res) => {
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
router.get('/by-tag/:tag', authenticate, async (req, res) => {
  const { tag } = req.params;
  
  try {
    const rows = await db.all(
      `SELECT * FROM customers 
       WHERE tags ILIKE ? OR tags ILIKE ? OR tags ILIKE ?
       ORDER BY name ASC`,
      [`%${tag},%`, `%,${tag},%`, `%,${tag}%`]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all unique tags
router.get('/tags/all', authenticate, async (req, res) => {
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
router.post('/upload-excel', authenticate, upload.single('file'), async (req, res) => {
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
        // Check if customer already exists
        const existing = await db.get('SELECT id FROM customers WHERE phone = ?', [phone]);
        
        if (existing) {
          skipped++;
          continue;
        }

        // Insert new customer
        await db.run(
          'INSERT INTO customers (name, phone, email, address) VALUES (?, ?, ?, ?) RETURNING id',
          [name, phone, email || null, address || null]
        );
        imported++;
      } catch (insertErr) {
        errors.push(`Row ${index + 2}: ${insertErr.message}`);
        skipped++;
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
router.get('/:id/orders', authenticate, async (req, res) => {
  const { id } = req.params;
  try {
    const rows = await db.all(
      `SELECT o.*, s.name as service_name, c.name as customer_name, c.phone as customer_phone
       FROM orders o
       JOIN services s ON o.service_id = s.id
       JOIN customers c ON o.customer_id = c.id
       WHERE o.customer_id = ?
       ORDER BY o.order_date DESC`,
      [id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Send balance reminder to customer
router.post('/:id/send-balance-reminder', authenticate, async (req, res) => {
  const { id } = req.params;
  const { channels = ['sms'] } = req.body;
  const { sendBalanceReminder } = require('../utils/notifications');

  try {
    const result = await sendBalanceReminder(id, Array.isArray(channels) ? channels : [channels]);
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
