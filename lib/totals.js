const db = require('../db');
const { currentCost } = require('./cost');

// Monthly-equivalent value of an expense, for totalling across differing frequencies.
function monthlyEquivalent(amount, frequency) {
  switch (frequency) {
    case 'weekly': return amount * 52 / 12;
    case 'yearly': return amount / 12;
    case 'one_off': return 0; // one-offs are excluded from recurring monthly totals
    default: return amount; // monthly
  }
}

// Total monthly-equivalent spend across a household's active expenses, as of a given date.
function getTotalMonthly(householdId, asOfDate) {
  const today = asOfDate || new Date().toISOString().slice(0, 10);
  const rows = db.prepare('SELECT id, frequency FROM expenses WHERE active = 1 AND household_id = ?').all(householdId);
  let total = 0;
  for (const e of rows) {
    const cost = currentCost(e.id, today);
    total += monthlyEquivalent(cost, e.frequency);
  }
  return Math.round(total * 100) / 100;
}

module.exports = { monthlyEquivalent, getTotalMonthly };
