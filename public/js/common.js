// Shared across all app pages: session guard, nav highlighting, logout, fetch helper.

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  if (res.status === 401) {
    window.location.href = '/login.html';
    throw new Error('Not authenticated');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

async function guardSession() {
  try {
    const data = await api('/api/auth/session');
    if (!data.authenticated) {
      window.location.href = '/login.html';
      return null;
    }
    const pill = document.getElementById('userPill');
    if (pill) pill.textContent = data.username;
    return data;
  } catch (e) {
    window.location.href = '/login.html';
    return null;
  }
}

function wireLogout() {
  const btn = document.getElementById('logoutBtn');
  if (btn) {
    btn.addEventListener('click', async () => {
      await api('/api/auth/logout', { method: 'POST' });
      window.location.href = '/login.html';
    });
  }
}

function fmtMoney(n) {
  return '£' + Number(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

const PAYMENT_TYPE_LABELS = {
  direct_debit: 'Direct Debit',
  subscription: 'Subscription',
  standing_order: 'Standing Order',
  manual: 'Manual'
};

document.addEventListener('DOMContentLoaded', () => {
  guardSession();
  wireLogout();
  const path = window.location.pathname;
  document.querySelectorAll('.app-nav a').forEach((a) => {
    if (a.getAttribute('href') === path) a.classList.add('active');
  });
});
