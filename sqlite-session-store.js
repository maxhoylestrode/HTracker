// Minimal express-session store backed by the same better-sqlite3 db.
// Avoids an extra dependency while still persisting sessions across restarts.
const session = require('express-session');
const db = require('./db');

class SqliteStore extends session.Store {
  constructor() {
    super();
    this.cleanup();
    this._cleanupTimer = setInterval(() => this.cleanup(), 15 * 60 * 1000);
    this._cleanupTimer.unref();
  }

  cleanup() {
    db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now());
  }

  get(sid, cb) {
    try {
      const row = db.prepare('SELECT sess, expires FROM sessions WHERE sid = ?').get(sid);
      if (!row || row.expires < Date.now()) return cb(null, null);
      cb(null, JSON.parse(row.sess));
    } catch (err) {
      cb(err);
    }
  }

  set(sid, sess, cb) {
    try {
      const expires = sess.cookie && sess.cookie.expires
        ? new Date(sess.cookie.expires).getTime()
        : Date.now() + 24 * 60 * 60 * 1000;
      db.prepare(
        'INSERT INTO sessions (sid, sess, expires) VALUES (?, ?, ?) ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expires = excluded.expires'
      ).run(sid, JSON.stringify(sess), expires);
      cb && cb();
    } catch (err) {
      cb && cb(err);
    }
  }

  destroy(sid, cb) {
    try {
      db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
      cb && cb();
    } catch (err) {
      cb && cb(err);
    }
  }

  touch(sid, sess, cb) {
    this.set(sid, sess, cb);
  }
}

module.exports = SqliteStore;
