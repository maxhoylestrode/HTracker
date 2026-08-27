// Interactive CLI to create (or reset) the single admin login.
const readline = require('readline');
const bcrypt = require('bcryptjs');
const db = require('./db');

require('./init-db.js'); // ensure tables exist (idempotent, just logs)

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(question, hidden = false) {
  return new Promise((resolve) => {
    // Fall back to plain (visible) input when stdin isn't a TTY (e.g. piped input,
    // some CI/automation contexts) since raw mode isn't available there.
    if (!hidden || !process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
      rl.question(question, resolve);
      return;
    }
    // hidden input for password on a real terminal
    const stdin = process.stdin;
    process.stdout.write(question);
    let value = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (char) => {
      char = char.toString();
      if (char === '\n' || char === '\r' || char === '') {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener('data', onData);
        process.stdout.write('\n');
        resolve(value);
      } else if (char === '') {
        process.exit(1);
      } else if (char === '') {
        value = value.slice(0, -1);
      } else {
        value += char;
      }
    };
    stdin.on('data', onData);
  });
}

(async () => {
  const username = (await ask('Admin username: ')).trim();
  const password = await ask('Admin password: ', true);
  if (!username || !password || password.length < 8) {
    console.error('Username required and password must be at least 8 characters.');
    process.exit(1);
  }
  const hash = bcrypt.hashSync(password, 12);
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) {
    db.prepare('UPDATE users SET password_hash = ? WHERE username = ?').run(hash, username);
    console.log(`Password updated for existing user "${username}".`);
  } else {
    db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username, hash);
    console.log(`Admin user "${username}" created.`);
  }
  rl.close();
  process.exit(0);
})();
