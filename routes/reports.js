const express = require('express');
const db = require('../db');
const { currentCost, nextIncrease } = require('../lib/cost');
const { occurrencesInRange, nextOccurrence, addMonths, toISO, parseISO } = require('../lib/dates');
const { colorFor } = require('../lib/categories');

const router = express.Router();

// Monthly-equivalent value of an expense, for totalling across differing frequencies.
function monthlyEquivalent(amount, frequency) {
  switch (frequency) {
    case 'weekly': return amount * 52 / 12;
    case 'yearly': return amount / 12;
    case 'one_off': return 0; // one-offs are excluded from recurring monthly totals
    default: return amount; // monthly
  }
}

router.get('/summary', (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const rows = db.prepare('SELECT * FROM expenses WHERE active = 1').all();

  let totalMonthly = 0;
  const byCategory = {};
  const byPaymentType = {};
  const upcomingIncreases = [];
  const upcoming30 = [];

  const rangeEnd = toISO(addMonths(parseISO(today), 1));

  for (const e of rows) {
    const cost = currentCost(e.id, today);
    const monthlyVal = monthlyEquivalent(cost, e.frequency);
    totalMonthly += monthlyVal;

    byCategory[e.category] = (byCategory[e.category] || 0) + monthlyVal;
    byPaymentType[e.payment_type] = (byPaymentType[e.payment_type] || 0) + monthlyVal;

    const inc = nextIncrease(e.id, today);
    if (inc) upcomingIncreases.push({ expense_id: e.id, name: e.name, ...inc });

    const occ = occurrencesInRange(e, today, rangeEnd);
    for (const date of occ) {
      upcoming30.push({
        expense_id: e.id,
        name: e.name,
        date,
        amount: currentCost(e.id, date),
        category: e.category,
        payment_type: e.payment_type,
        color: colorFor(e.category, e.color)
      });
    }
  }

  upcoming30.sort((a, b) => a.date.localeCompare(b.date));
  upcomingIncreases.sort((a, b) => a.effective_date.localeCompare(b.effective_date));

  res.json({
    as_of: today,
    total_monthly: Math.round(totalMonthly * 100) / 100,
    active_expense_count: rows.length,
    by_category: byCategory,
    by_payment_type: byPaymentType,
    upcoming_30_days: upcoming30.slice(0, 50),
    upcoming_cost_increases: upcomingIncreases.slice(0, 20)
  });
});

// GET /api/calendar?month=2026-08  -> all occurrences within that calendar month
router.get('/calendar', (req, res) => {
  const month = req.query.month; // "YYYY-MM"
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: 'month must be YYYY-MM' });
  }
  const rangeStart = `${month}-01`;
  const start = parseISO(rangeStart);
  const rangeEnd = toISO(addMonths(start, 1)); // exclusive-ish upper bound, occurrencesInRange is inclusive so subtract a day conceptually
  const inclusiveEnd = toISO(new Date(parseISO(rangeEnd).getTime() - 86400000));

  const rows = db.prepare('SELECT * FROM expenses WHERE active = 1').all();
  const events = [];
  for (const e of rows) {
    const occ = occurrencesInRange(e, rangeStart, inclusiveEnd);
    for (const date of occ) {
      events.push({
        expense_id: e.id,
        name: e.name,
        date,
        amount: currentCost(e.id, date),
        category: e.category,
        payment_type: e.payment_type,
        color: colorFor(e.category, e.color)
      });
    }
  }
  events.sort((a, b) => a.date.localeCompare(b.date));
  res.json({ month, events });
});

module.exports = router;
