/**
 * Test Data Simulator
 * Generates 50+ realistic failed payment events and feeds them through
 * the Webhook Classifier & Recovery Engine pipeline.
 */

const { savePayment, addAuditLog, initDb, getStats, getAllPayments } = require('./db/database');
const { classifyFailure } = require('./classifier');
const { executeRecoveryAction, markAsRecovered } = require('./recoveryEngine');

// Mock data pools
const FIRST_NAMES = ['Rahul', 'Priya', 'Ananya', 'Vikram', 'Deepak', 'Neha', 'Rohan', 'Sneha', 'Amit', 'Kavita', 'Sanjay', 'Pooja', 'Aarav', 'Divya', 'Karan'];
const LAST_NAMES = ['Sharma', 'Patel', 'Verma', 'Singh', 'Kumar', 'Gupta', 'Mehta', 'Reddy', 'Joshi', 'Chawla', 'Deshmukh', 'Nair', 'Iyer', 'Bhasin'];
const DOMAINS = ['gmail.com', 'yahoo.com', 'outlook.com', 'company.in', 'techcorp.io'];

const FAILURE_SCENARIOS = [
  {
    error_code: 'INSUFFICIENT_FUNDS',
    error_description: 'Customer account has insufficient balance to authorize payment of transaction.',
    error_source: 'customer',
    error_step: 'payment_authorization',
    error_reason: 'insufficient_funds'
  },
  {
    error_code: 'BAD_REQUEST_PAYMENT_TIMED_OUT',
    error_description: 'Payment timed out waiting for response from issuing bank gateway.',
    error_source: 'issuer',
    error_step: 'payment_authorization',
    error_reason: 'payment_timed_out'
  },
  {
    error_code: 'BAD_REQUEST_PAYMENT_OTP_INCORRECT',
    error_description: 'Customer entered invalid OTP code during 3D Secure verification.',
    error_source: 'customer',
    error_step: 'payment_authentication',
    error_reason: 'payment_otp_incorrect'
  },
  {
    error_code: 'EXPIRED_CARD',
    error_description: 'The payment card presented has expired or has an invalid expiration date.',
    error_source: 'issuer',
    error_step: 'payment_authorization',
    error_reason: 'expired_card'
  },
  {
    error_code: 'GATEWAY_ERROR',
    error_description: 'Payment gateway encountered an internal communication error with card network.',
    error_source: 'gateway',
    error_step: 'payment_authorization',
    error_reason: 'gateway_error'
  }
];

const AMOUNTS = [499, 999, 1499, 2999, 4999, 8999, 12999, 19999, 24999, 35000];

function getRandomElement(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function getRandomPhone() {
  const prefix = getRandomElement(['98', '99', '97', '96', '95', '88', '87']);
  const number = Math.floor(1000000 + Math.random() * 9000000);
  return `+91${prefix}${number}`;
}

/**
 * Generate and process N simulated payment failures
 * @param {number} count Number of payments to simulate (default 50)
 */
async function runSimulation(count = 50) {
  console.log(`\n🚀 [TEST SIMULATOR] Launching simulation for ${count} payment events...`);
  
  // Ensure DB is initialized
  await initDb();

  const generatedPayments = [];

  for (let i = 0; i < count; i++) {
    const firstName = getRandomElement(FIRST_NAMES);
    const lastName = getRandomElement(LAST_NAMES);
    const customerName = `${firstName} ${lastName}`;
    const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}${Math.floor(Math.random() * 99)}@${getRandomElement(DOMAINS)}`;
    const phone = getRandomPhone();
    
    const scenario = getRandomElement(FAILURE_SCENARIOS);
    const amount = getRandomElement(AMOUNTS);
    const timestamp = Date.now() - Math.floor(Math.random() * 86400000); // within last 24 hours
    const paymentId = `pay_sim_${Date.now().toString(36)}${Math.random().toString(36).substr(2, 5)}`;
    const orderId = `order_${Math.floor(100000 + Math.random() * 900000)}`;

    const paymentData = {
      payment_id: paymentId,
      order_id: orderId,
      customer_name: customerName,
      customer_email: email,
      customer_phone: phone,
      amount: amount,
      currency: 'INR',
      error_code: scenario.error_code,
      error_description: scenario.error_description,
      error_source: scenario.error_source,
      error_step: scenario.error_step,
      error_reason: scenario.error_reason,
      status: 'failed',
      created_at: new Date(timestamp).toISOString()
    };

    // 1. Save payment record
    const saved = savePayment(paymentData);

    // 2. Classify failure
    const classification = classifyFailure(saved);

    // 3. Execute recovery action
    await executeRecoveryAction(saved, classification);

    generatedPayments.push(paymentId);
  }

  // Simulate realistic outcomes for a subset of generated payments
  // (35% to 45% get recovered over time to simulate active recovery)
  const recoveryTargetCount = Math.floor(count * (0.35 + Math.random() * 0.15));
  console.log(`🎯 [SIMULATOR AGENT ACTION] Simulating active recoveries for ${recoveryTargetCount} payments...`);

  for (let i = 0; i < recoveryTargetCount; i++) {
    const targetPaymentId = generatedPayments[i];
    const recoverSource = Math.random() > 0.5 ? 'PAYMENT_LINK_CLICK' : 'AUTO_RETRY_SUCCESS';
    markAsRecovered(targetPaymentId, recoverSource);
  }

  // Simulate a few reaching max retries (gave up)
  const gaveUpCount = Math.floor(count * 0.1);
  const allPayments = getAllPayments({ limit: count });
  for (let i = recoveryTargetCount; i < recoveryTargetCount + gaveUpCount; i++) {
    if (allPayments[i]) {
      savePayment({
        payment_id: allPayments[i].payment_id,
        status: 'gave_up',
        retry_count: 3
      });
      addAuditLog(
        allPayments[i].payment_id,
        'MAX_RETRIES_EXCEEDED',
        'Stopping Rule: Reached max retries limit of 3 attempts.',
        {}
      );
    }
  }

  const finalStats = getStats();
  console.log(`\n======================================================`);
  console.log(`📊 [SIMULATION COMPLETED SUMMARY]`);
  console.log(`Total Failed Payments:  ${finalStats.total_failed_count}`);
  console.log(`Revenue At Risk:        ₹${finalStats.total_at_risk_amount.toLocaleString('en-IN')}`);
  console.log(`Total Recovered:        ₹${finalStats.total_recovered_amount.toLocaleString('en-IN')}`);
  console.log(`Recovery Rate:          ${finalStats.recovery_rate_pct}%`);
  console.log(`======================================================\n`);

  return {
    success: true,
    simulated_count: count,
    recovered_count: finalStats.recovered_count,
    stats: finalStats
  };
}

// Allow CLI execution if called directly
if (require.main === module) {
  const args = process.argv.slice(2);
  const count = parseInt(args[0] || '50', 10);
  runSimulation(count)
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Simulation error:', err);
      process.exit(1);
    });
}

module.exports = {
  runSimulation
};
