// Monzo bank connection — see docs/ADR-001-monzo-integration.md for the full design.
//
// Everything here is scoped to req.session.userId, never household_id. A Monzo
// connection is only ever consented to by the one person who approved it via push
// notification in their own Monzo app; it must stay invisible to everyone else,
// including other members of their household.
//
// This router is mounted WITHOUT the blanket requireAuth wrapper the other /api routers
// get in server.js, because /webhook/:secret has to be reachable by Monzo's own servers,
// which obviously don't have a Budgeteer session cookie. Auth is applied per-route below
// instead — every route except the webhook requires a session.
const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { encrypt, decrypt } = require('../lib/crypto');
const monzo = require('../lib/monzo');

const router = express.Router();

function baseUrl(req) {
  return process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`;
}
function callbackUrl(req) {
  return `${baseUrl(req)}/api/monzo/callback`;
}
function webhookUrl(req, secret) {
  return `${baseUrl(req)}/api/monzo/webhook/${secret}`;
}

// Refreshes the access token if it's close to expiring (Monzo tokens last ~6 hours),
// persisting the new tokens, and returns a usable plaintext access token.
async function getValidAccessToken(connection) {
  const bufferMs = 5 * 60 * 1000;
  const expiresAt = new Date(connection.token_expires_at).getTime();
  if (expiresAt - Date.now() > bufferMs) {
    return decrypt(connection.access_token_enc);
  }
  if (!connection.refresh_token_enc) {
    const err = new Error('Monzo access has expired and no refresh token is available — please reconnect');
    err.code = 'MONZO_REAUTH_REQUIRED';
    throw err;
  }
  const refreshToken = decrypt(connection.refresh_token_enc);
  const tokenData = await monzo.refreshAccessToken(refreshToken);
  const newExpiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();
  const accessEnc = encrypt(tokenData.access_token);
  const refreshEnc = tokenData.refresh_token ? encrypt(tokenData.refresh_token) : connection.refresh_token_enc;
  db.prepare('UPDATE bank_connections SET access_token_enc = ?, refresh_token_enc = ?, token_expires_at = ? WHERE id = ?')
    .run(accessEnc, refreshEnc, newExpiresAt, connection.id);
  return tokenData.access_token;
}

function getConnection(userId) {
  return db.prepare("SELECT * FROM bank_connections WHERE user_id = ? AND provider = 'monzo'").get(userId);
}

// GET /api/monzo/connect — a plain link (not fetch), so a redirect actually navigates
// the browser to Monzo rather than being silently followed by JS.
router.get('/connect', (req, res) => {
  if (!req.session || !req.session.userId) return res.redirect('/login.html');
  try {
    const state = crypto.randomBytes(16).toString('hex');
    req.session.monzoState = state;
    const url = monzo.buildAuthorizeUrl({ redirectUri: callbackUrl(req), state });
    res.redirect(url);
  } catch (err) {
    if (err.code === 'MONZO_NOT_CONFIGURED') {
      return res.redirect('/settings.html?monzo=not_configured');
    }
    console.error('Monzo connect failed:', err.message);
    res.redirect('/settings.html?monzo=error');
  }
});

// GET /api/monzo/callback — Monzo redirects the user's browser back here after they
// approve (or decline) access.
router.get('/callback', async (req, res) => {
  if (!req.session || !req.session.userId) return res.redirect('/login.html');

  const { code, state, error: monzoError } = req.query;
  if (monzoError) return res.redirect('/settings.html?monzo=declined');
  if (!code || !state || state !== req.session.monzoState) {
    return res.redirect('/settings.html?monzo=error');
  }
  delete req.session.monzoState;

  try {
    const tokenData = await monzo.exchangeCodeForToken({ code, redirectUri: callbackUrl(req) });
    const accounts = await monzo.listAccounts(tokenData.access_token);
    const account = monzo.pickPrimaryAccount(accounts);
    if (!account) throw new Error('No Monzo account found to connect');

    const existing = getConnection(req.session.userId);

    // Best-effort: clean up any previous webhook before replacing the connection
    // (e.g. reconnecting after a disconnect that failed partway, or just reconnecting).
    if (existing && existing.webhook_id) {
      try {
        const oldAccessToken = decrypt(existing.access_token_enc);
        await monzo.deleteWebhook(oldAccessToken, existing.webhook_id);
      } catch (e) {
        console.error('Could not clean up previous Monzo webhook:', e.message);
      }
    }

    const secret = existing ? existing.webhook_secret : crypto.randomBytes(24).toString('hex');
    const webhook = await monzo.registerWebhook(tokenData.access_token, account.id, webhookUrl(req, secret));

    const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();
    const accessEnc = encrypt(tokenData.access_token);
    const refreshEnc = tokenData.refresh_token ? encrypt(tokenData.refresh_token) : null;

    if (existing) {
      db.prepare(
        `UPDATE bank_connections
         SET monzo_account_id = ?, access_token_enc = ?, refresh_token_enc = ?, token_expires_at = ?,
             webhook_id = ?, webhook_secret = ?, status = 'active'
         WHERE id = ?`
      ).run(account.id, accessEnc, refreshEnc, expiresAt, webhook.id, secret, existing.id);
    } else {
      db.prepare(
        `INSERT INTO bank_connections
           (user_id, provider, monzo_account_id, access_token_enc, refresh_token_enc, token_expires_at, webhook_id, webhook_secret)
         VALUES (?, 'monzo', ?, ?, ?, ?, ?, ?)`
      ).run(req.session.userId, account.id, accessEnc, refreshEnc, expiresAt, webhook.id, secret);
    }

    res.redirect('/settings.html?monzo=connected');
  } catch (err) {
    console.error('Monzo callback failed:', err.message);
    res.redirect('/settings.html?monzo=error');
  }
});

// POST /api/monzo/webhook/:secret — called by Monzo's servers, not a logged-in browser.
// The unguessable secret in the path IS the authentication (Monzo doesn't sign webhook
// payloads), and we additionally cross-check the account_id inside the payload against
// what that specific connection actually owns before storing anything.
router.post('/webhook/:secret', (req, res) => {
  try {
    const connection = db.prepare("SELECT * FROM bank_connections WHERE webhook_secret = ? AND status = 'active'").get(req.params.secret);
    // Always 200 on anything that doesn't check out — no reason to give an attacker
    // probing this endpoint any signal, and it stops Monzo retrying forever on our behalf.
    if (!connection) return res.status(200).json({ ok: true });

    const event = req.body;
    if (!event || event.type !== 'transaction.created' || !event.data) {
      return res.status(200).json({ ok: true });
    }

    const tx = event.data;
    if (tx.account_id !== connection.monzo_account_id) {
      console.error(`Monzo webhook account_id mismatch for connection ${connection.id} — dropped, not stored`);
      return res.status(200).json({ ok: true });
    }

    db.prepare(
      `INSERT OR IGNORE INTO bank_transactions
         (connection_id, monzo_transaction_id, amount, currency, description, merchant_name, category, monzo_created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      connection.id,
      tx.id,
      (tx.amount || 0) / 100,
      tx.currency || 'GBP',
      tx.description || null,
      tx.merchant && tx.merchant.name ? tx.merchant.name : null,
      tx.category || null,
      tx.created
    );
    db.prepare('UPDATE bank_connections SET last_synced_at = ? WHERE id = ?').run(new Date().toISOString(), connection.id);

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Monzo webhook handling error:', err.message);
    res.status(200).json({ ok: true }); // still 200 — don't want Monzo endlessly retrying our own bug
  }
});

// GET /api/monzo/status — is *this* user connected, plus a live balance if so.
router.get('/status', requireAuth, async (req, res) => {
  const connection = getConnection(req.session.userId);
  if (!connection || connection.status !== 'active') {
    return res.json({ connected: false });
  }
  try {
    const accessToken = await getValidAccessToken(connection);
    const balance = await monzo.readBalance(accessToken, connection.monzo_account_id);
    res.json({
      connected: true,
      last_synced_at: connection.last_synced_at,
      balance: balance.balance / 100,
      total_balance: balance.total_balance / 100,
      spend_today: Math.abs(balance.spend_today || 0) / 100,
      currency: balance.currency
    });
  } catch (err) {
    res.json({
      connected: true,
      error: err.code === 'MONZO_REAUTH_REQUIRED' ? 'reauth_required' : 'unavailable',
      balance: null
    });
  }
});

// GET /api/monzo/transactions — this user's own imported transactions only.
router.get('/transactions', requireAuth, (req, res) => {
  const connection = getConnection(req.session.userId);
  if (!connection) return res.json({ transactions: [] });
  const rows = db.prepare(
    `SELECT id, amount, currency, description, merchant_name, category, monzo_created_at, linked_expense_id
     FROM bank_transactions WHERE connection_id = ? ORDER BY monzo_created_at DESC LIMIT 100`
  ).all(connection.id);
  res.json({ transactions: rows });
});

// POST /api/monzo/disconnect
router.post('/disconnect', requireAuth, async (req, res) => {
  const connection = getConnection(req.session.userId);
  if (!connection) return res.json({ ok: true });

  try {
    const accessToken = decrypt(connection.access_token_enc);
    if (connection.webhook_id) {
      try { await monzo.deleteWebhook(accessToken, connection.webhook_id); }
      catch (e) { console.error('Monzo webhook delete failed during disconnect:', e.message); }
    }
    try { await monzo.logout(accessToken); }
    catch (e) { console.error('Monzo logout failed during disconnect:', e.message); }
  } catch (e) {
    console.error('Error during Monzo disconnect cleanup:', e.message);
  }

  db.prepare('DELETE FROM bank_connections WHERE id = ?').run(connection.id); // cascades bank_transactions
  res.json({ ok: true });
});

module.exports = router;
