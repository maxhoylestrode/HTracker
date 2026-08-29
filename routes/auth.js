const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const { generateInviteCode } = require('../lib/invite-code');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again later.' }
});

router.post('/login', loginLimiter, (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'Login failed' });
    req.session.userId = user.id;
    req.session.username = user.username;
    res.json({ ok: true, username: user.username });
  });
});

router.post('/register', loginLimiter, (req, res) => {
  const { username, password, signup_code, invite_code } = req.body || {};

  if (process.env.SIGNUP_CODE) {
    if (signup_code !== process.env.SIGNUP_CODE) {
      return res.status(403).json({ error: 'Invalid signup code' });
    }
  }

  if (!username || typeof username !== 'string' || !username.trim()) {
    return res.status(400).json({ error: 'Username is required' });
  }
  if (!password || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  const trimmedUsername = username.trim();
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(trimmedUsername);
  if (existing) {
    return res.status(409).json({ error: 'That username is already taken' });
  }

  // Joining an existing household (via someone else's invite code) means you'll see
  // and share their expense data. Leave it blank and you get your own private household.
  let household;
  const trimmedInviteCode = typeof invite_code === 'string' ? invite_code.trim().toUpperCase() : '';
  if (trimmedInviteCode) {
    household = db.prepare('SELECT * FROM households WHERE invite_code = ?').get(trimmedInviteCode);
    if (!household) {
      return res.status(400).json({ error: 'That invite code doesn\'t match any household' });
    }
  }

  const hash = bcrypt.hashSync(password, 12);

  const result = db.withTransaction(() => {
    let householdId;
    if (household) {
      householdId = household.id;
    } else {
      let code;
      do {
        code = generateInviteCode();
      } while (db.prepare('SELECT 1 FROM households WHERE invite_code = ?').get(code));
      const hInfo = db.prepare('INSERT INTO households (invite_code) VALUES (?)').run(code);
      householdId = hInfo.lastInsertRowid;
    }
    const info = db.prepare(
      'INSERT INTO users (username, password_hash, household_id) VALUES (?, ?, ?)'
    ).run(trimmedUsername, hash, householdId);
    return { userId: info.lastInsertRowid, householdId };
  });

  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'Registration succeeded but login failed — try signing in' });
    req.session.userId = result.userId;
    req.session.username = trimmedUsername;
    res.status(201).json({ ok: true, username: trimmedUsername, joined_existing_household: !!household });
  });
});

router.get('/signup-required-code', (req, res) => {
  // Lets the frontend know whether to show the invite-code field, without leaking the code itself.
  res.json({ codeRequired: !!process.env.SIGNUP_CODE });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('htracker.sid');
    res.json({ ok: true });
  });
});

router.get('/session', (req, res) => {
  if (req.session && req.session.userId) {
    return res.json({ authenticated: true, username: req.session.username });
  }
  res.json({ authenticated: false });
});

module.exports = router;
