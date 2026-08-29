async function loadDashboard() {
  const [summary, household] = await Promise.all([
    api('/api/summary'),
    api('/api/household').catch(() => null)
  ]);

  document.getElementById('totalMonthly').textContent = fmtMoney(summary.total_monthly);

  const you = household ? household.users.find((u) => u.is_you) : null;
  const shareEl = document.getElementById('yourShare');
  const shareNote = document.getElementById('yourShareNote');
  if (you) {
    shareEl.textContent = fmtMoney(you.share_of_bills);
    if (shareNote) shareNote.textContent = `${you.normalized_share_percentage}% split of total monthly spend`;
  } else {
    shareEl.textContent = fmtMoney(summary.total_monthly / 2);
    if (shareNote) shareNote.textContent = '50/50 split of total monthly spend';
  }

  document.getElementById('activeCount').textContent = summary.active_expense_count;
  document.getElementById('due30Count').textContent = summary.upcoming_30_days.length;
  document.getElementById('increaseCount').textContent = summary.upcoming_cost_increases.length;

  renderBars('byCategory', summary.by_category, null, summary.category_colors);
  renderBars('byPaymentType', summary.by_payment_type, PAYMENT_TYPE_LABELS, summary.payment_type_colors);

  const listEl = document.getElementById('upcomingList');
  listEl.innerHTML = '';
  if (!summary.upcoming_30_days.length) {
    listEl.innerHTML = '<p style="color:var(--text-dim)">Nothing due in the next 30 days.</p>';
  }
  summary.upcoming_30_days.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'list-item';
    row.innerHTML = `
      <span class="dot" style="background:${item.color}"></span>
      <span class="name">${escapeHtml(item.name)}</span>
      <span class="badge">${PAYMENT_TYPE_LABELS[item.payment_type] || item.payment_type}</span>
      <span class="date">${fmtDate(item.date)}</span>
      <span class="amt">${fmtMoney(item.amount)}</span>
    `;
    listEl.appendChild(row);
  });

  const incEl = document.getElementById('increaseList');
  incEl.innerHTML = '';
  if (!summary.upcoming_cost_increases.length) {
    incEl.innerHTML = '<p style="color:var(--text-dim)">No scheduled cost increases.</p>';
  }
  summary.upcoming_cost_increases.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'list-item';
    row.innerHTML = `
      <span class="name">${escapeHtml(item.name)}</span>
      <span class="date">${fmtDate(item.effective_date)}</span>
      <span class="amt">${fmtMoney(item.amount)}</span>
    `;
    incEl.appendChild(row);
  });
}

function renderBars(containerId, data, labelMap, colorMap) {
  const el = document.getElementById(containerId);
  el.innerHTML = '';
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...entries.map(([, v]) => v));
  if (!entries.length) {
    el.innerHTML = '<p style="color:var(--text-dim)">No data yet.</p>';
    return;
  }
  entries.forEach(([key, val]) => {
    const row = document.createElement('div');
    row.className = 'bar-row';
    const label = labelMap ? (labelMap[key] || key) : key;
    const color = (colorMap && colorMap[key]) || 'var(--accent)';
    row.innerHTML = `
      <span class="dot" style="background:${color}"></span>
      <span class="bar-label">${escapeHtml(label)}</span>
      <span class="bar-track"><span class="bar-fill" style="width:${(val / max) * 100}%; background:${color}"></span></span>
      <span class="bar-amount">${fmtMoney(val)}</span>
    `;
    el.appendChild(row);
  });
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

document.addEventListener('DOMContentLoaded', async () => {
  const session = await guardSession();
  if (session) loadDashboard().catch(console.error);
});
