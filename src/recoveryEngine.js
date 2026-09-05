/**
 * Recovery Action Engine
 * Executes recovery actions based on failure classification and enforces stopping rules.
 */

const Razorpay = require('razorpay');
const { savePayment, addAuditLog, getPaymentById, getAllPayments } = require('./db/database');

// Initialize Razorpay SDK if keys exist in environment
let razorpayInstance = null;
if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
  try {
    razorpayInstance = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET
    });
    console.log('🔑 Razorpay SDK initialized with provided API keys.');
  } catch (err) {
    console.warn('⚠️ Razorpay SDK initialization warning:', err.message);
  }
} else {
  console.log('ℹ️ Running in Mock Razorpay Mode. (Add keys to .env to use live Razorpay Test API)');
}

/**
 * Main entry point for recovering a failed payment
 * @param {Object} payment - Payment record
 * @param {Object} classification - Output from Failure Classifier
 */
async function executeRecoveryAction(payment, classification) {
  const maxRetries = payment.max_retries || parseInt(process.env.MAX_RETRIES || '3', 10);

  // Check Stopping Rules
  if (payment.retry_count >= maxRetries) {
    console.log(`🛑 [STOPPING RULE] Payment ${payment.payment_id} reached max retries (${maxRetries}). Giving up.`);
    
    savePayment({
      payment_id: payment.payment_id,
      status: 'gave_up',
      next_retry_at: null
    });

    addAuditLog(
      payment.payment_id,
      'MAX_RETRIES_EXCEEDED',
      `Stopping Rule Triggered: Maximum retry limit of ${maxRetries} reached. Automated recovery stopped.`,
      { total_retries: payment.retry_count, max_allowed: maxRetries }
    );

    return { status: 'gave_up', message: 'Max retries limit reached' };
  }

  // Log classification step
  addAuditLog(
    payment.payment_id,
    'CLASSIFIED',
    `Diagnosed failure as '${classification.category}'. Strategy: ${classification.strategy_name}.`,
    classification
  );

  // Execute Action based on Strategy
  if (classification.action_type === 'AUTO_RETRY') {
    return await handleAutoRetry(payment, classification);
  } else if (classification.action_type === 'PAYMENT_LINK') {
    return await handlePaymentLink(payment, classification);
  } else {
    return await handleManualFollowup(payment, classification);
  }
}

/**
 * Handle Auto-Retry Strategy
 */
async function handleAutoRetry(payment, classification) {
  const newRetryCount = (payment.retry_count || 0) + 1;
  const delayMinutes = classification.delay_minutes || 2;
  const nextRetryTime = new Date(Date.now() + delayMinutes * 60 * 1000).toISOString();

  savePayment({
    payment_id: payment.payment_id,
    category: classification.category,
    status: 'recovering',
    retry_count: newRetryCount,
    next_retry_at: nextRetryTime
  });

  const auditMsg = `Scheduled auto-retry #${newRetryCount} in ${delayMinutes} min (${nextRetryTime}). Reason: ${classification.reasoning}`;
  console.log(`⏱️ [AUTO-RETRY SCHEDULED] ${payment.payment_id}: Retry #${newRetryCount} in ${delayMinutes} min`);
  
  addAuditLog(
    payment.payment_id,
    'RETRY_SCHEDULED',
    auditMsg,
    { retry_count: newRetryCount, next_retry_at: nextRetryTime, delay_minutes: delayMinutes }
  );

  return {
    status: 'recovering',
    action: 'RETRY_SCHEDULED',
    retry_count: newRetryCount,
    next_retry_at: nextRetryTime
  };
}

/**
 * Handle Razorpay Payment Link Strategy
 */
async function handlePaymentLink(payment, classification) {
  let linkUrl = '';
  let linkId = '';

  // Try creating actual Razorpay Payment Link if SDK is configured
  if (razorpayInstance) {
    try {
      const linkResponse = await razorpayInstance.paymentLink.create({
        amount: Math.round(payment.amount * 100), // convert to paise
        currency: payment.currency || 'INR',
        accept_partial: false,
        description: `Payment Recovery for Order #${payment.order_id || payment.payment_id}`,
        customer: {
          name: payment.customer_name || 'Customer',
          email: payment.customer_email || 'customer@example.com',
          contact: payment.customer_phone || '+919876543210'
        },
        notify: {
          sms: true,
          email: true
        },
        reminder_enable: true,
        callback_url: `http://localhost:${process.env.PORT || 3000}/api/payments/${payment.payment_id}/simulate-pay`,
        callback_method: 'get'
      });
      linkId = linkResponse.id;
      linkUrl = linkResponse.short_url;
    } catch (err) {
      console.warn(`⚠️ Razorpay Link API error (fallback to mock link):`, err.message);
    }
  }

  // Fallback Mock Link if API unavailable or keys not provided
  if (!linkUrl) {
    const mockHash = payment.payment_id.replace('pay_', '');
    linkId = `plink_${mockHash}`;
    linkUrl = `https://rzp.io/i/recov_${mockHash}`;
  }

  // Update payment record in DB
  savePayment({
    payment_id: payment.payment_id,
    category: classification.category,
    status: 'recovering',
    payment_link_id: linkId,
    payment_link_url: linkUrl
  });

  addAuditLog(
    payment.payment_id,
    'PAYMENT_LINK_GENERATED',
    `Generated Payment Link: ${linkUrl}. Reason: ${classification.reasoning}`,
    { payment_link_id: linkId, payment_link_url: linkUrl }
  );

  // Simulate SMS dispatch log
  const customerPhone = payment.customer_phone || '+919876543210';
  const customerName = payment.customer_name || 'Valued Customer';
  const smsMessage = `Hi ${customerName}, your payment of ₹${payment.amount} for Order #${payment.order_id} requires attention (${classification.human_title}). Complete your payment securely here: ${linkUrl}`;
  
  console.log(`\n======================================================`);
  console.log(`📱 [SMS DISPATCH SIMULATION]`);
  console.log(`To: ${customerPhone}`);
  console.log(`Message: "${smsMessage}"`);
  console.log(`======================================================\n`);

  addAuditLog(
    payment.payment_id,
    'SMS_SIMULATED',
    `Simulated SMS dispatch to ${customerPhone} with payment recovery link.`,
    { recipient: customerPhone, message_body: smsMessage }
  );

  return {
    status: 'recovering',
    action: 'PAYMENT_LINK_SENT',
    payment_link_url: linkUrl,
    sms_sent: true
  };
}

/**
 * Handle Manual Followup Strategy
 */
async function handleManualFollowup(payment, classification) {
  savePayment({
    payment_id: payment.payment_id,
    category: classification.category,
    status: 'gave_up'
  });

  addAuditLog(
    payment.payment_id,
    'FLAGGED_MANUAL',
    `Payment flagged for manual follow-up by human customer success agent. Reason: ${classification.reasoning}`,
    {}
  );

  return { status: 'gave_up', action: 'FLAGGED_MANUAL' };
}

/**
 * Background worker task: Execute pending scheduled auto-retries when due
 */
async function processDueRetries() {
  const pendingPayments = getAllPayments({ status: 'recovering' });
  const now = new Date();

  for (const payment of pendingPayments) {
    // Check if it's an auto-retry payment awaiting execution
    if (payment.next_retry_at && !payment.payment_link_url) {
      const retryTime = new Date(payment.next_retry_at);
      
      if (retryTime <= now) {
        console.log(`🔄 [EXECUTING DUE AUTO-RETRY] Payment ${payment.payment_id} (Attempt #${payment.retry_count})`);

        addAuditLog(
          payment.payment_id,
          'RETRY_EXECUTING',
          `Executing scheduled auto-retry attempt #${payment.retry_count} via Razorpay API...`,
          { retry_attempt: payment.retry_count }
        );

        // Simulate 60% probability of payment success on retry
        const isSuccess = Math.random() < 0.6;

        if (isSuccess) {
          const recoveredTime = new Date().toISOString();
          savePayment({
            payment_id: payment.payment_id,
            status: 'recovered',
            next_retry_at: null,
            recovered_at: recoveredTime
          });

          console.log(`🎉 [RECOVERY SUCCESS] Payment ${payment.payment_id} recovered! Amount: ₹${payment.amount}`);
          
          addAuditLog(
            payment.payment_id,
            'PAYMENT_RECOVERED',
            `Auto-retry attempt #${payment.retry_count} succeeded! Payment of ₹${payment.amount} recovered.`,
            { recovered_at: recoveredTime, amount: payment.amount }
          );
        } else {
          console.log(`❌ [RETRY FAILED] Auto-retry #${payment.retry_count} for ${payment.payment_id} failed.`);

          addAuditLog(
            payment.payment_id,
            'RETRY_FAILED',
            `Auto-retry attempt #${payment.retry_count} failed.`,
            {}
          );

          // Check stopping rules for next step
          if (payment.retry_count >= payment.max_retries) {
            savePayment({
              payment_id: payment.payment_id,
              status: 'gave_up',
              next_retry_at: null
            });

            addAuditLog(
              payment.payment_id,
              'MAX_RETRIES_EXCEEDED',
              `Stopping Rule Triggered: Maximum retry limit (${payment.max_retries}) reached after failed attempt.`,
              {}
            );
          } else {
            // Schedule another retry attempt
            const nextRetryTime = new Date(Date.now() + (payment.retry_count * 2) * 60 * 1000).toISOString();
            const nextCount = payment.retry_count + 1;

            savePayment({
              payment_id: payment.payment_id,
              status: 'recovering',
              retry_count: nextCount,
              next_retry_at: nextRetryTime
            });

            addAuditLog(
              payment.payment_id,
              'RETRY_SCHEDULED',
              `Scheduled follow-up auto-retry #${nextCount} at ${nextRetryTime}.`,
              { next_retry_at: nextRetryTime, retry_count: nextCount }
            );
          }
        }
      }
    }
  }
}

/**
 * Mark a payment as recovered (e.g., when customer pays via Payment Link or Webhook confirms payment.captured)
 */
function markAsRecovered(paymentId, source = 'PAYMENT_LINK_PAID') {
  const payment = getPaymentById(paymentId);
  if (!payment) return null;

  if (payment.status === 'recovered') {
    return payment; // Already recovered
  }

  const now = new Date().toISOString();
  const updated = savePayment({
    payment_id: paymentId,
    status: 'recovered',
    next_retry_at: null,
    recovered_at: now
  });

  console.log(`✅ [PAYMENT RECOVERED] ${paymentId} via ${source}. Amount: ₹${payment.amount}`);
  
  addAuditLog(
    paymentId,
    'PAYMENT_RECOVERED',
    `Payment of ₹${payment.amount} successfully recovered via ${source}.`,
    { source, amount: payment.amount, recovered_at: now }
  );

  return updated;
}

module.exports = {
  executeRecoveryAction,
  processDueRetries,
  markAsRecovered
};
