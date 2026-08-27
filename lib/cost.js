const db = require('../db');

// Current cost of an expense as of `asOfDate` (ISO string, defaults to today):
// the amount from the most recent history entry with effective_date <= asOfDate.
// Falls back to the earliest known entry if all entries are in the future.
function currentCost(expenseId, asOfDate) {
  const asOf = asOfDate || new Date().toISOString().slice(0, 10);
  const row = db.prepare(
    `SELECT amount FROM expense_cost_history
     WHERE expense_id = ? AND effective_date <= ?
     ORDER BY effective_date DESC LIMIT 1`
  ).get(expenseId, asOf);
  if (row) return row.amount;
  const earliest = db.prepare(
    `SELECT amount FROM expense_cost_history WHERE expense_id = ? ORDER BY effective_date ASC LIMIT 1`
  ).get(expenseId);
  return earliest ? earliest.amount : 0;
}

// The next scheduled cost change after `asOfDate`, or null. Only meaningful once
// a "current" cost is established (i.e. some entry already has effective_date <= asOf) —
// otherwise the earliest entry is just the expense's starting cost, not an increase.
function nextIncrease(expenseId, asOfDate) {
  const asOf = asOfDate || new Date().toISOString().slice(0, 10);
  const hasCurrentEntry = db.prepare(
    `SELECT 1 FROM expense_cost_history WHERE expense_id = ? AND effective_date <= ? LIMIT 1`
  ).get(expenseId, asOf);
  if (!hasCurrentEntry) return null;
  const row = db.prepare(
    `SELECT amount, effective_date, note FROM expense_cost_history
     WHERE expense_id = ? AND effective_date > ?
     ORDER BY effective_date ASC LIMIT 1`
  ).get(expenseId, asOf);
  return row || null;
}

function fullHistory(expenseId) {
  return db.prepare(
    `SELECT id, amount, effective_date, note FROM expense_cost_history WHERE expense_id = ? ORDER BY effective_date ASC`
  ).all(expenseId);
}

module.exports = { currentCost, nextIncrease, fullHistory };
