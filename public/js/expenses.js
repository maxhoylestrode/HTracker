const CATEGORIES = ['Housing', 'Utilities', 'Subscriptions', 'Insurance', 'Groceries', 'Transport', 'Debt', 'Childcare', 'Other'];
const PAYMENT_TYPES = ['direct_debit', 'subscription', 'standing_order', 'manual'];
const FREQUENCIES = ['one_off', 'weekly', 'monthly', 'yearly'];
const FREQ_LABELS = { one_off: 'One-off', weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly' };

let allExpenses = [];

function populateSelects() {
  const cat = document.getElementById('fCategory');
  cat.innerHTML = CATEGORIES.map((c) => `<option value="${c}">${c}</option>`).join('');
  const pt = document.getElementById('fPaymentType');
  pt.innerHTML = PAYMENT_TYPES.map((p) => `<option value="${p}">${PAYMENT_TYPE_LABELS[p]}</option>`).join('');
  const fr = document.getElementById('fFrequency');
  fr.innerHTML = FREQUENCIES.map((f) => `<option value="${f}">${FREQ_LABELS[f]}</option>`).join('');
}

async function loadExpenses() {
  allExpenses = await api('/api/expenses');
  renderTable();
}

function renderTable() {
  const tbody = document.getElementById('expenseRows');
  tbody.innerHTML = '';
  if (!allExpenses.length) {
    tbody.innerHTML = '<tr><td colspan="8" style="color:var(--text-dim)">No expenses yet. Click "+ Add Expense" to create one.</td></tr>';
    return;
  }
  allExpenses.forEach((e) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="card-title">${escapeHtml(e.name)}</td>
      <td data-label="Category"><span class="cat-chip"><span class="dot" style="background:${e.color}"></span>${e.category}</span></td>
      <td data-label="Payment type"><span class="badge">${PAYMENT_TYPE_LABELS[e.payment_type] || e.payment_type}</span></td>
      <td data-label="Frequency">${FREQ_LABELS[e.frequency] || e.frequency}</td>
      <td data-label="Current cost">${fmtMoney(e.current_cost)}</td>
      <td data-label="Next due">${fmtDate(e.next_due_date)}</td>
      <td data-label="Next increase">${e.next_increase ? fmtMoney(e.next_increase.amount) + ' on ' + fmtDate(e.next_increase.effective_date) : '—'}</td>
      <td><button class="btn-secondary" data-id="${e.id}" data-action="edit">Edit</button></td>
    `;
    tbody.appendChild(tr);
  });
  tbody.querySelectorAll('[data-action="edit"]').forEach((btn) => {
    btn.addEventListener('click', () => openEditModal(Number(btn.dataset.id)));
  });
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function resetForm() {
  document.getElementById('expenseForm').reset();
  document.getElementById('expenseId').value = '';
  document.getElementById('fActive').checked = true;
  document.getElementById('formError').textContent = '';
  document.getElementById('historySection').classList.add('hidden');
  document.getElementById('deleteExpenseBtn').classList.add('hidden');
  document.getElementById('activeFieldWrap').style.display = 'none';
}

function openAddModal() {
  resetForm();
  document.getElementById('formModalTitle').textContent = 'Add Expense';
  document.getElementById('fStartDate').value = todayISO();
  document.getElementById('formModal').classList.remove('hidden');
}

async function openEditModal(id) {
  resetForm();
  const e = await api(`/api/expenses/${id}`);
  document.getElementById('formModalTitle').textContent = 'Edit Expense';
  document.getElementById('expenseId').value = e.id;
  document.getElementById('fName').value = e.name;
  document.getElementById('fCategory').value = e.category;
  document.getElementById('fPaymentType').value = e.payment_type;
  document.getElementById('fFrequency').value = e.frequency;
  document.getElementById('fAmount').value = e.current_cost;
  document.getElementById('fStartDate').value = e.start_date;
  document.getElementById('fEndDate').value = e.end_date || '';
  document.getElementById('fNotes').value = e.notes || '';
  document.getElementById('fActive').checked = e.active;
  document.getElementById('activeFieldWrap').style.display = 'flex';
  document.getElementById('deleteExpenseBtn').classList.remove('hidden');

  document.getElementById('historySection').classList.remove('hidden');
  renderHistory(e.history);
  document.getElementById('hDate').value = todayISO();

  document.getElementById('formModal').classList.remove('hidden');
}

function renderHistory(history) {
  const el = document.getElementById('historyList');
  el.innerHTML = '';
  if (!history.length) {
    el.innerHTML = '<p style="color:var(--text-dim); font-size:0.85rem">No history recorded.</p>';
    return;
  }
  history.slice().reverse().forEach((h) => {
    const row = document.createElement('div');
    row.className = 'hist-row';
    row.innerHTML = `<span>${fmtDate(h.effective_date)} ${h.note ? '— ' + escapeHtml(h.note) : ''}</span><strong>${fmtMoney(h.amount)}</strong>`;
    el.appendChild(row);
  });
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function currentFormPayload() {
  return {
    name: document.getElementById('fName').value,
    category: document.getElementById('fCategory').value,
    payment_type: document.getElementById('fPaymentType').value,
    frequency: document.getElementById('fFrequency').value,
    amount: Number(document.getElementById('fAmount').value),
    start_date: document.getElementById('fStartDate').value,
    end_date: document.getElementById('fEndDate').value || null,
    notes: document.getElementById('fNotes').value || null,
    active: document.getElementById('fActive').checked
  };
}

document.addEventListener('DOMContentLoaded', async () => {
  const session = await guardSession();
  if (!session) return;

  populateSelects();
  await loadExpenses().catch(console.error);

  document.getElementById('addExpenseBtn').addEventListener('click', openAddModal);
  document.getElementById('cancelFormBtn').addEventListener('click', () => {
    document.getElementById('formModal').classList.add('hidden');
  });

  document.getElementById('expenseForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('formError');
    errEl.textContent = '';
    const id = document.getElementById('expenseId').value;
    const payload = currentFormPayload();
    try {
      if (id) {
        await api(`/api/expenses/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        await api('/api/expenses', { method: 'POST', body: JSON.stringify(payload) });
      }
      document.getElementById('formModal').classList.add('hidden');
      await loadExpenses();
    } catch (err) {
      errEl.textContent = err.message;
    }
  });

  document.getElementById('deleteExpenseBtn').addEventListener('click', async () => {
    const id = document.getElementById('expenseId').value;
    if (!id) return;
    if (!confirm('Delete this expense and all its cost history? This cannot be undone.')) return;
    await api(`/api/expenses/${id}`, { method: 'DELETE' });
    document.getElementById('formModal').classList.add('hidden');
    await loadExpenses();
  });

  document.getElementById('addCostChangeBtn').addEventListener('click', async () => {
    const id = document.getElementById('expenseId').value;
    const amount = document.getElementById('hAmount').value;
    const effective_date = document.getElementById('hDate').value;
    const note = document.getElementById('hNote').value || null;
    const errEl = document.getElementById('formError');
    errEl.textContent = '';
    if (!id || !amount || !effective_date) {
      errEl.textContent = 'Amount and effective date are required for a cost change';
      return;
    }
    try {
      const res = await api(`/api/expenses/${id}/cost-change`, {
        method: 'POST',
        body: JSON.stringify({ amount: Number(amount), effective_date, note })
      });
      renderHistory(res.history);
      document.getElementById('hAmount').value = '';
      document.getElementById('hNote').value = '';
      await loadExpenses();
    } catch (err) {
      errEl.textContent = err.message;
    }
  });

  // Deep link from calendar: /expenses.html?id=5
  const params = new URLSearchParams(window.location.search);
  const deepLinkId = params.get('id');
  if (deepLinkId) openEditModal(Number(deepLinkId)).catch(console.error);
});
