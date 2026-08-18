const jwt = require('jsonwebtoken');
const db = require('./db');

const SECRET = process.env.JWT_SECRET || 'tomodachi-dev-secret-change-me';

function sign(user) {
  return jwt.sign({ id: user.id, username: user.username }, SECRET, { expiresIn: '30d' });
}

function verify(token) {
  try {
    return jwt.verify(token, SECRET);
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
