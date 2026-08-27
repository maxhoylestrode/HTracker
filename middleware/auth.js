function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  return res.status(401).json({ error: 'Not authenticated' });
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

module.exports = { requireAuth, checkOrigin };
