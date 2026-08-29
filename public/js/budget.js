async function loadMyBudget() {
  const me = await api('/api/users/me');
  document.getElementById('myIncome').value = me.monthly_income;
  document.getElementById('mySplit').value = me.split_percentage;
  document.getElementById('mySavings').value = me.savings_goal;
}

async function loadHousehold() {
  const data = await api('/api/users/me/household');
  document.getElementById('inviteCodeDisplay').value = data.invite_code;

  const listEl = document.getElementById('memberList');
  listEl.innerHTML = '';
  data.members.forEach((m) => {
    const chip = document.createElement('span');
    chip.className = 'member-chip';
    chip.textContent = m.username;
    listEl.appendChild(chip);
  });
}

async function loadBreakdown() {
  const data = await api('/api/household');
  const wrap = document.getElementById('breakdownTableWrap');

  if (!data.users.length) {
    wrap.innerHTML = '<p style="color:var(--text-dim)">No one to show yet.</p>';
    return;
  }

  const rows = data.users.map((u) => {
    const leftoverClass = u.leftover_spending_money < 0 ? 'negative' : '';
    return `
      <tr class="${u.is_you ? 'you-row' : ''}">
        <td>${escapeHtml(u.username)}${u.is_you ? '<span class="you-badge">YOU</span>' : ''}</td>
        <td>${fmtMoney(u.monthly_income)}</td>
        <td>${u.normalized_share_percentage}%</td>
        <td>${fmtMoney(u.share_of_bills)}</td>
        <td>${fmtMoney(u.savings_goal)}</td>
        <td class="${leftoverClass}">${fmtMoney(u.leftover_spending_money)}</td>
      </tr>
    `;
  }).join('');

  wrap.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Member</th>
          <th>Monthly income</th>
          <th>Bill share</th>
          <th>Owed towards bills</th>
          <th>Savings goal</th>
          <th>Left to spend</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="field-hint" style="margin-top:0.75rem">Total shared monthly spend: ${fmtMoney(data.total_monthly)}</p>
  `;
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

document.getElementById('myBudgetForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = document.getElementById('myBudgetMsg');
  msg.textContent = '';
  try {
    await api('/api/users/me', {
      method: 'PUT',
      body: JSON.stringify({
        monthly_income: document.getElementById('myIncome').value,
        split_percentage: document.getElementById('mySplit').value,
        savings_goal: document.getElementById('mySavings').value
      })
    });
    await loadBreakdown();
    msg.textContent = 'Saved.';
    msg.style.color = 'var(--success)';
    setTimeout(() => { msg.textContent = ''; }, 2000);
  } catch (err) {
    msg.style.color = 'var(--danger)';
    msg.textContent = err.message;
  }
});

document.getElementById('joinForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = document.getElementById('joinMsg');
  msg.style.color = 'var(--danger)';
  msg.textContent = '';
  const code = document.getElementById('joinCode').value.trim();
  if (!code) return;
  if (!confirm('Joining a different household switches which shared expenses you see. Your own previously entered expenses stay on your current household. Continue?')) return;
  try {
    await api('/api/users/me/household/join', {
      method: 'POST',
      body: JSON.stringify({ invite_code: code })
    });
    document.getElementById('joinCode').value = '';
    await Promise.all([loadHousehold(), loadBreakdown()]);
    msg.style.color = 'var(--success)';
    msg.textContent = 'Joined.';
    setTimeout(() => { msg.textContent = ''; }, 2000);
  } catch (err) {
    msg.textContent = err.message;
  }
});

document.getElementById('copyInviteBtn').addEventListener('click', async () => {
  const input = document.getElementById('inviteCodeDisplay');
  try {
    await navigator.clipboard.writeText(input.value);
  } catch (err) {
    input.select();
    document.execCommand('copy');
  }
  const btn = document.getElementById('copyInviteBtn');
  const original = btn.textContent;
  btn.textContent = 'Copied!';
  setTimeout(() => { btn.textContent = original; }, 1500);
});

document.getElementById('regenerateInviteBtn').addEventListener('click', async () => {
  if (!confirm('This invalidates your current invite code. Anyone who still has the old one won\'t be able to join with it. Continue?')) return;
  const data = await api('/api/users/me/household/regenerate', { method: 'POST' });
  document.getElementById('inviteCodeDisplay').value = data.invite_code;
});

document.addEventListener('DOMContentLoaded', async () => {
  const session = await guardSession();
  if (!session) return;
  loadMyBudget().catch(console.error);
  loadHousehold().catch(console.error);
  loadBreakdown().catch(console.error);
});
