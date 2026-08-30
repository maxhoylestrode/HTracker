# ADR-001: Monzo bank connection (live balance + transactions)

**Status:** Accepted
**Date:** 2026-08-30
**Deciders:** Max

## Context

Budgeteer currently only tracks expenses the user enters manually. Max asked whether it's
realistic to connect his Monzo account for live transaction/balance data, given multiple
people use the app (each with their own account, some sharing a household with others).

Monzo's Developer API is explicitly scoped for this: "You may only connect to your own
account or those of a small set of users you explicitly allow" — no business/FCA
verification needed for personal use, unlike a public Open Banking aggregator (TrueLayer,
Plaid, GoCardless). It uses OAuth2 with Strong Customer Authentication: the user approves
access via a push notification in their own Monzo app, so credentials never touch Budgeteer.

**Critical constraint, explicitly raised by Max:** other people use this app. A bank
connection must be strictly per-person — connecting your Monzo must never expose or sync
anyone else's data, and someone who hasn't connected anything must be completely unaffected.

## Decision

Build a Monzo OAuth connection that is scoped to the individual **user**, not the household,
mirroring how `monthly_income` / `split_percentage` / `savings_goal` already work per-user
rather than per-household. Live transactions/balance are visible only to the user who
connected them. Nothing about this feature is shared automatically — sharing a specific
imported transaction into the household's tracked expenses is a deliberate future action a
user takes, not a side effect of connecting.

This works cleanly because Monzo's OAuth handshake is inherently single-account: the
authorization only ever happens against whichever Monzo account approves the push
notification. There's no code path where connecting your own account could pull in someone
else's — the risk Max was actually asking about doesn't exist in Monzo's model as long as
the *storage* on our side keys everything by `user_id`, which is the one thing worth stating
explicitly rather than assuming.

## Options Considered

### Option A: Per-user connection, private by default (chosen)
| Dimension | Assessment |
|---|---|
| Complexity | Medium — one new table set, OAuth flow, webhook receiver, token refresh |
| Matches existing patterns | Yes — same shape as per-user budget fields already in `users` |
| Privacy | Matches explicit requirement: your bank data is yours unless you choose to surface it |

**Pros:** Directly answers Max's concern; no cross-account leakage possible even by accident, since every query is scoped by the authenticated `req.session.userId`, never `req.householdId`.
**Cons:** If two household members both want a shared "our joint spending" view, that has to be built as an explicit opt-in later (e.g. "share this transaction to household expenses"), not automatic.

### Option B: Per-household connection (rejected)
One person connects Monzo "for the household," everyone in that household sees it.

**Pros:** Simpler mental model if a household genuinely has one shared account.
**Cons:** Directly contradicts what Max asked for. Also factually wrong for most households — Monzo joint accounts aside, most people have *personal* current accounts, and whoever did the OAuth approval is the only one who actually gave consent. Rejected.

### Option C: Full Open Banking aggregator (TrueLayer/GoCardless) instead of Monzo's own API (rejected for now)
Would support other banks, not just Monzo.

**Pros:** Not locked to one bank.
**Cons:** Real onboarding overhead (registering as a business, sandbox-to-production approval), and nobody's asked for another bank yet. Monzo's own API is the right starting point; this is a natural "later" if Max or a household member ever needs a non-Monzo bank.

## Data Model

```sql
CREATE TABLE bank_connections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,   -- per-USER, not household
  provider TEXT NOT NULL DEFAULT 'monzo',
  monzo_account_id TEXT NOT NULL,
  access_token_enc TEXT NOT NULL,       -- AES-256-GCM encrypted, never stored plaintext
  refresh_token_enc TEXT,
  token_expires_at TEXT NOT NULL,
  webhook_id TEXT,
  webhook_secret TEXT NOT NULL UNIQUE,  -- unguessable per-connection path segment, see Security
  status TEXT NOT NULL DEFAULT 'active', -- active | revoked | error
  last_synced_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, provider)             -- one Monzo connection per user for now
);

CREATE TABLE bank_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  connection_id INTEGER NOT NULL REFERENCES bank_connections(id) ON DELETE CASCADE,
  monzo_transaction_id TEXT NOT NULL UNIQUE,
  amount REAL NOT NULL,                 -- pounds, converted from Monzo's minor units
  currency TEXT NOT NULL,
  description TEXT,
  merchant_name TEXT,
  category TEXT,
  monzo_created_at TEXT NOT NULL,
  linked_expense_id INTEGER REFERENCES expenses(id),  -- nullable; set only if user explicitly links it
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE app_settings (              -- generic key/value store
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);                                        -- first use: auto-generated token encryption key
```

Every query against these tables is scoped by `user_id` (via the connection row), the same
way `expenses` is scoped by `household_id` today — but this is deliberately the *other* axis,
matching the per-person nature of a bank account.

## Auth & routes

- `GET /api/monzo/connect` — builds the Monzo authorize URL (`client_id`, `redirect_uri`, a
  random `state` stashed in the session), redirects the browser.
- `GET /api/monzo/callback` — exchanges `code` for tokens, calls `/accounts` to get the
  Monzo account id, encrypts + stores the connection, registers a webhook pointing at
  `/api/monzo/webhook/:webhook_secret`, redirects back to Settings.
- `POST /api/monzo/webhook/:webhook_secret` — **not** behind session auth (Monzo's servers
  call this, not a logged-in browser). Looks up the connection by `webhook_secret`, verifies
  the payload's `account_id` matches that connection's `monzo_account_id`, upserts the
  transaction. Anything that doesn't match is dropped, not stored.
- `GET /api/monzo/status` — is *this* user connected, last synced, live balance (fetched
  live from Monzo, not cached).
- `GET /api/monzo/transactions` — this user's own imported transactions only.
- `POST /api/monzo/disconnect` — calls Monzo's `/oauth2/logout`, deletes the webhook, deletes
  the connection row (and cascades its transactions).
- A small helper refreshes the access token (~6hr lifetime) on demand before any Monzo API
  call if it's close to expiring, using the stored refresh token — confidential clients only,
  which is what we'll register.

## Security

- **Tokens encrypted at rest** with AES-256-GCM. The key is auto-generated on first boot and
  stored in `app_settings` if `TOKEN_ENCRYPTION_KEY` isn't set as an env var — keeps the
  "just Force Build, no manual DB steps" property for everything except the one step that
  can't be automated (below). Settable via env var too, for anyone who wants to pin/rotate it.
- **Webhook authenticity**: Monzo's webhook payloads aren't signed (no HMAC header, unlike
  e.g. Stripe), so the unguessable per-connection `webhook_secret` in the URL path *is* the
  authentication — plus we re-check the `account_id` inside the payload against what that
  connection actually owns before trusting anything.
- **Never household-scoped**: no route in this feature ever queries by `household_id`. If
  that ever changes, it'll be a deliberate, separate, opt-in "share to household" action on a
  specific transaction — not a property of the connection itself.
- **Revocable**: disconnecting actually calls Monzo's logout endpoint, not just a local
  delete, so the token stops working on Monzo's side too.

## One unavoidable manual step

Everything above still fits the "Force Build and it just works" pattern **except** creating
the Monzo OAuth client itself — that has to happen in Max's own Monzo developer account,
which only he can do:

1. Register a client at developers.monzo.com, type **confidential** (needed for refresh
   tokens — a public client would force re-login every ~6 hours).
2. Redirect URI: `https://tracker.apexstudio.dev/api/monzo/callback` (exact match required).
3. Set `MONZO_CLIENT_ID` and `MONZO_CLIENT_SECRET` as CapRover App Config env vars.

That's it — three values, one CapRover screen, no code involved. I'll write the exact
click-by-click steps when this is ready to test rather than now, since Monzo's developer
portal UI could easily have moved since my training data.

## Consequences

- **What becomes easier:** live balance/spend visibility without manually logging every
  transaction; a foundation for later auto-matching real transactions against tracked
  recurring expenses (e.g. flag a price change the moment Monzo sees it).
- **What becomes harder:** Budgeteer now holds live bank tokens, which is a meaningfully
  higher stakes category of data than expense records — encryption, revocation, and the
  strict per-user scoping in this doc aren't optional polish, they're the point.
- **What I can't test myself:** unlike everything built so far, I have no Monzo account of my
  own — the actual OAuth handshake (push-notification approval) and real webhook delivery
  can only be exercised by Max after deployment. I'll build and verify everything around it
  (encryption round-trip, webhook payload handling, migration safety, token refresh logic)
  with synthetic data, but the live connect flow is a "try it and tell me what happens" step.
- **What we'll need to revisit:** whether/how a connected transaction should be able to
  auto-fill or reconcile against an existing manually-tracked expense; whether other banks
  are ever needed (Option C).

## Action Items

1. [ ] Migration: `bank_connections`, `bank_transactions`, `app_settings` tables + encryption key bootstrap
2. [ ] `lib/crypto.js` — encrypt/decrypt helpers, tested round-trip
3. [ ] `lib/monzo.js` — thin API client (token exchange, refresh, accounts, balance, webhook register/delete, logout)
4. [ ] `routes/monzo.js` — connect/callback/status/transactions/disconnect, all scoped to `req.session.userId`
5. [ ] Webhook route registered outside the normal `requireAuth`/`attachHousehold` middleware stack, with its own secret-path lookup
6. [ ] Settings page: Connect/Disconnect Monzo section + connection status
7. [ ] Dashboard: optional live balance card, visible only to the connected user
8. [ ] Give Max exact Monzo developer-portal steps + the two env vars to set
9. [ ] Max completes the real OAuth handshake and confirms a transaction actually arrives via webhook
