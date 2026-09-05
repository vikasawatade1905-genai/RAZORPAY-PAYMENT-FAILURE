const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { savePayment, addAuditLog, getPaymentById } = require('../db/database');
const { classifyFailure } = require('../classifier');
const { executeRecoveryAction, markAsRecovered } = require('../recoveryEngine');

/**
 * Verify Razorpay Webhook Signature if secret is configured
 */
function verifyWebhookSignature(req) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return true; // Skip verification if secret not provided in development

  const signature = req.headers['x-razorpay-signature'];
  if (!signature) return false;

  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(req.body))
    .digest('hex');

  return signature === expectedSignature;
}

/**
 * POST /api/webhooks/razorpay
 * Webhook handler for Razorpay events (payment.failed, payment.captured, payment_link.paid)
 */
router.post('/razorpay', async (req, res) => {
  try {
    if (!verifyWebhookSignature(req)) {
      console.warn('⚠️ Webhook signature verification failed');
      return res.status(400).json({ error: 'Invalid webhook signature' });
    }

    const payload = req.body;
    const event = payload.event;

    console.log(`\n📥 [WEBHOOK RECEIVED] Event: ${event}`);

    // Handle Failed Payment
    if (event === 'payment.failed') {
      const entity = payload.payload.payment.entity;

      // Convert amount from paise to rupees if needed
      const amountInRupees = entity.amount ? entity.amount / 100 : 0;
      
      const paymentData = {
        payment_id: entity.id,
        order_id: entity.order_id || `order_${entity.id.slice(-8)}`,
        customer_name: entity.notes?.customer_name || entity.email?.split('@')[0] || 'Customer',
        customer_email: entity.email || 'customer@example.com',
        customer_phone: entity.contact || '+919876543210',
        amount: amountInRupees,
        currency: entity.currency || 'INR',
        error_code: entity.error_code || 'BAD_REQUEST_ERROR',
        error_description: entity.error_description || 'Payment failed',
        error_source: entity.error_source || 'issuer',
        error_step: entity.error_step || 'payment_authorization',
        error_reason: entity.error_reason || 'payment_failed',
        status: 'failed'
      };

      // 1. Save payment record
      const savedPayment = savePayment(paymentData);

      // Log initial webhook entry to Audit Trail
      addAuditLog(
        entity.id,
        'WEBHOOK_RECEIVED',
        `Intercepted payment failure event from Razorpay. Amount: ₹${amountInRupees}`,
        { error_code: entity.error_code, error_description: entity.error_description }
      );

      // 2. Failure Classifier (Diagnose WHY it failed)
      const classification = classifyFailure(savedPayment);

      // 3. Recovery Action Engine (Act based on classification & rules)
      const recoveryResult = await executeRecoveryAction(savedPayment, classification);

      return res.json({
        status: 'success',
        event,
        payment_id: entity.id,
        classification,
        recovery_result: recoveryResult
      });
    }

    // Handle Payment Recovered Events
    if (event === 'payment.captured' || event === 'payment.authorized' || event === 'payment_link.paid') {
      let paymentId = '';
      if (payload.payload.payment) {
        paymentId = payload.payload.payment.entity.id;
      } else if (payload.payload.payment_link) {
        // Find payment associated with link
        const linkEntity = payload.payload.payment_link.entity;
        paymentId = linkEntity.notes?.payment_id;
      }

      if (paymentId) {
        const updated = markAsRecovered(paymentId, event.toUpperCase());
        return res.json({ status: 'success', event, recovered: true, payment: updated });
      }
    }

    return res.json({ status: 'ignored', message: `Unhandled event type: ${event}` });
  } catch (err) {
    console.error('❌ Error processing Razorpay webhook:', err);
    return res.status(500).json({ error: 'Internal server error processing webhook' });
  }
});

module.exports = router;
