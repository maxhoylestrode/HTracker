let currentYear, currentMonth; // currentMonth is 0-indexed

function todayISO() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

async function loadMonth(year, month) {
  currentYear = year;
  currentMonth = month;
  const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
  document.getElementById('monthLabel').textContent = new Date(year, month, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  const data = await api(`/api/calendar?month=${monthStr}`);
  renderGrid(year, month, data.events);
}

function renderGrid(year, month, events) {
  const grid = document.getElementById('calGrid');
  grid.innerHTML = '';

  ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].forEach((d) => {
    const el = document.createElement('div');
    el.className = 'cal-dow';
    el.textContent = d;
    grid.appendChild(el);
  });

  const firstDay = new Date(year, month, 1);
  // Convert JS Sunday=0 to Monday-first index
  const startOffset = (firstDay.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const eventsByDay = {};
  events.forEach((ev) => {
    (eventsByDay[ev.date] = eventsByDay[ev.date] || []).push(ev);
  });

  for (let i = 0; i < startOffset; i++) {
    const cell = document.createElement('div');
    cell.className = 'cal-cell empty';
    grid.appendChild(cell);
  }

  const today = todayISO();
  for (let day = 1; day <= daysInMonth; day++) {
    const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const cell = document.createElement('div');
    cell.className = 'cal-cell' + (iso === today ? ' today' : '');
    const num = document.createElement('div');
    num.className = 'day-num';
    num.textContent = day;
    cell.appendChild(num);

    (eventsByDay[iso] || []).forEach((ev) => {
      const evEl = document.createElement('div');
      evEl.className = 'cal-event';
      evEl.style.background = ev.color;
      evEl.textContent = `${ev.name} — ${fmtMoney(ev.amount)}`;
      evEl.title = `${ev.name} — ${fmtMoney(ev.amount)} (${PAYMENT_TYPE_LABELS[ev.payment_type] || ev.payment_type})`;
      evEl.addEventListener('click', () => openEventModal(ev));
      cell.appendChild(evEl);
    });

    grid.appendChild(cell);
  }
}

function openEventModal(ev) {
  document.getElementById('eventModalTitle').textContent = ev.name;
  document.getElementById('eventModalBody').innerHTML = `
    <p><strong>Amount:</strong> ${fmtMoney(ev.amount)}</p>
    <p><strong>Date:</strong> ${fmtDate(ev.date)}</p>
    <p><strong>Category:</strong> ${ev.category}</p>
    <p><strong>Payment type:</strong> ${PAYMENT_TYPE_LABELS[ev.payment_type] || ev.payment_type}</p>
  `;
  document.getElementById('viewExpenseLink').href = `/expenses.html?id=${ev.expense_id}`;
  document.getElementById('eventModal').classList.remove('hidden');
}

document.addEventListener('DOMContentLoaded', async () => {
  const session = await guardSession();
  if (!session) return;

  const now = new Date();
  loadMonth(now.getFullYear(), now.getMonth()).catch(console.error);

  document.getElementById('prevMonth').addEventListener('click', () => {
    let y = currentYear, m = currentMonth - 1;
    if (m < 0) { m = 11; y--; }
    loadMonth(y, m).catch(console.error);
  });
  document.getElementById('nextMonth').addEventListener('click', () => {
    let y = currentYear, m = currentMonth + 1;
    if (m > 11) { m = 0; y++; }
    loadMonth(y, m).catch(console.error);
  });
  document.getElementById('todayBtn').addEventListener('click', () => {
    const n = new Date();
    loadMonth(n.getFullYear(), n.getMonth()).catch(console.error);
  });
  document.getElementById('closeEventModal').addEventListener('click', () => {
    document.getElementById('eventModal').classList.add('hidden');
  });
});
