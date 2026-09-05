/**
 * Frontend Dashboard Application JavaScript
 * Handles live polling, KPI updates, table rendering, audit logs, and demo triggers.
 */

let currentFilter = 'all';
let allPaymentsData = [];

// Format currency in Indian Rupees (₹)
function formatINR(amount) {
  return '₹' + Math.round(amount || 0).toLocaleString('en-IN');
}

// Format relative date / timestamp
function formatTime(isoString) {
  if (!isoString) return '-';
  const date = new Date(isoString);
  return date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// Category Badge Helper
function getCategoryBadge(category) {
  switch (category) {
    case 'insufficient_funds':
      return `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">💰 Insufficient Funds</span>`;
    case 'bank_declined':
      return `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">🏦 Bank Gateway Error</span>`;
    case 'otp_failed':
      return `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold bg-purple-500/10 text-purple-400 border border-purple-500/20">🔑 OTP / Auth Failed</span>`;
    case 'card_expired':
      return `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">💳 Card Expired</span>`;
    default:
      return `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold bg-slate-500/10 text-slate-400 border border-slate-500/20">❓ Unknown Error</span>`;
  }
}

// Status Badge Helper
function getStatusBadge(status, retryCount = 0) {
  switch (status) {
    case 'recovered':
      return `<span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
        <span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span> RECOVERED
      </span>`;
    case 'recovering':
      return `<span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-sky-500/20 text-sky-400 border border-sky-500/30">
        <span class="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse"></span> RETRYING (${retryCount}/3)
      </span>`;
    case 'gave_up':
      return `<span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-rose-500/20 text-rose-400 border border-rose-500/30">
        <span class="w-1.5 h-1.5 rounded-full bg-rose-400"></span> GAVE UP
      </span>`;
    default:
      return `<span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30">
        PENDING
      </span>`;
  }
}

// Fetch & Update Key Statistics
async function loadStats() {
  try {
    const res = await fetch('/api/stats');
    const stats = await res.json();

    document.getElementById('kpi-total-count').textContent = stats.total_failed_count;
    document.getElementById('kpi-at-risk-amount').textContent = formatINR(stats.total_at_risk_amount);
    document.getElementById('kpi-recovered-amount').textContent = formatINR(stats.total_recovered_amount);
    document.getElementById('kpi-recovery-rate').textContent = `${stats.recovery_rate_pct}%`;
    document.getElementById('progress-recovery-rate').style.width = `${Math.min(stats.recovery_rate_pct, 100)}%`;

    renderCategoryBreakdown(stats.category_breakdown, stats.total_failed_count);
  } catch (err) {
    console.error('Error loading stats:', err);
  }
}

// Render Category Breakdown list
function renderCategoryBreakdown(categories, totalCount) {
  const container = document.getElementById('category-breakdown-container');
  if (!categories || categories.length === 0) {
    container.innerHTML = `<div class="text-slate-400 text-sm text-center py-6">No payment failures recorded yet.</div>`;
    return;
  }

  const categoryNames = {
    'insufficient_funds': 'Insufficient Funds',
    'bank_declined': 'Bank / Gateway Downtime',
    'otp_failed': 'OTP / Auth Failed',
    'card_expired': 'Card Expired',
    'unknown': 'Other / Uncategorized'
  };

  container.innerHTML = categories.map(cat => {
    const name = categoryNames[cat.category] || cat.category;
    const pct = totalCount > 0 ? Math.round((cat.total_count / totalCount) * 100) : 0;
    const recoveredPct = cat.total_count > 0 ? Math.round((cat.recovered_count / cat.total_count) * 100) : 0;

    return `
      <div class="bg-slate-900/60 p-3 rounded-xl border border-slate-800 space-y-2">
        <div class="flex items-center justify-between text-xs font-semibold">
          <span class="text-slate-200">${name}</span>
          <span class="text-slate-400">${cat.total_count} cases (${pct}%)</span>
        </div>
        <div class="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
          <div class="bg-sky-400 h-full" style="width: ${pct}%"></div>
        </div>
        <div class="flex justify-between text-[11px] text-slate-400 pt-0.5">
          <span>Amount: <strong class="text-slate-300">${formatINR(cat.total_amount)}</strong></span>
          <span class="text-emerald-400 font-semibold">${cat.recovered_count} recovered (${recoveredPct}%)</span>
        </div>
      </div>
    `;
  }).join('');
}

// Load Audit Logs Stream
async function loadAuditLogs() {
  try {
    const res = await fetch('/api/audit-logs?limit=40');
    const logs = await res.json();
    const container = document.getElementById('audit-log-container');

    if (!logs || logs.length === 0) {
      container.innerHTML = `<div class="text-slate-500 italic">No agent log records available.</div>`;
      return;
    }

    container.innerHTML = logs.map(log => {
      let colorClass = 'text-slate-300';
      if (log.action === 'PAYMENT_RECOVERED') colorClass = 'text-emerald-400 font-bold';
      else if (log.action === 'SMS_SIMULATED' || log.action === 'PAYMENT_LINK_GENERATED') colorClass = 'text-sky-300';
      else if (log.action === 'CLASSIFIED') colorClass = 'text-purple-300';
      else if (log.action === 'MAX_RETRIES_EXCEEDED' || log.action === 'RETRY_FAILED') colorClass = 'text-rose-400';

      return `
        <div class="flex items-start gap-2 text-[11px] leading-relaxed border-b border-slate-900 pb-1.5">
          <span class="text-slate-500 select-none">[${formatTime(log.created_at)}]</span>
          <span class="text-sky-400 font-semibold">${log.payment_id}</span>
          <span class="text-slate-600">•</span>
          <span class="${colorClass}">${log.reason}</span>
        </div>
      `;
    }).join('');
  } catch (err) {
    console.error('Error loading audit logs:', err);
  }
}

// Fetch & Render Payments Table
async function loadPayments() {
  try {
    const res = await fetch('/api/payments?limit=100');
    allPaymentsData = await res.json();
    renderPaymentsTable();
  } catch (err) {
    console.error('Error loading payments:', err);
  }
}

function renderPaymentsTable() {
  const tbody = document.getElementById('payments-table-body');
  
  let filtered = allPaymentsData;
  if (currentFilter !== 'all') {
    filtered = allPaymentsData.filter(p => p.status === currentFilter);
  }

  if (!filtered || filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="px-6 py-12 text-center text-slate-500">
          No records matching status filter <strong>"${currentFilter}"</strong>.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = filtered.map(p => {
    let actionDescription = '';
    if (p.payment_link_url) {
      actionDescription = `<a href="${p.payment_link_url}" target="_blank" class="text-sky-400 hover:underline font-mono text-xs flex items-center gap-1">🔗 Payment Link Generated</a>`;
    } else if (p.status === 'recovering') {
      actionDescription = `<span class="text-amber-300 text-xs">⏱️ Auto-Retry scheduled at ${formatTime(p.next_retry_at)}</span>`;
    } else if (p.status === 'recovered') {
      actionDescription = `<span class="text-emerald-400 text-xs font-semibold">🎉 Recovered at ${formatTime(p.recovered_at)}</span>`;
    } else {
      actionDescription = `<span class="text-rose-400 text-xs">🛑 Max retries reached (${p.retry_count}/3)</span>`;
    }

    return `
      <tr class="hover:bg-slate-900/50 transition">
        <td class="px-6 py-4">
          <div class="font-mono font-semibold text-slate-200 text-xs">${p.payment_id}</div>
          <div class="text-xs text-slate-400 font-medium">${p.customer_name} • ${p.customer_phone}</div>
          <div class="text-[11px] text-slate-500">${formatTime(p.created_at)}</div>
        </td>
        <td class="px-6 py-4 font-bold text-slate-100">
          ${formatINR(p.amount)}
        </td>
        <td class="px-6 py-4">
          ${getCategoryBadge(p.category)}
          <div class="text-[11px] text-slate-400 mt-1 max-w-xs truncate" title="${p.error_description || ''}">${p.error_description || p.error_code}</div>
        </td>
        <td class="px-6 py-4">
          ${actionDescription}
        </td>
        <td class="px-6 py-4">
          ${getStatusBadge(p.status, p.retry_count)}
        </td>
        <td class="px-6 py-4 text-right">
          ${p.status !== 'recovered' ? `
            <button onclick="simulatePay('${p.payment_id}')" class="inline-flex items-center gap-1 bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded-lg text-xs font-semibold shadow transition transform active:scale-95 cursor-pointer">
              ⚡ Pay Now
            </button>
          ` : `
            <span class="text-xs text-emerald-400 font-semibold">✓ Paid</span>
          `}
        </td>
      </tr>
    `;
  }).join('');
}

// Set Active Filter
function setFilter(filter) {
  currentFilter = filter;
  ['all', 'recovered', 'recovering', 'gave_up'].forEach(f => {
    const btn = document.getElementById(`filter-${f}`);
    if (btn) {
      if (f === filter) {
        btn.className = 'px-3 py-1.5 rounded-lg font-medium bg-sky-500 text-white transition';
      } else {
        btn.className = 'px-3 py-1.5 rounded-lg font-medium text-slate-400 hover:text-white transition';
      }
    }
  });
  renderPaymentsTable();
}

// Run 50-Payment Simulator Trigger
async function runSimulator() {
  const btn = document.getElementById('btn-simulate');
  btn.disabled = true;
  btn.innerHTML = `<svg class="animate-spin w-4 h-4 text-white" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> Generating 50 Payments...`;

  try {
    const res = await fetch('/api/simulate?count=50', { method: 'POST' });
    const data = await res.json();
    console.log('Simulation complete:', data);
    await refreshAll();
  } catch (err) {
    console.error('Error running simulator:', err);
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg> Run 50-Payment Simulator`;
  }
}

// Trigger Customer Pay Now Simulation
async function simulatePay(paymentId) {
  try {
    const res = await fetch(`/api/payments/${paymentId}/simulate-pay`, {
      method: 'POST',
      headers: { 'Accept': 'application/json' }
    });
    await res.json();
    await refreshAll();
  } catch (err) {
    console.error('Error simulating pay:', err);
  }
}

// Reset Database Trigger
async function resetData() {
  if (!confirm('Are you sure you want to clear all payment records and reset demo?')) return;
  try {
    await fetch('/api/reset', { method: 'POST' });
    await refreshAll();
  } catch (err) {
    console.error('Error resetting data:', err);
  }
}

// Refresh All Data
async function refreshAll() {
  await Promise.all([loadStats(), loadPayments(), loadAuditLogs()]);
}

// Initialize on page load and start auto-polling every 4 seconds
document.addEventListener('DOMContentLoaded', () => {
  refreshAll();
  setInterval(refreshAll, 4000);
});
