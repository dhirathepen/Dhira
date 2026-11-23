'use strict';

/**
 * CSRF protection — double-submit cookie.
 *
 * A random token is placed in a readable (non-HttpOnly) SameSite=Lax cookie.
 * Every state-changing request must echo it back in the X-CSRF-Token header.
 * The session cookie itself is HttpOnly + SameSite=Lax, so a cross-site page
 * cannot read the CSRF token nor send it along with the session.
 */

const crypto = require('crypto');
const config = require('../config');
const { HttpError } = require('./errors');

const CSRF_COOKIE = config.csrfCookieName;
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function tokenIsValid(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{40,64}$/.test(value);
}

function ensureCsrfCookie(req, res, next) {
  let token = req.cookies ? req.cookies[CSRF_COOKIE] : null;

  if (!tokenIsValid(token)) {
    token = crypto.randomBytes(32).toString('base64url');
    res.cookie(CSRF_COOKIE, token, {
      httpOnly: false,
      sameSite: 'lax',
      secure: config.session.secure,
      path: '/',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });
  }

  req.csrfToken = token;
  res.setHeader('X-CSRF-Token', token);
  next();
}

function originIsAllowed(req) {
  const origin = req.get('origin');
  if (!origin) return true; // Non-browser client; the CSRF token is still required.

  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }

  if (config.allowedOrigins.includes(parsed.origin)) return true;

  // Same-origin requests served by this app.
  const host = req.get('host');
  return Boolean(host) && parsed.host === host;
}

function verifyCsrf(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();

  if (!originIsAllowed(req)) {
    return next(new HttpError(403, 'This request came from an untrusted origin.'));
  }

  const header = req.get('x-csrf-token');
  const cookie = req.cookies ? req.cookies[CSRF_COOKIE] : null;

  if (!tokenIsValid(header) || !tokenIsValid(cookie)) {
    return next(new HttpError(403, 'Your security token is missing or expired. Refresh the page and try again.'));
  }

  const a = Buffer.from(header);
  const b = Buffer.from(cookie);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return next(new HttpError(403, 'Your security token is invalid. Refresh the page and try again.'));
  }

  return next();
}

module.exports = { ensureCsrfCookie, verifyCsrf, CSRF_COOKIE };
