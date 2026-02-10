const express = require('express');
const router = express.Router();
const db = require('../database/query');
const { authenticate, requireBranchAccess } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { getBranchFilter } = require('../utils/branchFilter');

// Generate delivery note number
function generateDeliveryNumber() {
  const year = new Date().getFullYear();
  const month = String(new Date().getMonth() + 1).padStart(2, '0');
  const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  return `DN-${year}-${month}-${random}`;
}

// Get all delivery notes
router.get('/', authenticate, requireBranchAccess(), async (req, res) => {
  const { customer_id, date_from, date_to, status, invoice_id } = req.query;
  const branchFilter = getBranchFilter(req, 'dn');

  let query = `
    SELECT dn.*, 
           c.name as customer_name, 
           c.phone as customer_phone,
           c.company_name,
           s.name as service_name,
           i.invoice_number
    FROM delivery_notes dn
    LEFT JOIN customers c ON dn.customer_id = c.id
    LEFT JOIN services s ON dn.service_id = s.id
    LEFT JOIN invoices i ON dn.invoice_id = i.id
    WHERE 1=1 ${branchFilter.clause}
  `;
  let params = [...branchFilter.params];

  if (customer_id) {
    query += ' AND dn.customer_id = ?';
    params.push(customer_id);
  }
  if (date_from) {
    query += ' AND dn.delivery_date >= ?';
    params.push(date_from);
  }
  if (date_to) {
    query += ' AND dn.delivery_date <= ?';
    params.push(date_to);
  }
  if (status) {
    query += ' AND dn.status = ?';
    params.push(status);
  }
  if (invoice_id) {
    query += ' AND dn.invoice_id = ?';
    params.push(invoice_id);
  }

  query += ' ORDER BY dn.delivery_date DESC, dn.created_at DESC';

  try {
    const rows = await db.all(query, params);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching delivery notes:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get delivery note by ID
router.get('/:id', authenticate, requireBranchAccess(), async (req, res) => {
  const { id } = req.params;
  const branchFilter = getBranchFilter(req, 'dn');

  try {
    const row = await db.get(
      `SELECT dn.*, 
              c.name as customer_name, 
              c.phone as customer_phone,
              c.company_name,
              c.billing_address,
              c.billing_contact_name,
              c.billing_contact_phone,
              c.billing_contact_email,
              s.name as service_name,
              i.invoice_number
       FROM delivery_notes dn
       LEFT JOIN customers c ON dn.customer_id = c.id
       LEFT JOIN services s ON dn.service_id = s.id
       LEFT JOIN invoices i ON dn.invoice_id = i.id
       WHERE dn.id = ? ${branchFilter.clause}`,
      [id, ...branchFilter.params]
    );

    if (!row) {
      return res.status(404).json({ error: 'Delivery note not found' });
    }

    res.json(row);
  } catch (err) {
    console.error('Error fetching delivery note:', err);
    res.status(500).json({ error: err.message });
  }
});

// Create delivery note
router.post('/', authenticate, requireBranchAccess(), requirePermission('canCreateOrders'), async (req, res) => {
  const {
    customer_id,
    delivery_date,
    service_id,
    item_name,
    quantity,
    weight_kg,
    unit_price,
    total_amount,
    notes,
    delivered_by,
    received_by,
    order_id
  } = req.body;

  if (!customer_id || !delivery_date) {
    return res.status(400).json({ error: 'Customer ID and delivery date are required' });
  }

  const deliveryNumber = generateDeliveryNumber();
  const branchId = req.user?.branchId || null;

  try {
    // Verify customer exists and is monthly-billing or credit
    const customer = await db.get('SELECT id, billing_type FROM customers WHERE id = ?', [customer_id]);
    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    const calculatedTotal = (unit_price || 0) * (quantity || 1) + ((weight_kg || 0) * (unit_price || 0));
    const finalTotal = total_amount || calculatedTotal;

    const result = await db.run(
      `INSERT INTO delivery_notes (
        delivery_number, customer_id, delivery_date, service_id, item_name,
        quantity, weight_kg, unit_price, total_amount, notes,
        delivered_by, received_by, order_id, branch_id, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      [
        deliveryNumber,
        customer_id,
        delivery_date,
        service_id || null,
        item_name || null,
        quantity || 1,
        weight_kg || null,
        unit_price || 0,
        finalTotal,
        notes || null,
        delivered_by || null,
        received_by || null,
        order_id || null,
        branchId,
        req.user?.username || null
      ]
    );

    const deliveryNote = await db.get(
      `SELECT dn.*, c.name as customer_name, s.name as service_name 
       FROM delivery_notes dn
       LEFT JOIN customers c ON dn.customer_id = c.id
       LEFT JOIN services s ON dn.service_id = s.id
       WHERE dn.id = ?`,
      [result.lastID]
    );

    res.status(201).json(deliveryNote);
  } catch (err) {
    console.error('Error creating delivery note:', err);
    if (err.message && err.message.includes('UNIQUE')) {
      return res.status(400).json({ error: 'Delivery number already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

// Update delivery note
router.put('/:id', authenticate, requireBranchAccess(), requirePermission('canManageOrders'), async (req, res) => {
  const { id } = req.params;
  const {
    delivery_date,
    service_id,
    item_name,
    quantity,
    weight_kg,
    unit_price,
    total_amount,
    notes,
    delivered_by,
    received_by,
    status
  } = req.body;

  const branchFilter = getBranchFilter(req, 'dn');

  try {
    // Check if delivery note exists and belongs to branch
    const existing = await db.get(
      `SELECT id, invoice_id FROM delivery_notes WHERE id = ? ${branchFilter.clause}`,
      [id, ...branchFilter.params]
    );

    if (!existing) {
      return res.status(404).json({ error: 'Delivery note not found' });
    }

    // Don't allow editing if already invoiced
    if (existing.invoice_id) {
      return res.status(400).json({ error: 'Cannot edit delivery note that is already invoiced' });
    }

    const calculatedTotal = (unit_price || 0) * (quantity || 1) + ((weight_kg || 0) * (unit_price || 0));
    const finalTotal = total_amount !== undefined ? total_amount : calculatedTotal;

    await db.run(
      `UPDATE delivery_notes SET
        delivery_date = COALESCE(?, delivery_date),
        service_id = COALESCE(?, service_id),
        item_name = COALESCE(?, item_name),
        quantity = COALESCE(?, quantity),
        weight_kg = COALESCE(?, weight_kg),
        unit_price = COALESCE(?, unit_price),
        total_amount = COALESCE(?, total_amount),
        notes = COALESCE(?, notes),
        delivered_by = COALESCE(?, delivered_by),
        received_by = COALESCE(?, received_by),
        status = COALESCE(?, status)
      WHERE id = ? ${branchFilter.clause}`,
      [
        delivery_date,
        service_id,
        item_name,
        quantity,
        weight_kg,
        unit_price,
        finalTotal,
        notes,
        delivered_by,
        received_by,
        status,
        id,
        ...branchFilter.params
      ]
    );

    const updated = await db.get(
      `SELECT dn.*, c.name as customer_name, s.name as service_name 
       FROM delivery_notes dn
       LEFT JOIN customers c ON dn.customer_id = c.id
       LEFT JOIN services s ON dn.service_id = s.id
       WHERE dn.id = ?`,
      [id]
    );

    res.json(updated);
  } catch (err) {
    console.error('Error updating delivery note:', err);
    res.status(500).json({ error: err.message });
  }
});

// Delete/Cancel delivery note
router.delete('/:id', authenticate, requireBranchAccess(), requirePermission('canManageOrders'), async (req, res) => {
  const { id } = req.params;
  const branchFilter = getBranchFilter(req, 'dn');

  try {
    const existing = await db.get(
      `SELECT id, invoice_id FROM delivery_notes WHERE id = ? ${branchFilter.clause}`,
      [id, ...branchFilter.params]
    );

    if (!existing) {
      return res.status(404).json({ error: 'Delivery note not found' });
    }

    if (existing.invoice_id) {
      return res.status(400).json({ error: 'Cannot delete delivery note that is already invoiced' });
    }

    await db.run(
      `DELETE FROM delivery_notes WHERE id = ? ${branchFilter.clause}`,
      [id, ...branchFilter.params]
    );

    res.json({ success: true, message: 'Delivery note deleted' });
  } catch (err) {
    console.error('Error deleting delivery note:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
