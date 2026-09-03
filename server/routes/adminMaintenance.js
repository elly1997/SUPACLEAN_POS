/**

 * Admin maintenance: DB health, table growth stats, archive guidance.

 */

const crypto = require('crypto');

const express = require('express');

const router = express.Router();

const db = require('../database/query');

const { authenticate, requireRole } = require('../middleware/auth');

const { getBusinessTodayYmd } = require('../utils/businessDate');

const { parseArchiveOptions, archiveOldOrders } = require('../utils/archiveOldOrders');

const { processDueGoogleReviewRequests } = require('../utils/googleReviewRequests');

const { countDuplicateNormalizedPhones } = require('../database/ensureLongevitySchema');



function safeSecretEqual(provided, expected) {

  if (!provided || !expected) return false;

  const a = Buffer.from(String(provided));

  const b = Buffer.from(String(expected));

  if (a.length !== b.length) return false;

  return crypto.timingSafeEqual(a, b);

}



/**

 * Scheduled archive for Render cron (no session auth — uses CRON_SECRET only).

 * Set CRON_SECRET in env; send header X-Cron-Secret. Body: { months?, execute? }.

 */

router.post('/cron/archive-old', async (req, res) => {

  const secret = req.headers['x-cron-secret'];

  if (!safeSecretEqual(secret, process.env.CRON_SECRET)) {

    return res.status(401).json({ error: 'Unauthorized' });

  }



  const execute = req.body?.execute === true || req.body?.execute === 'true';

  const options = parseArchiveOptions({

    months: req.body?.months,

    dry_run: !execute,

    archive_reason: req.body?.archive_reason || 'Scheduled monthly archive',

    archived_by: 'Cron',

  });



  try {

    const result = await archiveOldOrders({ clause: '', params: [] }, options);

    res.json(result);

  } catch (err) {

    console.error('cron archive-old error:', err);

    res.status(500).json({ error: err.message });

  }

});



/**

 * Scheduled Google review requests (CRON_SECRET). Sends SMS/WhatsApp ~24h after collection.

 * Body: { dry_run?: boolean, limit?: number }

 */

router.post('/cron/google-review-requests', async (req, res) => {

  const secret = req.headers['x-cron-secret'];

  if (!safeSecretEqual(secret, process.env.CRON_SECRET)) {

    return res.status(401).json({ error: 'Unauthorized' });

  }



  try {

    const result = await processDueGoogleReviewRequests({

      dry_run: req.body?.dry_run === true || req.body?.dry_run === 'true',

      limit: req.body?.limit,

    });

    res.json(result);

  } catch (err) {

    console.error('cron google-review-requests error:', err);

    res.status(500).json({ error: err.message });

  }

});



router.use(authenticate, requireRole('admin'));



router.get('/health', async (req, res) => {

  const started = Date.now();

  try {

    await db.get('SELECT 1 AS ok', []);

    const latencyMs = Date.now() - started;

    res.json({

      status: 'OK',

      database: 'connected',

      latency_ms: latencyMs,

      checked_at: new Date().toISOString(),

    });

  } catch (err) {

    res.status(503).json({

      status: 'DEGRADED',

      database: 'unreachable',

      error: err.message,

      checked_at: new Date().toISOString(),

    });

  }

});



router.get('/stats', async (req, res) => {

  try {

    const [

      orders,

      activeOrders,

      archivedOrders,

      customers,

      transactions,

      cashSummaries,

      phoneDupes,

    ] = await Promise.all([

      db.get('SELECT COUNT(*) AS n FROM orders', []),

      db.get(

        `SELECT COUNT(*) AS n FROM orders

         WHERE archived_at IS NULL AND COALESCE(is_voided, FALSE) = FALSE`,

        []

      ),

      db.get('SELECT COUNT(*) AS n FROM orders WHERE archived_at IS NOT NULL', []),

      db.get('SELECT COUNT(*) AS n FROM customers', []),

      db.get('SELECT COUNT(*) AS n FROM transactions', []),

      db.get('SELECT COUNT(*) AS n FROM daily_cash_summaries', []),

      countDuplicateNormalizedPhones().catch(() => ({ groups: 0, extra_rows: 0 })),

    ]);



    const archiveCandidates = await db.get(

      `SELECT COUNT(*) AS items, COUNT(DISTINCT UPPER(receipt_number)) AS receipts

       FROM orders

       WHERE archived_at IS NULL

         AND (status = 'collected' OR COALESCE(is_voided, FALSE) = TRUE)

         AND COALESCE(collected_date, voided_at, order_date) < (CURRENT_TIMESTAMP - INTERVAL '7 months')`,

      []

    );



    res.json({

      as_of: getBusinessTodayYmd(),

      counts: {

        orders_total: Number(orders?.n || 0),

        orders_active: Number(activeOrders?.n || 0),

        orders_archived: Number(archivedOrders?.n || 0),

        customers: Number(customers?.n || 0),

        transactions: Number(transactions?.n || 0),

        daily_cash_summaries: Number(cashSummaries?.n || 0),

      },

      archive_candidates_7mo: {

        items: Number(archiveCandidates?.items || 0),

        receipts: Number(archiveCandidates?.receipts || 0),

      },

      duplicate_phones: phoneDupes,

      recommendations: [

        'Run POST /api/orders/archive-old monthly (dry_run first) or POST /api/admin/maintenance/archive-old.',

        phoneDupes.groups > 0

          ? `Merge ${phoneDupes.groups} duplicate phone group(s) before enforcing unique phone_normalized index.`

          : 'Customer phone deduplication index is healthy.',

        'Optional Render cron: set CRON_SECRET and ARCHIVE_EXECUTE=true on supaclean-monthly-archive.',

        'Reconcile cash daily; unreconciled days trigger background refresh only.',

        'Use Supabase connection pooler URL and schedule weekly DB backups.',

      ],

    });

  } catch (err) {

    console.error('admin maintenance stats error:', err);

    res.status(500).json({ error: err.message });

  }

});



/** Preview or run monthly archive (defaults to dry_run preview). All branches when no branch filter. */

router.post('/archive-old', async (req, res) => {

  const options = parseArchiveOptions({

    ...req.body,

    dry_run: req.body?.dry_run !== false && req.body?.dry_run !== 'false',

    archived_by: req.user?.fullName || req.user?.username || 'Admin',

  });



  try {

    const result = await archiveOldOrders({ clause: '', params: [] }, options);

    res.json(result);

  } catch (err) {

    console.error('admin archive-old error:', err);

    res.status(500).json({ error: err.message });

  }

});



module.exports = router;

