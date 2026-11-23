'use strict';

const crypto = require('crypto');
const db = require('../db');
const config = require('../config');
const { hashIp } = require('./ip');
const { toDbTimestamp } = require('./dates');

const COOKIE_NAME = config.session.cookieName;
const TTL_MS = config.session.ttlDays * 24 * 60 * 60 * 1000;

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.session.secure,
    path: '/',
    maxAge: TTL_MS,
  };
}

async function createSession(adminId, req, res) {
  const rawToken = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + TTL_MS);

  await db('sessions').insert({
    token_hash: hashToken(rawToken),
    admin_id: adminId,
    expires_at: toDbTimestamp(expiresAt),
    ip_hash: hashIp(req.ip),
    user_agent: String(req.get('user-agent') || '').slice(0, 300),
  });

  res.cookie(COOKIE_NAME, rawToken, cookieOptions());
  return rawToken;
}

/** Attach req.admin when a valid session cookie is present. */
async function attachSession(req, res, next) {
  try {
    const rawToken = req.cookies ? req.cookies[COOKIE_NAME] : null;
    if (!rawToken || rawToken.length < 20 || rawToken.length > 200) return next();

    const row = await db('sessions as s')
      .join('admins as a', 'a.id', 's.admin_id')
      .where('s.token_hash', hashToken(rawToken))
      .where('s.expires_at', '>', db.fn.now())
      .select(
        's.id as session_id',
        's.expires_at',
        'a.id as admin_id',
        'a.username',
        'a.last_login_at'
      )
      .first();

    if (!row) {
      res.clearCookie(COOKIE_NAME, { ...cookieOptions(), maxAge: undefined });
      return next();
    }

    req.admin = { id: row.admin_id, username: row.username, last_login_at: row.last_login_at };
    req.authSessionId = row.session_id;
    return next();
  } catch (err) {
    return next(err);
  }
}

async function revokeSession(req, res) {
  if (req.authSessionId) {
    await db('sessions').where({ id: req.authSessionId }).del();
  }
  res.clearCookie(COOKIE_NAME, { ...cookieOptions(), maxAge: undefined });
}

async function revokeAllSessions(adminId, keepSessionId = null) {
  const query = db('sessions').where({ admin_id: adminId });
  if (keepSessionId) query.whereNot({ id: keepSessionId });
  await query.del();
}

async function deleteExpiredSessions() {
  await db('sessions').where('expires_at', '<', db.fn.now()).del();
}

module.exports = {
  COOKIE_NAME,
  createSession,
  attachSession,
  revokeSession,
  revokeAllSessions,
  deleteExpiredSessions,
};
