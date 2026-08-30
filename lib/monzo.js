// Thin client for Monzo's API. https://docs.monzo.com/
// MONZO_CLIENT_ID / MONZO_CLIENT_SECRET are only read when a route actually needs them
// (never at startup) so the app boots fine before Max has set them up.
const API_BASE = 'https://api.monzo.com';
const AUTH_BASE = 'https://auth.monzo.com';

function getClientCredentials() {
  const client_id = process.env.MONZO_CLIENT_ID;
  const client_secret = process.env.MONZO_CLIENT_SECRET;
  if (!client_id || !client_secret) {
    const err = new Error('Monzo isn\'t configured on this server yet (MONZO_CLIENT_ID / MONZO_CLIENT_SECRET missing)');
    err.code = 'MONZO_NOT_CONFIGURED';
    throw err;
  }
  return { client_id, client_secret };
}

async function monzoFetch(path, { method = 'GET', accessToken, form, query } = {}) {
  let url = `${API_BASE}${path}`;
  if (query) {
    const qs = new URLSearchParams(query).toString();
    url += `?${qs}`;
  }
  const headers = {};
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  let body;
  if (form) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    body = new URLSearchParams(form).toString();
  }
  const res = await fetch(url, { method, headers, body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || data.error || `Monzo API error (${res.status})`);
    err.status = res.status;
    err.monzoError = data;
    throw err;
  }
  return data;
}

function buildAuthorizeUrl({ redirectUri, state }) {
  const { client_id } = getClientCredentials();
  const params = new URLSearchParams({
    client_id,
    redirect_uri: redirectUri,
    response_type: 'code',
    state
  });
  return `${AUTH_BASE}/?${params.toString()}`;
}

async function exchangeCodeForToken({ code, redirectUri }) {
  const { client_id, client_secret } = getClientCredentials();
  return monzoFetch('/oauth2/token', {
    method: 'POST',
    form: { grant_type: 'authorization_code', client_id, client_secret, redirect_uri: redirectUri, code }
  });
}

async function refreshAccessToken(refreshToken) {
  const { client_id, client_secret } = getClientCredentials();
  return monzoFetch('/oauth2/token', {
    method: 'POST',
    form: { grant_type: 'refresh_token', client_id, client_secret, refresh_token: refreshToken }
  });
}

async function logout(accessToken) {
  return monzoFetch('/oauth2/logout', { method: 'POST', accessToken });
}

async function listAccounts(accessToken) {
  const data = await monzoFetch('/accounts', { accessToken });
  return data.accounts || [];
}

// Picks the account we actually want to track: a personal current account first,
// falling back to a joint one, falling back to whatever's first if neither matches
// (Monzo's account_type list may grow over time).
function pickPrimaryAccount(accounts) {
  return (
    accounts.find((a) => a.account_type === 'uk_retail') ||
    accounts.find((a) => a.account_type === 'uk_retail_joint') ||
    accounts[0] ||
    null
  );
}

async function readBalance(accessToken, accountId) {
  return monzoFetch('/balance', { accessToken, query: { account_id: accountId } });
}

async function registerWebhook(accessToken, accountId, url) {
  const data = await monzoFetch('/webhooks', {
    method: 'POST',
    accessToken,
    form: { account_id: accountId, url }
  });
  return data.webhook;
}

async function deleteWebhook(accessToken, webhookId) {
  return monzoFetch(`/webhooks/${webhookId}`, { method: 'DELETE', accessToken });
}

module.exports = {
  buildAuthorizeUrl,
  exchangeCodeForToken,
  refreshAccessToken,
  logout,
  listAccounts,
  pickPrimaryAccount,
  readBalance,
  registerWebhook,
  deleteWebhook
};
