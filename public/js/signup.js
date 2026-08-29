async function checkSignupCodeRequired() {
  try {
    const res = await fetch('/api/auth/signup-required-code');
    const data = await res.json();
    if (data.codeRequired) {
      document.getElementById('signupCodeField').classList.remove('hidden');
      document.getElementById('signup_code').setAttribute('required', 'required');
    }
  } catch (err) {
    // if this check fails, leave the field hidden — the server will still enforce it if needed
  }
}

document.getElementById('signupForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;
  const signup_code = document.getElementById('signup_code').value;
  const invite_code = document.getElementById('invite_code').value;
  const errEl = document.getElementById('errorMsg');
  errEl.textContent = '';
  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, signup_code, invite_code })
    });
    const data = await res.json();
    if (!res.ok) {
      errEl.textContent = data.error || 'Could not create account';
      return;
    }
    window.location.href = '/index.html';
  } catch (err) {
    errEl.textContent = 'Could not reach server';
  }
});

checkSignupCodeRequired();
