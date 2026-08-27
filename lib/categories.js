// Fixed palette so colors stay consistent across dashboard, calendar, and lists.
const CATEGORY_COLORS = {
  Housing: '#3b82f6',      // blue
  Utilities: '#f97316',    // orange
  Subscriptions: '#a855f7',// purple
  Insurance: '#14b8a6',    // teal
  Groceries: '#22c55e',    // green
  Transport: '#eab308',    // yellow
  Debt: '#ef4444',         // red
  Childcare: '#ec4899',    // pink
  Other: '#6b7280'         // gray
};

const PAYMENT_TYPES = ['direct_debit', 'subscription', 'standing_order', 'manual'];
const FREQUENCIES = ['one_off', 'weekly', 'monthly', 'yearly'];

function colorFor(category, override) {
  if (override) return override;
  return CATEGORY_COLORS[category] || CATEGORY_COLORS.Other;
}

module.exports = { CATEGORY_COLORS, PAYMENT_TYPES, FREQUENCIES, colorFor };
