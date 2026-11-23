'use strict';

const express = require('express');
const db = require('../db');
const { asyncHandler } = require('../lib/errors');
const { parse } = require('../lib/validate');
const { loginSchema, passwordChangeSchema } = require('../lib/schemas');
const { verifyPassword, burnPasswordCheck, hashPassword } = require('../lib/password');
const {
  createSession,
  revokeSession,
  revokeAllSessions,
} = require('../lib/session');
const requireAdmin = require('../middleware/requireAdmin');
const { authLimiter } = require('../middleware/rateLimit');
const { toDbTimestamp, fromDbTimestamp } = require('../lib/dates');

const router = express.Router();

const GENERIC_LOGIN_ERROR = 'Invalid username or password.';
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

// ── POST /api/auth/login ─────────────────────────────────────────────────────
router.post(
  '/login',
  authLimiter,
  asyncHandler(async (req, res) => {
    const { username, password } = parse(loginSchema, req.body);
    const normalized = username.toLowerCase();

    const admin = await db('admins').where({ username: normalized }).first();

    if (!admin) {
      await burnPasswordCheck(password);
      return res.status(401).json({ error: GENERIC_LOGIN_ERROR });
    }

    if (admin.locked_until && fromDbTimestamp(admin.locked_until).getTime() > Date.now()) {
      return res.status(429).json({
        error: `Too many failed attempts. Please try again in ${LOCK_MINUTES} minutes.`,
      });
    }

    const valid = await verifyPassword(password, admin.password_hash);

    if (!valid) {
      const attempts = admin.failed_attempts + 1;
      const shouldLock = attempts >= MAX_FAILED_ATTEMPTS;
      await db('admins')
        .where({ id: admin.id })
        .update({
          failed_attempts: shouldLock ? 0 : attempts,
          locked_until: shouldLock
            ? toDbTimestamp(new Date(Date.now() + LOCK_MINUTES * 60 * 1000))
            : null,
          updated_at: db.fn.now(),
        });

      if (shouldLock) {
        return res.status(429).json({
          error: `Too many failed attempts. Please try again in ${LOCK_MINUTES} minutes.`,
        });
      }
      return res.status(401).json({ error: GENERIC_LOGIN_ERROR });
    }

    await db('admins')
      .where({ id: admin.id })
      .update({
        failed_attempts: 0,
        locked_until: null,
        last_login_at: db.fn.now(),
        updated_at: db.fn.now(),
      });

    // Issue a brand-new session id on every login (prevents session fixation).
    if (req.authSessionId) {
      await db('sessions').where({ id: req.authSessionId }).del();
    }
    await createSession(admin.id, req, res);

    return res.json({ admin: { id: admin.id, username: admin.username } });
  })
);

// ── POST /api/auth/logout ────────────────────────────────────────────────────
router.post(
  '/logout',
  asyncHandler(async (req, res) => {
    await revokeSession(req, res);
    res.json({ message: 'Signed out.' });
  })
);

// ── GET /api/auth/me ─────────────────────────────────────────────────────────
router.get(
  '/me',
  requireAdmin,
  asyncHandler(async (req, res) => {
    res.json({
      admin: {
        id: req.admin.id,
        username: req.admin.username,
        last_login_at: req.admin.last_login_at,
      },
    });
  })
);

// ── POST /api/auth/password ──────────────────────────────────────────────────
router.post(
  '/password',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { current_password: currentPassword, new_password: newPassword } = parse(
      passwordChangeSchema,
      req.body
    );

    const admin = await db('admins').where({ id: req.admin.id }).first();
    if (!admin) return res.status(401).json({ error: 'Please sign in again.' });

    const valid = await verifyPassword(currentPassword, admin.password_hash);
    if (!valid) {
      return res.status(400).json({
        error: 'Your current password is incorrect.',
        fields: { current_password: 'Your current password is incorrect.' },
      });
    }

    if (await verifyPassword(newPassword, admin.password_hash)) {
      return res.status(400).json({
        error: 'Choose a password you have not used before.',
        fields: { new_password: 'Choose a password you have not used before.' },
      });
    }

    const passwordHash = await hashPassword(newPassword);
    await db('admins')
      .where({ id: admin.id })
      .update({ password_hash: passwordHash, updated_at: db.fn.now() });

    // Sign out every other device, keep the current session.
    await revokeAllSessions(admin.id, req.authSessionId);

    res.json({ message: 'Password updated. Other sessions have been signed out.' });
  })
);

module.exports = router;
