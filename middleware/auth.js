const db = require('../db');

function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  return res.status(401).json({ error: 'Not authenticated' });
}

// Looks up the requesting user's household fresh from the DB on every request
// (rather than trusting a value cached in the session), since a user can switch
// households after logging in by joining a different invite code.
function attachHousehold(req, res, next) {
  const user = db.prepare('SELECT household_id FROM users WHERE id = ?').get(req.session.userId);
  if (!user || !user.household_id) return res.status(401).json({ error: 'Not authenticated' });
  req.householdId = user.household_id;
  next();
}

// Lightweight CSRF mitigation for a same-origin JSON API: reject state-changing
// requests whose Origin/Referer doesn't match our own host.
function checkOrigin(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin') || req.get('referer');
  if (!origin) return next(); // some HTTP clients omit it; session cookie is the primary defense
  try {
    const originHost = new URL(origin).host;
    if (originHost === req.get('host')) return next();
  } catch (e) {
    // fall through to reject
  }
  return res.status(403).json({ error: 'Origin mismatch' });
}

module.exports = { requireAuth, attachHousehold, checkOrigin };
