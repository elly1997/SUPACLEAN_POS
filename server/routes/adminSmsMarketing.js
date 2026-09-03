const express = require('express');
const router = express.Router();
const db = require('../database/query');
const { authenticate, requireRole } = require('../middleware/auth');
const { isPlaceholderPhone } = require('../utils/customerPhone');
const { sendSMS } = require('../utils/sms');

function toBool(value, defaultValue = true) {
  if (value === undefined || value === null) return defaultValue;
  const s = String(value).toLowerCase().trim();
  if (['1', 'true', 'yes', 'on', 'enabled'].includes(s)) return true;
  if (['0', 'false', 'no', 'off', 'disabled'].includes(s)) return false;
  return defaultValue;
}

async function dbGetAsync(sql, params = []) {
  const ret = db.get(sql, params);
  if (ret && typeof ret.then === 'function') return ret;
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

async function getGlobalSmsSendingEnabled() {
  const row = await dbGetAsync('SELECT setting_value FROM settings WHERE setting_key = ?', ['sms_sending_enabled']);
  return toBool(row?.setting_value, true);
}

async function setGlobalSmsSendingEnabled(enabled, description = null) {
  const settingValue = enabled ? 'true' : 'false';
  const res = await db.run(
    'UPDATE settings SET setting_value = ?, updated_at = CURRENT_TIMESTAMP WHERE setting_key = ?',
    [settingValue, 'sms_sending_enabled']
  );

  if (res?.changes === 0) {
    await db.run(
      'INSERT INTO settings (setting_key, setting_value, description) VALUES (?, ?, ?)',
      ['sms_sending_enabled', settingValue, description || 'Globally allow SMS sending to customers']
    );
  }
}

function applyTemplateVars(template, vars = {}) {
  const t = String(template || '');
  return t.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (m, key) => {
    const k = String(key).trim();
    return vars[k] ?? vars[k.toLowerCase()] ?? '';
  });
}

function normalizeAudienceTags(tags) {
  if (!tags) return [];
  if (Array.isArray(tags)) return tags.map((t) => String(t).trim()).filter(Boolean);
  const s = String(tags).trim();
  if (!s) return [];
  return s
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

router.use(authenticate, requireRole('admin'));

// Global SMS on/off switch (admin only)
router.get('/status', async (req, res) => {
  try {
    const smsSendingEnabled = await getGlobalSmsSendingEnabled();
    res.json({ smsSendingEnabled });
  } catch (err) {
    console.error('SMS marketing status error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.put('/suppress', async (req, res) => {
  try {
    const enabled = req.body?.enabled;
    if (enabled === undefined) return res.status(400).json({ error: 'Body must include { enabled: boolean }' });
    await setGlobalSmsSendingEnabled(toBool(enabled), 'Globally disable/enable SMS sending to customers');
    const smsSendingEnabled = await getGlobalSmsSendingEnabled();
    res.json({ smsSendingEnabled });
  } catch (err) {
    console.error('SMS suppress update error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Templates
router.get('/templates', async (req, res) => {
  try {
    const rows = await db.all(
      `SELECT id, name, message, is_active, created_at, updated_at
       FROM sms_marketing_templates
       ORDER BY created_at DESC`,
      []
    );
    res.json(rows || []);
  } catch (err) {
    console.error('SMS templates list error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/templates', async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    const message = String(req.body?.message || '').trim();
    const is_active = req.body?.is_active === undefined ? 1 : (toBool(req.body.is_active) ? 1 : 0);

    if (!name || !message) return res.status(400).json({ error: 'Both { name, message } are required' });

    const result = await db.run(
      `INSERT INTO sms_marketing_templates (name, message, is_active)
       VALUES (?, ?, ?) RETURNING id`,
      [name, message, is_active]
    );

    const id = result?.row?.id ?? result?.lastID;
    res.status(201).json({ id });
  } catch (err) {
    console.error('SMS template create error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.put('/templates/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const name = req.body?.name !== undefined ? String(req.body.name || '').trim() : null;
    const message = req.body?.message !== undefined ? String(req.body.message || '').trim() : null;
    const is_active =
      req.body?.is_active === undefined ? null : (toBool(req.body.is_active) ? 1 : 0);

    if (name === null && message === null && is_active === null) {
      return res.status(400).json({ error: 'Provide at least one field: name, message, is_active' });
    }

    const sets = [];
    const params = [];
    if (name !== null) { sets.push('name = ?'); params.push(name); }
    if (message !== null) { sets.push('message = ?'); params.push(message); }
    if (is_active !== null) { sets.push('is_active = ?'); params.push(is_active); }

    params.push(id);

    const result = await db.run(
      `UPDATE sms_marketing_templates SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      params
    );
    if (result?.changes === 0) return res.status(404).json({ error: 'Template not found' });

    res.json({ ok: true });
  } catch (err) {
    console.error('SMS template update error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Marketing send
router.post('/send', async (req, res) => {
  try {
    const templateId = req.body?.template_id;
    const tags = normalizeAudienceTags(req.body?.tags || req.body?.tag);
    const audienceAll = !!req.body?.audience_all;
    const dryRun = req.body?.dry_run === true || req.body?.dry_run === 'true';
    const limit = Math.min(500, Math.max(1, parseInt(req.body?.limit || '200', 10) || 200));
    const campaignName = String(req.body?.name || 'SMS marketing campaign').trim();

    if (!templateId) return res.status(400).json({ error: 'template_id is required' });
    if (!audienceAll && tags.length === 0) {
      return res.status(400).json({ error: 'Provide either { audience_all: true } or { tags: [...] }' });
    }

    const template = await db.get(
      `SELECT id, name, message, is_active
       FROM sms_marketing_templates
       WHERE id = ?`,
      [templateId]
    );
    if (!template) return res.status(404).json({ error: 'Template not found' });
    if (template.is_active !== 1 && template.is_active !== true) {
      return res.status(400).json({ error: 'Template is not active' });
    }

    const createdBy = req.user?.fullName || req.user?.username || 'Admin';
    const audienceTagsString = tags.length > 0 ? tags.join(',') : null;

    const campaignInsert = await db.run(
      `INSERT INTO sms_marketing_campaigns
         (name, template_id, audience_tags, audience_all, recipient_count, status, dry_run, created_by)
       VALUES
         (?, ?, ?, ?, 0, ?, ?, ?) RETURNING id`,
      [
        campaignName,
        templateId,
        audienceTagsString,
        audienceAll ? 1 : 0,
        dryRun ? 'dry_run' : 'sending',
        dryRun ? 1 : 0,
        createdBy,
      ]
    );
    const campaignId = campaignInsert?.row?.id ?? campaignInsert?.lastID;

    // Eligible recipients (customer opt-out + valid phone).
    let query = `
      SELECT id, name, phone
      FROM customers
      WHERE sms_notifications_enabled != 0
        AND phone IS NOT NULL
        AND TRIM(phone) <> ''
        AND phone NOT LIKE 'NO-PHONE:%'
    `;
    const params = [];

    if (!audienceAll && tags.length > 0) {
      const tagClauses = tags.map(() => 'LOWER(COALESCE(tags, \'\')) LIKE ?').join(' OR ');
      query += ` AND (${tagClauses})`;
      tags.forEach((t) => params.push(`%${String(t).toLowerCase()}%`));
    }

    query += ` ORDER BY id ASC LIMIT ?`;
    params.push(limit);

    const recipients = await db.all(query, params);

    if (!recipients || recipients.length === 0) {
      await db.run(
        `UPDATE sms_marketing_campaigns
         SET recipient_count = 0, status = 'completed', updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [campaignId]
      );
      return res.json({ campaign_id: campaignId, recipient_count: 0 });
    }

    const recipientCount = recipients.length;

    if (dryRun) {
      await db.run(
        `UPDATE sms_marketing_campaigns
         SET recipient_count = ?, status = 'dry_run', updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [recipientCount, campaignId]
      );
      return res.json({ campaign_id: campaignId, dry_run: true, recipient_count: recipientCount });
    }

    let sentCount = 0;
    let suppressedCount = 0;
    let skippedDuplicateCount = 0;
    let failedCount = 0;

    for (const customer of recipients) {
      const phone = customer?.phone;
      if (!phone || isPlaceholderPhone(phone)) continue;

      const message = applyTemplateVars(template.message, {
        name: customer.name,
        customer_name: customer.name,
      });

      const result = await sendSMS(phone, message, {
        customerId: customer.id,
        notificationType: 'sms_marketing',
        dedupeKey: `campaign:${campaignId}`,
      });

      if (result?.smsSuppressed) {
        suppressedCount += 1;
      } else if (result?.skippedDuplicate) {
        skippedDuplicateCount += 1;
      } else if (result?.success) {
        sentCount += 1;
      } else {
        failedCount += 1;
      }
    }

    await db.run(
      `UPDATE sms_marketing_campaigns
       SET recipient_count = ?,
           sent_count = ?,
           suppressed_count = ?,
           skipped_duplicate_count = ?,
           failed_count = ?,
           status = 'completed',
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [recipientCount, sentCount, suppressedCount, skippedDuplicateCount, failedCount, campaignId]
    );

    res.json({
      campaign_id: campaignId,
      recipient_count: recipientCount,
      sent_count: sentCount,
      suppressed_count: suppressedCount,
      skipped_duplicate_count: skippedDuplicateCount,
      failed_count: failedCount,
    });
  } catch (err) {
    console.error('SMS marketing send error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

