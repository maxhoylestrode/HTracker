const express = require('express');
const db = require('../db');
const { generateInviteCode } = require('../lib/invite-code');
const { ALLOWED_THEMES } = require('../lib/themes');

const router = express.Router();

function serializeSelf(user) {
  return {
    id: user.id,
    username: user.username,
    monthly_income: user.monthly_income,
    split_percentage: user.split_percentage,
    savings_goal: user.savings_goal,
    theme: user.theme
  };
}

router.get('/me', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(serializeSelf(user));
});

router.put('/me', (req, res) => {
  const { monthly_income, split_percentage, savings_goal, theme } = req.body || {};
  const errors = [];
  if (monthly_income !== undefined && (isNaN(Number(monthly_income)) || Number(monthly_income) < 0)) {
    errors.push('monthly_income must be a non-negative number');
  }
  if (split_percentage !== undefined && (isNaN(Number(split_percentage)) || Number(split_percentage) < 0 || Number(split_percentage) > 100)) {
    errors.push('split_percentage must be a number between 0 and 100');
  }
  if (savings_goal !== undefined && (isNaN(Number(savings_goal)) || Number(savings_goal) < 0)) {
    errors.push('savings_goal must be a non-negative number');
  }
  if (theme !== undefined && !ALLOWED_THEMES.includes(theme)) {
    errors.push(`theme must be one of ${ALLOWED_THEMES.join(', ')}`);
  }
  if (errors.length) return res.status(400).json({ error: errors.join('; ') });

  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  const merged = {
    monthly_income: monthly_income !== undefined ? Number(monthly_income) : existing.monthly_income,
    split_percentage: split_percentage !== undefined ? Number(split_percentage) : existing.split_percentage,
    savings_goal: savings_goal !== undefined ? Number(savings_goal) : existing.savings_goal,
    theme: theme !== undefined ? theme : existing.theme
  };

  db.prepare('UPDATE users SET monthly_income = ?, split_percentage = ?, savings_goal = ?, theme = ? WHERE id = ?')
    .run(merged.monthly_income, merged.split_percentage, merged.savings_goal, merged.theme, req.session.userId);

  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  res.json(serializeSelf(updated));
});

// GET /api/users/me/household — your invite code + who currently shares data with you.
router.get('/me/household', (req, res) => {
  const user = db.prepare('SELECT household_id FROM users WHERE id = ?').get(req.session.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const household = db.prepare('SELECT id, invite_code FROM households WHERE id = ?').get(user.household_id);
  const members = db.prepare('SELECT id, username FROM users WHERE household_id = ? ORDER BY id ASC').all(user.household_id);
  res.json({ invite_code: household.invite_code, members });
});

// POST /api/users/me/household/regenerate — invalidates the old code (anyone who had it can no longer join).
router.post('/me/household/regenerate', (req, res) => {
  const user = db.prepare('SELECT household_id FROM users WHERE id = ?').get(req.session.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  let code;
  do {
    code = generateInviteCode();
  } while (db.prepare('SELECT 1 FROM households WHERE invite_code = ?').get(code));

  db.prepare('UPDATE households SET invite_code = ? WHERE id = ?').run(code, user.household_id);
  res.json({ invite_code: code });
});

// POST /api/users/me/household/join { invite_code }
// Switches which household's data you see. Your own previously entered expenses stay
// behind on your old household and won't follow you — this only changes which shared
// pool of expenses your account is looking at.
router.post('/me/household/join', (req, res) => {
  const { invite_code } = req.body || {};
  const trimmed = typeof invite_code === 'string' ? invite_code.trim().toUpperCase() : '';
  if (!trimmed) return res.status(400).json({ error: 'invite_code is required' });

  const household = db.prepare('SELECT * FROM households WHERE invite_code = ?').get(trimmed);
  if (!household) return res.status(400).json({ error: "That invite code doesn't match any household" });

  const user = db.prepare('SELECT household_id FROM users WHERE id = ?').get(req.session.userId);
  if (household.id === user.household_id) {
    return res.status(400).json({ error: "You're already in that household" });
  }

  db.prepare('UPDATE users SET household_id = ? WHERE id = ?').run(household.id, req.session.userId);
  const members = db.prepare('SELECT id, username FROM users WHERE household_id = ? ORDER BY id ASC').all(household.id);
  res.json({ ok: true, invite_code: household.invite_code, members });
});

module.exports = router;
