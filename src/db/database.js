const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const isVercel = process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME;
const DB_FILE = isVercel
  ? path.join('/tmp', 'recovery_agent.sqlite')
  : path.join(__dirname, '../../recovery_agent.sqlite');

let db = null;

/**
 * Persist SQLite database buffer to disk file
 */
function saveDbToDisk() {
  if (!db) return;
  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_FILE, buffer);
  } catch (err) {
    // Ignore disk write errors in strict read-only environment
  }
}

/**
 * Initialize SQLite database connection and schema
 */
async function initDb() {
  if (db) return db; // Idempotent check

  try {
    let wasmDirectory;
    try {
      wasmDirectory = path.dirname(require.resolve('sql.js'));
    } catch (e) {
      wasmDirectory = path.join(process.cwd(), 'node_modules/sql.js/dist');
    }

    const SQL = await initSqlJs({
      locateFile: file => {
        const p1 = path.join(wasmDirectory, file);
        if (fs.existsSync(p1)) return p1;
        const p2 = path.join(process.cwd(), 'node_modules/sql.js/dist', file);
        if (fs.existsSync(p2)) return p2;
        return file;
      }
    });

    if (fs.existsSync(DB_FILE)) {
      try {
        const filebuffer = fs.readFileSync(DB_FILE);
        db = new SQL.Database(filebuffer);
      } catch (e) {
        db = new SQL.Database();
      }
    } else {
      db = new SQL.Database();
    }
  } catch (err) {
    console.warn('⚠️ SQL.js fallback initialization:', err.message);
    const SQL = await initSqlJs();
    db = new SQL.Database();
  }

  // Create tables
  db.run(`
    CREATE TABLE IF NOT EXISTS failed_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      payment_id TEXT UNIQUE NOT NULL,
      order_id TEXT,
      customer_name TEXT,
      customer_email TEXT,
      customer_phone TEXT,
      amount REAL NOT NULL,
      currency TEXT DEFAULT 'INR',
      error_code TEXT,
      error_description TEXT,
      error_source TEXT,
      error_step TEXT,
      error_reason TEXT,
      category TEXT,
      status TEXT DEFAULT 'failed',
      retry_count INTEGER DEFAULT 0,
      max_retries INTEGER DEFAULT 3,
      next_retry_at TEXT,
      payment_link_id TEXT,
      payment_link_url TEXT,
      recovered_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS audit_trail (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      payment_id TEXT NOT NULL,
      action TEXT NOT NULL,
      reason TEXT,
      details TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  saveDbToDisk();
  console.log('✅ SQLite Database initialized successfully.');
}

/**
 * Save or update a failed payment record
 */
function savePayment(p) {
  const now = new Date().toISOString();

  // Check if payment already exists
  const existing = getPaymentById(p.payment_id);
  if (existing) {
    db.run(
      `UPDATE failed_payments SET 
        order_id = ?, customer_name = ?, customer_email = ?, customer_phone = ?,
        amount = ?, error_code = ?, error_description = ?, error_source = ?,
        error_step = ?, error_reason = ?, category = ?, status = ?,
        retry_count = ?, max_retries = ?, next_retry_at = ?, payment_link_id = ?,
        payment_link_url = ?, recovered_at = ?, updated_at = ?
      WHERE payment_id = ?`,
      [
        p.order_id || existing.order_id,
        p.customer_name || existing.customer_name,
        p.customer_email || existing.customer_email,
        p.customer_phone || existing.customer_phone,
        p.amount !== undefined ? p.amount : existing.amount,
        p.error_code || existing.error_code,
        p.error_description || existing.error_description,
        p.error_source || existing.error_source,
        p.error_step || existing.error_step,
        p.error_reason || existing.error_reason,
        p.category || existing.category,
        p.status || existing.status,
        p.retry_count !== undefined ? p.retry_count : existing.retry_count,
        p.max_retries !== undefined ? p.max_retries : existing.max_retries,
        p.next_retry_at || existing.next_retry_at,
        p.payment_link_id || existing.payment_link_id,
        p.payment_link_url || existing.payment_link_url,
        p.recovered_at || existing.recovered_at,
        now,
        p.payment_id
      ]
    );
  } else {
    db.run(
      `INSERT INTO failed_payments (
        payment_id, order_id, customer_name, customer_email, customer_phone,
        amount, currency, error_code, error_description, error_source,
        error_step, error_reason, category, status, retry_count,
        max_retries, next_retry_at, payment_link_id, payment_link_url,
        recovered_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        p.payment_id,
        p.order_id || `order_${Date.now()}`,
        p.customer_name || 'Valued Customer',
        p.customer_email || 'customer@example.com',
        p.customer_phone || '+919876543210',
        p.amount || 0,
        p.currency || 'INR',
        p.error_code || 'BAD_REQUEST_ERROR',
        p.error_description || 'Payment failure',
        p.error_source || 'issuer',
        p.error_step || 'payment_authorization',
        p.error_reason || 'payment_failed',
        p.category || 'unknown',
        p.status || 'failed',
        p.retry_count || 0,
        p.max_retries || 3,
        p.next_retry_at || null,
        p.payment_link_id || null,
        p.payment_link_url || null,
        p.recovered_at || null,
        p.created_at || now,
        now
      ]
    );
  }

  saveDbToDisk();
  return getPaymentById(p.payment_id);
}

/**
 * Fetch payment by payment_id
 */
function getPaymentById(paymentId) {
  const stmt = db.prepare(`SELECT * FROM failed_payments WHERE payment_id = ?`);
  stmt.bind([paymentId]);
  let result = null;
  if (stmt.step()) {
    result = stmt.getAsObject();
  }
  stmt.free();
  return result;
}

/**
 * Get all failed payments with optional filters
 */
function getAllPayments({ status, category, limit = 100 } = {}) {
  let query = `SELECT * FROM failed_payments WHERE 1=1`;
  const params = [];

  if (status) {
    query += ` AND status = ?`;
    params.push(status);
  }
  if (category) {
    query += ` AND category = ?`;
    params.push(category);
  }

  query += ` ORDER BY id DESC LIMIT ?`;
  params.push(limit);

  const stmt = db.prepare(query);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

/**
 * Log action to audit_trail
 */
function addAuditLog(paymentId, action, reason, details = {}) {
  const now = new Date().toISOString();
  const detailsStr = typeof details === 'string' ? details : JSON.stringify(details);
  db.run(
    `INSERT INTO audit_trail (payment_id, action, reason, details, created_at) VALUES (?, ?, ?, ?, ?)`,
    [paymentId, action, reason, detailsStr, now]
  );
  saveDbToDisk();
}

/**
 * Fetch recent audit trail entries
 */
function getAuditLogs(limit = 50) {
  const stmt = db.prepare(
    `SELECT a.*, p.customer_name, p.amount 
     FROM audit_trail a
     LEFT JOIN failed_payments p ON a.payment_id = p.payment_id
     ORDER BY a.id DESC LIMIT ?`
  );
  stmt.bind([limit]);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

/**
 * Calculate aggregate recovery stats for dashboard KPI cards
 */
function getStats() {
  const totalStmt = db.prepare(`
    SELECT 
      COUNT(*) as total_count,
      COALESCE(SUM(amount), 0) as total_at_risk,
      COALESCE(SUM(CASE WHEN status = 'recovered' THEN amount ELSE 0 END), 0) as total_recovered,
      COALESCE(SUM(CASE WHEN status = 'recovered' THEN 1 ELSE 0 END), 0) as recovered_count,
      COALESCE(SUM(CASE WHEN status = 'recovering' THEN 1 ELSE 0 END), 0) as recovering_count,
      COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) as failed_pending_count,
      COALESCE(SUM(CASE WHEN status = 'gave_up' THEN 1 ELSE 0 END), 0) as gave_up_count
    FROM failed_payments
  `);
  totalStmt.step();
  const totals = totalStmt.getAsObject();
  totalStmt.free();

  const recoveryRate = totals.total_count > 0 
    ? ((totals.recovered_count / totals.total_count) * 100).toFixed(1)
    : 0;

  // Breakdown by failure category
  const catStmt = db.prepare(`
    SELECT 
      category,
      COUNT(*) as total_count,
      COALESCE(SUM(amount), 0) as total_amount,
      COALESCE(SUM(CASE WHEN status = 'recovered' THEN 1 ELSE 0 END), 0) as recovered_count,
      COALESCE(SUM(CASE WHEN status = 'recovered' THEN amount ELSE 0 END), 0) as recovered_amount
    FROM failed_payments
    GROUP BY category
  `);
  const categories = [];
  while (catStmt.step()) {
    categories.push(catStmt.getAsObject());
  }
  catStmt.free();

  return {
    total_failed_count: totals.total_count,
    total_at_risk_amount: Math.round(totals.total_at_risk),
    total_recovered_amount: Math.round(totals.total_recovered),
    recovered_count: totals.recovered_count,
    recovering_count: totals.recovering_count,
    failed_pending_count: totals.failed_pending_count,
    gave_up_count: totals.gave_up_count,
    recovery_rate_pct: parseFloat(recoveryRate),
    category_breakdown: categories
  };
}

/**
 * Reset database (Clear all records for fresh demo runs)
 */
function resetDb() {
  db.run(`DELETE FROM failed_payments;`);
  db.run(`DELETE FROM audit_trail;`);
  saveDbToDisk();
  console.log('🔄 Database reset complete.');
}

module.exports = {
  initDb,
  savePayment,
  getPaymentById,
  getAllPayments,
  addAuditLog,
  getAuditLogs,
  getStats,
  resetDb
};
