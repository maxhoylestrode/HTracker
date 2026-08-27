const express = require('express');
const db = require('../db');
const { currentCost, nextIncrease, fullHistory } = require('../lib/cost');
const { nextOccurrence, occurrencesInRange } = require('../lib/dates');
const { colorFor, PAYMENT_TYPES, FREQUENCIES } = require('../lib/categories');

const router = express.Router();

function serialize(expense, asOfDate) {
  const today = asOfDate || new Date().toISOString().slice(0, 10);
  return {
    id: expense.id,
    name: expense.name,
    category: expense.category,
    payment_type: expense.payment_type,
    frequency: expense.frequency,
    start_date: expense.start_date,
    end_date: expense.end_date,
    notes: expense.notes,
    active: !!expense.active,
    color: colorFor(expense.category, expense.color),
    current_cost: currentCost(expense.id, today),
    next_increase: nextIncrease(expense.id, today),
    next_due_date: nextOccurrence(expense, today)
  };
}

function validatePayload(body, { partial = false } = {}) {
  const errors = [];
  if (!partial || body.name !== undefined) {
    if (!body.name || typeof body.name !== 'string' || !body.name.trim()) errors.push('name is required');
  }
  if (!partial || body.payment_type !== undefined) {
    if (!PAYMENT_TYPES.includes(body.payment_type)) errors.push(`payment_type must be one of ${PAYMENT_TYPES.join(', ')}`);
  }
  if (!partial || body.frequency !== undefined) {
    if (!FREQUENCIES.includes(body.frequency)) errors.push(`frequency must be one of ${FREQUENCIES.join(', ')}`);
  }
  if (!partial || body.start_date !== undefined) {
    if (!body.start_date || !/^\d{4}-\d{2}-\d{2}$/.test(body.start_date)) errors.push('start_date must be YYYY-MM-DD');
  }
  if (body.end_date && !/^\d{4}-\d{2}-\d{2}$/.test(body.end_date)) errors.push('end_date must be YYYY-MM-DD');
  if (!partial) {
    if (body.amount === undefined || isNaN(Number(body.amount))) errors.push('amount is required and must be a number');
  }
  return errors;
}

// GET /api/expenses?active=1
router.get('/', (req, res) => {
  let sql = 'SELECT * FROM expenses';
  const params = [];
  if (req.query.active !== undefined) {
    sql += ' WHERE active = ?';
    params.push(req.query.active === '1' ? 1 : 0);
  }
  sql += ' ORDER BY name COLLATE NOCASE ASC';
  const rows = db.prepare(sql).all(...params);
  res.json(rows.map((r) => serialize(r)));
});

router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM expenses WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json({ ...serialize(row), history: fullHistory(row.id) });
});

router.post('/', (req, res) => {
  const body = req.body || {};
  const errors = validatePayload(body);
  if (errors.length) return res.status(400).json({ error: errors.join('; ') });

  const id = db.withTransaction(() => {
    const info = db.prepare(
      `INSERT INTO expenses (name, category, payment_type, frequency, start_date, end_date, color, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      body.name.trim(),
      body.category || 'Other',
      body.payment_type,
      body.frequency,
      body.start_date,
      body.end_date || null,
      body.color || null,
      body.notes || null
    );
    db.prepare(
      `INSERT INTO expense_cost_history (expense_id, amount, effective_date, note) VALUES (?, ?, ?, ?)`
    ).run(info.lastInsertRowid, Number(body.amount), body.start_date, 'Initial cost');
    return info.lastInsertRowid;
  });
  const row = db.prepare('SELECT * FROM expenses WHERE id = ?').get(id);
  res.status(201).json(serialize(row));
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM expenses WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const body = req.body || {};
  const errors = validatePayload(body, { partial: true });
  if (errors.length) return res.status(400).json({ error: errors.join('; ') });

  const merged = {
    name: body.name !== undefined ? body.name.trim() : existing.name,
    category: body.category !== undefined ? body.category : existing.category,
    payment_type: body.payment_type !== undefined ? body.payment_type : existing.payment_type,
    frequency: body.frequency !== undefined ? body.frequency : existing.frequency,
    start_date: body.start_date !== undefined ? body.start_date : existing.start_date,
    end_date: body.end_date !== undefined ? body.end_date : existing.end_date,
    color: body.color !== undefined ? body.color : existing.color,
    notes: body.notes !== undefined ? body.notes : existing.notes,
    active: body.active !== undefined ? (body.active ? 1 : 0) : existing.active
  };

  db.prepare(
    `UPDATE expenses SET name=?, category=?, payment_type=?, frequency=?, start_date=?, end_date=?, color=?, notes=?, active=?, updated_at=datetime('now') WHERE id=?`
  ).run(merged.name, merged.category, merged.payment_type, merged.frequency, merged.start_date, merged.end_date, merged.color, merged.notes, merged.active, req.params.id);

  const row = db.prepare('SELECT * FROM expenses WHERE id = ?').get(req.params.id);
  res.json(serialize(row));
});

router.delete('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM expenses WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM expenses WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// POST /api/expenses/:id/cost-change  { amount, effective_date, note }
router.post('/:id/cost-change', (req, res) => {
  const existing = db.prepare('SELECT * FROM expenses WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const { amount, effective_date, note } = req.body || {};
  if (amount === undefined || isNaN(Number(amount))) return res.status(400).json({ error: 'amount is required' });
  if (!effective_date || !/^\d{4}-\d{2}-\d{2}$/.test(effective_date)) return res.status(400).json({ error: 'effective_date must be YYYY-MM-DD' });

  db.prepare(
    `INSERT INTO expense_cost_history (expense_id, amount, effective_date, note) VALUES (?, ?, ?, ?)`
  ).run(req.params.id, Number(amount), effective_date, note || null);

  res.status(201).json({ history: fullHistory(req.params.id) });
});

router.delete('/:id/cost-change/:historyId', (req, res) => {
  const existing = db.prepare('SELECT * FROM expenses WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM expense_cost_history WHERE id = ? AND expense_id = ?').run(req.params.historyId, req.params.id);
  res.json({ history: fullHistory(req.params.id) });
});

module.exports = router;
