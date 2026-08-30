require('dotenv').config();
require('./init-db'); // idempotent — creates tables if missing

const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const path = require('path');

const SqliteStore = require('./sqlite-session-store');
const { requireAuth, attachHousehold, checkOrigin } = require('./middleware/auth');
const authRoutes = require('./routes/auth');
const expenseRoutes = require('./routes/expenses');
const reportRoutes = require('./routes/reports');
const userRoutes = require('./routes/users');
const monzoRoutes = require('./routes/monzo');

const app = express();
const PORT = process.env.PORT || 3000;

if (process.env.TRUST_PROXY === 'true') {
  app.set('trust proxy', 1); // required behind nginx for secure cookies to work
}

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      manifestSrc: ["'self'"], // manifest.json, for "Add to Home Screen" / install
      workerSrc: ["'self'"]    // sw.js, required to register the service worker
    }
  }
}));
app.use(express.json({ limit: '100kb' }));

app.use(session({
  store: new SqliteStore(),
  name: 'htracker.sid',
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  }
}));

app.use(checkOrigin);

app.use('/api/auth', authRoutes);
app.use('/api/expenses', requireAuth, attachHousehold, expenseRoutes);
app.use('/api/users', requireAuth, userRoutes); // /api/users/me (household routes look up household_id themselves)
// Mounted before the broad '/api' catch-all below, and deliberately NOT wrapped in
// requireAuth here — /api/monzo/webhook/:secret has to be reachable by Monzo's own
// servers, which have no session cookie. Every other route in routes/monzo.js applies
// requireAuth itself. See docs/ADR-001-monzo-integration.md.
app.use('/api/monzo', monzoRoutes);
app.use('/api', requireAuth, attachHousehold, reportRoutes); // /api/summary, /api/calendar, /api/household

// Static frontend
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => res.redirect('/index.html'));

app.get('/health', (req, res) => res.json({ ok: true }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Budgeteer listening on port ${PORT}`);
});
