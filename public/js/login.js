document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;
  const errEl = document.getElementById('errorMsg');
  errEl.textContent = '';
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) {
      errEl.textContent = data.error || 'Login failed';
      return;
    }
    window.location.href = '/index.html';
  } catch (err) {
    errEl.textContent = 'Could not reach server';
  }
});
