const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const compression = require('compression');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Compression middleware (should be early in the stack)
app.use(compression());

// Middleware
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:3000',
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

// Initialize database: use PostgreSQL when DATABASE_URL is set (e.g. Render, production); otherwise SQLite (local dev)
if (!process.env.DATABASE_URL) {
  require('./database/init');
}

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
  app.use('/api/cash-management', require('./routes/cashManagement'));
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

// Serve uploaded files (item photos, etc.)
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../client/build')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/build', 'index.html'));
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
    if (!process.env.DATABASE_URL) {
      const db = require('./database/init');
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
