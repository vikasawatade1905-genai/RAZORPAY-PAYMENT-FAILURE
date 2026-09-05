/**
 * Failure Classifier Module
 * Diagnoses Razorpay payment failure codes, error descriptions, and reasons
 * into actionable categories with specific recovery strategies.
 */

const CATEGORIES = {
  INSUFFICIENT_FUNDS: 'insufficient_funds',
  BANK_DECLINED: 'bank_declined',
  OTP_FAILED: 'otp_failed',
  CARD_EXPIRED: 'card_expired',
  UNKNOWN: 'unknown'
};

const STRATEGIES = {
  AUTO_RETRY: 'AUTO_RETRY',
  PAYMENT_LINK: 'PAYMENT_LINK',
  MANUAL_FOLLOWUP: 'MANUAL_FOLLOWUP'
};

/**
 * Classify a Razorpay payment failure based on error attributes
 * @param {Object} payment - Failed payment payload or DB object
 * @returns {Object} Classification result with category, strategy, and reasoning
 */
function classifyFailure(payment) {
  const code = (payment.error_code || '').toUpperCase();
  const desc = (payment.error_description || '').toLowerCase();
  const reason = (payment.error_reason || '').toLowerCase();
  const source = (payment.error_source || '').toLowerCase();

  const fullText = `${code} ${desc} ${reason} ${source}`;

  // 1. INSUFFICIENT FUNDS
  if (
    fullText.includes('insufficient') ||
    fullText.includes('low_balance') ||
    fullText.includes('balance') ||
    fullText.includes('funds') ||
    reason.includes('insufficient_funds')
  ) {
    return {
      category: CATEGORIES.INSUFFICIENT_FUNDS,
      action_type: STRATEGIES.AUTO_RETRY,
      strategy_name: 'retry_later',
      delay_minutes: parseInt(process.env.DEMO_RETRY_INTERVAL_MINUTES || '2', 10),
      reasoning: 'Customer account has insufficient funds. Schedule smart auto-retry after customer account top-up window.',
      human_title: 'Insufficient Funds'
    };
  }

  // 2. BANK DECLINED / ISSUER DOWN
  if (
    fullText.includes('bank_declined') ||
    fullText.includes('issuer_down') ||
    fullText.includes('gateway_error') ||
    fullText.includes('server_error') ||
    fullText.includes('timed_out') ||
    fullText.includes('network') ||
    fullText.includes('unavailable') ||
    fullText.includes('down') ||
    reason.includes('payment_timed_out')
  ) {
    return {
      category: CATEGORIES.BANK_DECLINED,
      action_type: STRATEGIES.AUTO_RETRY,
      strategy_name: 'retry_immediately',
      delay_minutes: 1, // Fast retry
      reasoning: 'Temporary bank gateway failure or network timeout. Schedule fast automated retry.',
      human_title: 'Bank / Gateway Issue'
    };
  }

  // 3. OTP / AUTHENTICATION FAILED
  if (
    fullText.includes('otp') ||
    fullText.includes('authentication') ||
    fullText.includes('auth_failed') ||
    fullText.includes('cancelled') ||
    fullText.includes('incorrect_otp') ||
    fullText.includes('3d_secure') ||
    reason.includes('payment_otp_incorrect') ||
    reason.includes('payment_cancelled')
  ) {
    return {
      category: CATEGORIES.OTP_FAILED,
      action_type: STRATEGIES.PAYMENT_LINK,
      strategy_name: 'send_payment_link',
      delay_minutes: 0,
      reasoning: 'Customer 3DS / OTP verification failed or was cancelled. Instant Razorpay Payment Link generated & sent to customer via SMS.',
      human_title: 'OTP / Auth Failed'
    };
  }

  // 4. CARD EXPIRED
  if (
    fullText.includes('expired') ||
    fullText.includes('card_expired') ||
    fullText.includes('holder_not_enrolled') ||
    reason.includes('expired_card')
  ) {
    return {
      category: CATEGORIES.CARD_EXPIRED,
      action_type: STRATEGIES.PAYMENT_LINK,
      strategy_name: 'send_payment_link_alternate_method',
      delay_minutes: 0,
      reasoning: 'Customer payment card has expired. Generate Razorpay Payment Link prompting user to select an alternate payment method.',
      human_title: 'Card Expired'
    };
  }

  // 5. UNKNOWN / FALLBACK
  return {
    category: CATEGORIES.UNKNOWN,
    action_type: STRATEGIES.PAYMENT_LINK,
    strategy_name: 'fallback_link',
    delay_minutes: 0,
    reasoning: 'Unclassified payment failure. Instant Razorpay Payment Link generated for easy customer retry.',
    human_title: 'Uncategorized Error'
  };
}

module.exports = {
  classifyFailure,
  CATEGORIES,
  STRATEGIES
};
