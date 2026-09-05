require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDb } = require('./db/database');
const webhookRoutes = require('./routes/webhook');
const apiRoutes = require('./routes/api');
const { processDueRetries } = require('./recoveryEngine');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend dashboard
app.use(express.static(path.join(__dirname, '../public')));

// Mount API & Webhook Routes
app.use('/api/webhooks', webhookRoutes);
app.use('/api', apiRoutes);

// Fallback index.html route for SPA
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'API endpoint not found' });
  }
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Initialize DB and start server
async function startServer() {
  await initDb();

  // Start background worker for due retries (runs every 15 seconds)
  setInterval(() => {
    processDueRetries().catch((err) => {
      console.error('Error in background retry worker:', err.message);
    });
  }, 15000);

  const server = app.listen(PORT, () => {
    console.log(`\n======================================================`);
    console.log(`⚡ Razorpay Payment Failure Recovery Agent Server`);
    console.log(`🌐 Dashboard running at: http://localhost:${PORT}`);
    console.log(`📥 Webhook endpoint:     http://localhost:${PORT}/api/webhooks/razorpay`);
    console.log(`======================================================\n`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n❌ Port ${PORT} is already in use by another process.`);
      console.error(`👉 Solution: Stop the running process on port ${PORT}, or change PORT in your .env file.\n`);
      process.exit(1);
    } else {
      console.error('Server error:', err);
    }
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
});
