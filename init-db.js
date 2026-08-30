// Creates all tables if they don't already exist. Safe to run repeatedly.
const db = require('./db');
const { generateInviteCode } = require('./lib/invite-code');

db.exec(`
CREATE TABLE IF NOT EXISTS households (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invite_code TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

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

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Bank connections are per-USER, deliberately not tied to household_id — a Monzo
-- connection is only ever consented to by the one person who approved it in their
-- own Monzo app, and must never be visible to anyone else in their household.
CREATE TABLE IF NOT EXISTS bank_connections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'monzo',
  monzo_account_id TEXT NOT NULL,
  access_token_enc TEXT NOT NULL,
  refresh_token_enc TEXT,
  token_expires_at TEXT NOT NULL,
  webhook_id TEXT,
  webhook_secret TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active',
  last_synced_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, provider)
);

CREATE TABLE IF NOT EXISTS bank_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  connection_id INTEGER NOT NULL REFERENCES bank_connections(id) ON DELETE CASCADE,
  monzo_transaction_id TEXT NOT NULL UNIQUE,
  amount REAL NOT NULL,
  currency TEXT NOT NULL,
  description TEXT,
  merchant_name TEXT,
  category TEXT,
  monzo_created_at TEXT NOT NULL,
  linked_expense_id INTEGER REFERENCES expenses(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_bank_transactions_connection ON bank_transactions(connection_id, monzo_created_at);
`);

// --- Idempotent migrations for columns added after the initial release ---
// SQLite has no "ADD COLUMN IF NOT EXISTS", so check pragma table_info first.
// Safe to run against an existing populated database: ALTER TABLE ADD COLUMN
// backfills the DEFAULT value onto every existing row automatically.
function addColumnIfMissing(table, column, definition) {
  const existing = db.prepare(`PRAGMA table_info(${table})`).all();
  const hasColumn = existing.some((c) => c.name === column);
  if (!hasColumn) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    console.log(`Migration: added ${table}.${column}`);
  }
}

addColumnIfMissing('users', 'monthly_income', "REAL NOT NULL DEFAULT 0");
addColumnIfMissing('users', 'split_percentage', "REAL NOT NULL DEFAULT 50");
addColumnIfMissing('users', 'savings_goal', "REAL NOT NULL DEFAULT 0");

// household_id ties a user to a private data pool. Each account is isolated by default
// (its own household); accounts only share expense data when one joins another's
// household via an invite code. Added nullable so existing rows can be backfilled below,
// then every row is guaranteed non-null by the end of this script.
addColumnIfMissing('users', 'household_id', 'INTEGER REFERENCES households(id)');
addColumnIfMissing('users', 'theme', "TEXT NOT NULL DEFAULT 'dark'");
addColumnIfMissing('expenses', 'household_id', 'INTEGER REFERENCES households(id)');

// --- Backfill: give every user without a household their own, and attach any
// orphaned expenses (from before this feature existed) to a household so they
// don't just disappear from view. Fully idempotent — a fresh install has no
// matching rows here and this is a no-op.
function uniqueInviteCode() {
  let code;
  do {
    code = generateInviteCode();
  } while (db.prepare('SELECT 1 FROM households WHERE invite_code = ?').get(code));
  return code;
}

const usersWithoutHousehold = db.prepare('SELECT id FROM users WHERE household_id IS NULL').all();
if (usersWithoutHousehold.length) {
  for (const u of usersWithoutHousehold) {
    const info = db.prepare('INSERT INTO households (invite_code) VALUES (?)').run(uniqueInviteCode());
    db.prepare('UPDATE users SET household_id = ? WHERE id = ?').run(info.lastInsertRowid, u.id);
  }
  console.log(`Migration: created ${usersWithoutHousehold.length} household(s) for existing user(s)`);
}

const orphanExpenseCount = db.prepare('SELECT COUNT(*) AS c FROM expenses WHERE household_id IS NULL').get().c;
if (orphanExpenseCount > 0) {
  // Pre-dates multi-user support entirely, so there was only ever one account.
  // Attach every orphaned expense to that account's household.
  const firstUser = db.prepare('SELECT household_id FROM users ORDER BY id ASC LIMIT 1').get();
  if (firstUser) {
    db.prepare('UPDATE expenses SET household_id = ? WHERE household_id IS NULL').run(firstUser.household_id);
    console.log(`Migration: attached ${orphanExpenseCount} existing expense(s) to household ${firstUser.household_id}`);
  }
}

// --- Token encryption key bootstrap ---
// Auto-generates a key on first boot if TOKEN_ENCRYPTION_KEY isn't set as an env var,
// so encrypting Monzo tokens at rest doesn't require a manual step. Settable via env
// var too, for anyone who'd rather pin/back up the key themselves.
if (!process.env.TOKEN_ENCRYPTION_KEY) {
  const existingKey = db.prepare("SELECT value FROM app_settings WHERE key = 'token_encryption_key'").get();
  if (!existingKey) {
    const crypto = require('crypto');
    const key = crypto.randomBytes(32).toString('base64');
    db.prepare("INSERT INTO app_settings (key, value) VALUES ('token_encryption_key', ?)").run(key);
    console.log('Migration: generated a token encryption key (stored in app_settings)');
  }
}

console.log('Database initialized at data/htracker.db');
