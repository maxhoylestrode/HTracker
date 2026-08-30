const THEMES = [
  { key: 'dark', label: 'Dark', bg: '#0f172a', panel: '#1e293b', accent: '#3b82f6' },
  { key: 'light', label: 'Light', bg: '#f1f5f9', panel: '#ffffff', accent: '#2563eb' },
  { key: 'pink', label: 'Pink', bg: '#241017', panel: '#38182a', accent: '#ec4899' },
  { key: 'purple', label: 'Purple', bg: '#1a1729', panel: '#26213e', accent: '#a855f7' },
  { key: 'silver', label: 'Silver', bg: '#e2e5ea', panel: '#f8fafc', accent: '#52606d' }
];

let currentTheme = 'dark';

function renderThemeGrid() {
  const grid = document.getElementById('themeGrid');
  grid.innerHTML = '';
  THEMES.forEach((t) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'theme-swatch' + (t.key === currentTheme ? ' selected' : '');
    btn.dataset.theme = t.key;
    btn.innerHTML = `
      <span class="swatch-preview" style="background:${t.bg}">
        <span class="swatch-panel" style="background:${t.panel}"></span>
        <span class="swatch-accent" style="background:${t.accent}"></span>
      </span>
      <span class="swatch-label">${t.label}</span>
    `;
    btn.addEventListener('click', () => selectTheme(t.key));
    grid.appendChild(btn);
  });
}

async function selectTheme(key) {
  if (key === currentTheme) return;
  currentTheme = key;
  applyTheme(key); // instant preview, from common.js
  renderThemeGrid();
  try {
    await api('/api/users/me', { method: 'PUT', body: JSON.stringify({ theme: key }) });
  } catch (err) {
    // still applied locally; will just re-sync from server next load if this failed
    console.error('Could not save theme:', err.message);
  }
}

document.getElementById('passwordForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = document.getElementById('passwordMsg');
  msg.textContent = '';
  const current_password = document.getElementById('currentPassword').value;
  const new_password = document.getElementById('newPassword').value;
  const confirm = document.getElementById('confirmPassword').value;

  if (new_password !== confirm) {
    msg.style.color = 'var(--danger)';
    msg.textContent = "New passwords don't match";
    return;
  }

  try {
    await api('/api/auth/password', {
      method: 'PUT',
      body: JSON.stringify({ current_password, new_password })
    });
    document.getElementById('passwordForm').reset();
    msg.style.color = 'var(--success)';
    msg.textContent = 'Password updated.';
    setTimeout(() => { msg.textContent = ''; }, 3000);
  } catch (err) {
    msg.style.color = 'var(--danger)';
    msg.textContent = err.message;
  }
});

const MONZO_QUERY_MESSAGES = {
  connected: { text: 'Monzo connected.', color: 'var(--success)' },
  declined: { text: 'Monzo connection cancelled.', color: 'var(--text-dim)' },
  error: { text: 'Something went wrong connecting to Monzo. Try again.', color: 'var(--danger)' },
  not_configured: { text: "Monzo isn't set up on this server yet.", color: 'var(--danger)' }
};

function showMonzoQueryMessage() {
  const params = new URLSearchParams(window.location.search);
  const status = params.get('monzo');
  if (!status) return;
  const info = MONZO_QUERY_MESSAGES[status];
  const el = document.getElementById('monzoStatusMsg');
  if (info && el) {
    el.innerHTML = `<p class="field-hint" style="color:${info.color}; margin-top:-0.5rem;">${info.text}</p>`;
  }
  // Drop the query param so refreshing the page doesn't keep re-showing it.
  params.delete('monzo');
  const qs = params.toString();
  history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''));
}

async function loadMonzoStatus() {
  let data;
  try {
    data = await api('/api/monzo/status');
  } catch (err) {
    return; // not fatal to the rest of the page
  }
  const disconnectedEl = document.getElementById('monzoDisconnected');
  const connectedEl = document.getElementById('monzoConnected');
  if (!data.connected) {
    disconnectedEl.classList.remove('hidden');
    connectedEl.classList.add('hidden');
    return;
  }
  disconnectedEl.classList.add('hidden');
  connectedEl.classList.remove('hidden');
  if (data.balance !== null && data.balance !== undefined) {
    document.getElementById('monzoBalance').textContent = fmtMoney(data.balance);
    document.getElementById('monzoSpendToday').textContent = fmtMoney(data.spend_today);
    document.getElementById('monzoSyncedNote').textContent = data.last_synced_at
      ? `Last new transaction: ${fmtDate(data.last_synced_at.slice(0, 10))}`
      : 'Connected — waiting for your first new transaction.';
  } else {
    document.getElementById('monzoBalance').textContent = '—';
    document.getElementById('monzoSpendToday').textContent = '—';
    document.getElementById('monzoSyncedNote').textContent = data.error === 'reauth_required'
      ? 'Monzo access expired — disconnect and reconnect to keep this working.'
      : "Connected, but couldn't reach Monzo just now.";
  }
}

document.getElementById('monzoDisconnectBtn').addEventListener('click', async () => {
  if (!confirm('Disconnect Monzo? Budgeteer will stop receiving your transactions until you reconnect.')) return;
  await api('/api/monzo/disconnect', { method: 'POST' });
  await loadMonzoStatus();
});

document.addEventListener('DOMContentLoaded', async () => {
  const session = await guardSession();
  if (!session) return;
  currentTheme = session.theme || 'dark';
  renderThemeGrid();
  showMonzoQueryMessage();
  loadMonzoStatus().catch(console.error);
});
