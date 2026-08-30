// AES-256-GCM helpers for encrypting Monzo OAuth tokens at rest. The key comes from
// TOKEN_ENCRYPTION_KEY if set, otherwise the one init-db.js auto-generated into
// app_settings on first boot (see init-db.js for why).
const crypto = require('crypto');
const db = require('../db');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // recommended for GCM

let cachedKey = null;

function getKey() {
  if (cachedKey) return cachedKey;

  let keyB64 = process.env.TOKEN_ENCRYPTION_KEY;
  if (!keyB64) {
    const row = db.prepare("SELECT value FROM app_settings WHERE key = 'token_encryption_key'").get();
    if (!row) {
      throw new Error('No token encryption key available — init-db.js should have generated one on startup');
    }
    keyB64 = row.value;
  }

  const key = Buffer.from(keyB64, 'base64');
  if (key.length !== 32) {
    throw new Error('Token encryption key must decode to exactly 32 bytes (base64-encoded)');
  }
  cachedKey = key;
  return cachedKey;
}

// Returns "iv.authTag.ciphertext", each base64. A fresh random IV every call — never reuse
// an IV with the same key for GCM.
function encrypt(plaintext) {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString('base64'), authTag.toString('base64'), encrypted.toString('base64')].join('.');
}

function decrypt(payload) {
  const key = getKey();
  const parts = String(payload).split('.');
  if (parts.length !== 3) {
    throw new Error('Malformed encrypted payload');
  }
  const [ivB64, tagB64, dataB64] = parts;
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(tagB64, 'base64');
  const data = Buffer.from(dataB64, 'base64');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString('utf8');
}

module.exports = { encrypt, decrypt };
