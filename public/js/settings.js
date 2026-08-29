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

document.addEventListener('DOMContentLoaded', async () => {
  const session = await guardSession();
  if (!session) return;
  currentTheme = session.theme || 'dark';
  renderThemeGrid();
});
