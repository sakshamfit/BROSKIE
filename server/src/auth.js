const jwt = require('jsonwebtoken');
const db = require('./db');

// A predictable secret is convenient for throwaway local development only.
// Production containers must receive a unique secret through their runtime
// environment; failing early prevents accidentally issuing production tokens
// that anyone can forge.
const SECRET = process.env.JWT_SECRET || (process.env.NODE_ENV === 'production' ? null : 'tomodachi-dev-secret-change-me');
if (!SECRET) {
  throw new Error('JWT_SECRET is required when NODE_ENV=production');
}

function sign(user) {
  return jwt.sign({ id: user.id, username: user.username }, SECRET, { expiresIn: '30d', algorithm: 'HS256' });
}

function verify(token) {
  try {
    // Algorithm pinned: tokens are always HS256, so a crafted header can never
    // negotiate a different verification path.
    return jwt.verify(token, SECRET, { algorithms: ['HS256'] });
  } catch (e) {
    return null;
  }
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const payload = token && verify(token);
  if (!payload) return res.status(401).json({ error: 'Unauthorized' });
  // A correctly signed token must stop working immediately after its One ID
  // is deleted (including on another device).
  const exists = db.prepare('SELECT 1 FROM users WHERE id = ?').get(payload.id);
  if (!exists) return res.status(401).json({ error: 'Unauthorized' });
  req.userId = payload.id;
  next();
}

module.exports = { sign, verify, requireAuth, SECRET };
