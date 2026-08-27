// Creates all tables if they don't already exist. Safe to run repeatedly.
const db = require('./db');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Other',
  payment_type TEXT NOT NULL DEFAULT 'manual', -- direct_debit | subscription | standing_order | manual
  frequency TEXT NOT NULL DEFAULT 'monthly',   -- one_off | weekly | monthly | yearly
  start_date TEXT NOT NULL,                    -- YYYY-MM-DD, first occurrence
  end_date TEXT,                                -- optional, recurrence stops after this date
  color TEXT,                                   -- optional manual override, else derived from category
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS expense_cost_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  expense_id INTEGER NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  amount REAL NOT NULL,
  effective_date TEXT NOT NULL, -- YYYY-MM-DD, cost applies from this date onward
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cost_history_expense ON expense_cost_history(expense_id, effective_date);

CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY,
  sess TEXT NOT NULL,
  expires INTEGER NOT NULL
);
`);

console.log('Database initialized at data/htracker.db');
