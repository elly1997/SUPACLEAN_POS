const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const compression = require('compression');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

function normalizeOrigin(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function buildAllowedOrigins() {
  const values = [];
  const fromClientUrl = (process.env.CLIENT_URL || '')
    .split(',')
    .map((v) => normalizeOrigin(v))
    .filter(Boolean);
  const fromRenderExternal = normalizeOrigin(process.env.RENDER_EXTERNAL_URL);
  const fallbackLocal = ['http://localhost:3000'];
  values.push(...fromClientUrl);
  if (fromRenderExternal) values.push(fromRenderExternal);
  values.push(...fallbackLocal);
  return Array.from(new Set(values));
}

const allowedOrigins = buildAllowedOrigins();

// Compression middleware (should be early in the stack)
app.use(compression());

// Middleware
app.use(cors({
  origin: (origin, callback) => {
    // Allow non-browser tools (no Origin header) and explicitly configured origins.
    if (!origin) return callback(null, true);
    const normalized = normalizeOrigin(origin);
    if (allowedOrigins.includes(normalized)) return callback(null, true);
    return callback(new Error(`CORS blocked for origin: ${origin}`));
  },
  credentials: true
}));
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

// Set timeout for requests (30 seconds)
app.use((req, res, next) => {
  req.setTimeout(30000);
  res.setTimeout(30000);
  next();
});

// Log all requests for debugging (only in development)
if (process.env.NODE_ENV !== 'production') {
  app.use((req, res, next) => {
    console.log(`${req.method} ${req.path}`);
    next();
  });
}

// Initialize database: db.js uses PostgreSQL when DATABASE_URL is set (Render/Supabase), else SQLite (local)
require('./database/db');
// Ensure bank_accounts table exists in PostgreSQL (no-op for SQLite)
require('./database/ensureBankingSchema');
require('./database/ensureNotificationsDedupeKey');
require('./database/ensureBulkSmsAuditSchema');
// Ensure payroll and accounting control tables exist in PostgreSQL
require('./database/ensurePayrollSchema');
require('./database/ensureExpenseCategoriesSchema');
require('./database/ensureCleaningSchema');

// Routes - with error handling
try {
  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/branches', require('./routes/branches'));
  app.use('/api/users', require('./routes/users'));
  app.use('/api/customers', require('./routes/customers'));
  app.use('/api/orders', require('./routes/orders'));
  app.use('/api/services', require('./routes/services'));
  app.use('/api/items', require('./routes/items'));
  app.use('/api/transactions', require('./routes/transactions'));
  app.use('/api/reports', require('./routes/reports'));
  app.use('/api/settings', require('./routes/settings'));
  app.use('/api/expenses', require('./routes/expenses'));
  app.use('/api/payroll', require('./routes/payroll'));
  app.use('/api/cash-management', require('./routes/cashManagement'));
  app.use('/api/bank-accounts', require('./routes/bankAccounts'));
  app.use('/api/bank-deposits', require('./routes/bankDeposits'));
  app.use('/api/loyalty', require('./routes/loyalty'));
  app.use('/api/validation', require('./routes/validation'));
  app.use('/api/order-item-photos', require('./routes/orderItemPhotos'));
  app.use('/api/delivery-notes', require('./routes/deliveryNotes'));
  app.use('/api/bills', require('./routes/bills'));
  app.use('/api/invoices', require('./routes/invoices'));
  app.use('/api/cleaning-documents', require('./routes/cleaningDocuments'));
  app.use('/api/cleaning-customers', require('./routes/cleaningCustomers'));
  app.use('/api/cleaning-expenses', require('./routes/cleaningExpenses'));
  app.use('/api/admin', require('./routes/adminData'));
  console.log('✅ All routes loaded successfully');
} catch (error) {
  console.error('❌ Error loading routes:', error);
  console.error('Stack trace:', error.stack);
  process.exit(1);
}

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'SUPACLEAN POS API is running' });
});

// SMS config status (no secrets) – helps troubleshoot why SMS might not send
app.get('/api/sms-status', (req, res) => {
  const provider = (process.env.SMS_PROVIDER || 'africastalking').toLowerCase();
  const hasApiKey = !!(process.env.SMS_API_KEY || (provider === 'twilio' && process.env.TWILIO_AUTH_TOKEN));
  const hasUsername = !!(provider !== 'africastalking' || process.env.SMS_USERNAME);
  const configured = hasApiKey && (provider !== 'africastalking' || hasUsername);
  const hints = [];
  if (!hasApiKey) hints.push('Set SMS_API_KEY in .env (Africa\'s Talking) or TWILIO_AUTH_TOKEN (Twilio).');
  if (provider === 'africastalking' && !hasUsername) hints.push('Set SMS_USERNAME in .env (e.g. "sandbox" or your app username).');
  if (configured && provider === 'africastalking') {
    hints.push('If SMS still does not send: check Africa\'s Talking account has credit; sender ID may need to be approved for Tanzania.');
    hints.push('Check server logs when you trigger an SMS (e.g. mark order Ready) for the exact API error.');
  }
  res.json({ configured, provider, hasApiKey, hasUsername, hints });
});

// Serve uploaded files (item photos, etc.)
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
  const buildDir = path.join(__dirname, '../client/build');
  const fs = require('fs');
  if (!fs.existsSync(path.join(buildDir, 'index.html'))) {
    console.error('❌ Frontend build missing. Run Build Command: npm run build:render');
    console.error('   Expected: client/build/index.html');
  }
  app.use(express.static(buildDir));
  // SPA fallback: serve index.html for all non-API routes. Use no-cache so after a deploy
  // clients get the new bundle instead of 304 cached old JS (which can cause redirect/nav bugs).
  app.get('*', (req, res, next) => {
    const indexPath = path.join(buildDir, 'index.html');
    if (!fs.existsSync(indexPath)) {
      return res.status(503).json({
        error: 'Frontend not built. In Render, set Build Command to: npm run build:render',
        hint: 'Dashboard → Your Service → Settings → Build & Deploy → Build Command'
      });
    }
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.sendFile(indexPath);
  });
}

// Error handling middleware (must be after all routes)
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(err.status || 500).json({ 
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack })
  });
});

// Start server
const server = app.listen(PORT, () => {
  console.log(`🚀 SUPACLEAN POS Server running on port ${PORT}`);
  console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
});

// Handle server errors
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`❌ Port ${PORT} is already in use. Please kill the process or use a different port.`);
    console.error(`Run: npm run kill-port`);
    process.exit(1);
  } else {
    console.error('Server error:', err);
    process.exit(1);
  }
});

// Graceful shutdown handlers
function gracefulShutdown(signal) {
  console.log(`\n${signal} signal received: closing HTTP server`);
  server.close(() => {
    console.log('HTTP server closed');
    const db = require('./database/db');
    if (typeof db.close === 'function') {
      db.close((err) => {
        if (err) console.error('Error closing database:', err.message);
        else console.log('Database connection closed');
        process.exit(0);
      });
    } else {
      process.exit(0);
    }
  });
  
  // Force close after 10 seconds
  setTimeout(() => {
    console.error('Forcing shutdown after timeout');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  gracefulShutdown('uncaughtException');
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  gracefulShutdown('unhandledRejection');
});
