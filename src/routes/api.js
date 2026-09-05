const express = require('express');
const router = express.Router();
const { 
  getStats, 
  getAllPayments, 
  getPaymentById, 
  getAuditLogs, 
  resetDb,
  savePayment
} = require('../db/database');
const { markAsRecovered, executeRecoveryAction } = require('../recoveryEngine');
const { classifyFailure } = require('../classifier');
const { runSimulation } = require('../simulator');

/**
 * GET /api/stats
 * Aggregate metrics: total failed, revenue at risk, total recovered, recovery rate %
 */
router.get('/stats', (req, res) => {
  try {
    const stats = getStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/payments
 * Query failed payments list with filters
 */
router.get('/payments', (req, res) => {
  try {
    const { status, category, limit } = req.query;
    const payments = getAllPayments({ 
      status, 
      category, 
      limit: parseInt(limit || '100', 10) 
    });
    res.json(payments);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/payments/:id
 * Get single payment detail & audit trail history
 */
router.get('/payments/:id', (req, res) => {
  try {
    const payment = getPaymentById(req.params.id);
    if (!payment) {
      return res.status(404).json({ error: 'Payment not found' });
    }
    const auditLogs = getAuditLogs(100).filter(log => log.payment_id === req.params.id);
    res.json({ payment, audit_logs: auditLogs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/audit-logs
 * Fetch global audit trail log entries
 */
router.get('/audit-logs', (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '50', 10);
    const logs = getAuditLogs(limit);
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/payments/:id/simulate-pay
 * Simulate customer paying via Razorpay Payment Link or auto-retry success
 */
router.all('/payments/:id/simulate-pay', (req, res) => {
  try {
    const paymentId = req.params.id;
    const updated = markAsRecovered(paymentId, 'CUSTOMER_PAYMENT_LINK_CLICK');
    
    if (req.accepts('html')) {
      return res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Payment Successful - Razorpay Recovery Agent</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #0f172a; color: white; text-align: center; margin: 0; }
            .card { background: #1e293b; padding: 40px; border-radius: 16px; border: 1px solid #334155; max-width: 480px; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5); }
            .icon { font-size: 64px; margin-bottom: 16px; }
            h1 { color: #38bdf8; margin: 0 0 10px 0; }
            p { color: #94a3b8; font-size: 16px; line-height: 1.5; }
            .btn { display: inline-block; margin-top: 20px; background: #0284c7; color: white; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 600; }
            .btn:hover { background: #0369a1; }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="icon">✅</div>
            <h1>Payment Recovered!</h1>
            <p>Payment ID <strong>${paymentId}</strong> for ₹${updated ? updated.amount : ''} has been successfully completed and recorded by the AI Recovery Agent.</p>
            <a href="/" class="btn">Return to Recovery Dashboard</a>
          </div>
        </body>
        </html>
      `);
    }

    res.json({ success: true, payment: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/payments/:id/retry
 * Manually trigger agent recovery action for a payment
 */
router.post('/payments/:id/retry', async (req, res) => {
  try {
    const payment = getPaymentById(req.params.id);
    if (!payment) return res.status(404).json({ error: 'Payment not found' });

    const classification = classifyFailure(payment);
    const result = await executeRecoveryAction(payment, classification);
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/simulate
 * Run test data simulator to generate 50+ realistic failed payment events
 */
router.post('/simulate', async (req, res) => {
  try {
    const count = parseInt(req.body.count || req.query.count || '50', 10);
    const result = await runSimulation(count);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/reset
 * Reset DB records for clean hackathon demo
 */
router.post('/reset', (req, res) => {
  try {
    resetDb();
    res.json({ success: true, message: 'Database reset successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
