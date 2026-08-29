const crypto = require('crypto');

// Avoids visually ambiguous characters (0/O, 1/I/L).
const CHARSET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function generateInviteCode(length = 8) {
  let code = '';
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    code += CHARSET[bytes[i] % CHARSET.length];
  }
  return code;
}

module.exports = { generateInviteCode };
