'use strict';

/**
 * Vercel serverless entry point.
 *
 * The Express app is created once per warm function instance. Migrations and
 * default content are only ensured on a cold start, then reused for later
 * requests in the same instance.
 */

const crypto = require('crypto');
const db = require('../backend/db');
const config = require('../backend/config');
const app = require('../backend/app');
const { ensureDefaults } = require('../backend/lib/bootstrap');
const { deleteExpiredSessions } = require('../backend/lib/session');

function isMigrationLocked(err) {
  return Boolean(
    err && (err.name === 'MigrationLocked' || /already locked|migrations are locked/i.test(err.message || ''))
  );
}

/**
 * Automatic migrations are best-effort only. Supabase's transaction pooler
 * (PgBouncer, port 6543) does not support session-level advisory locks, so
 * concurrency is handled by the one-shot /api/migrate endpoint instead.
 */
async function migrate() {
  try {
    await db.migrate.latest();
  } catch (err) {
    if (!isMigrationLocked(err)) throw err;
    const [, pending] = await db.migrate.list();
    if (pending.length) throw err;
  }
}

/** Constant-time comparison of the one-shot migration token. */
function migrateTokenMatches(req) {
  const expected = process.env.MIGRATE_TOKEN || config.ipHashSecret;
  if (!expected) return false;
  const provided = new URL(req.url, 'http://localhost').searchParams.get('token') || '';
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * GET /api/migrate?token=...&unlock=1
 *
 * Runs migrations once from a single invocation, which is safe with a
 * transaction pooler. `unlock=1` also clears a stale knex migration flag left
 * behind by an interrupted cold start.
 */
async function handleMigrate(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const result = { ok: false };

  try {
    await db.raw('select 1');

    if (url.searchParams.get('unlock') === '1') {
      try {
        await db.raw('update knex_migrations_lock set is_locked = 0');
        result.unlocked = true;
      } catch (err) {
        result.unlocked = err.message;
      }
    }

    const [batch, applied] = await db.migrate.latest();
    result.ok = true;
    result.batch = batch;
    result.applied = applied;

    const [, pending] = await db.migrate.list();
    result.pending = pending;

    try {
      await ensureDefaults();
      result.seeded = true;
    } catch (err) {
      result.seedError = err.message;
    }
  } catch (err) {
    result.error = err.message;
    result.code = err.code || null;
  }

  res.statusCode = result.ok ? 200 : 500;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(result, null, 2));
}

let ready;

/**
 * Turn a bootstrap failure into a short, non-secret code so the deployment can
 * be diagnosed from the browser without digging through function logs.
 */
function failureCode(err) {
  if (!err) return 'UNKNOWN';
  const message = String(err.message || '');
  if (err.name === 'MigrationLocked' || /already locked|migrations are locked/i.test(message)) {
    return 'MIGRATION_LOCKED';
  }
  if (/does not exist/i.test(message)) return 'SCHEMA_MISSING';
  if (['ENOTFOUND', 'ETIMEDOUT', 'ECONNREFUSED', 'ECONNRESET'].includes(err.code)) return 'DB_UNREACHABLE';
  if (err.code === '28P01' || /password authentication failed/i.test(message)) return 'DB_AUTH';
  if (/self[- ]signed|certificate/i.test(message)) return 'DB_TLS';
  if (err.code === '23505') return 'DUPLICATE_KEY';
  return err.code ? String(err.code) : 'BOOTSTRAP_FAILED';
}

function bootstrap() {
  if (!ready) {
    ready = (async () => {
      await db.raw('select 1');
      if (config.runMigrations) await migrate();
      try {
        await ensureDefaults();
      } catch (err) {
        // A second instance may have seeded the same defaults concurrently.
        if (err.code !== '23505') throw err;
      }
      await deleteExpiredSessions();
    })().catch((err) => {
      // Let a later invocation retry after a transient database hiccup.
      ready = undefined;
      throw err;
    });
  }
  return ready;
}

module.exports = async function handler(req, res) {
  const pathname = new URL(req.url, 'http://localhost').pathname;

  if (pathname === '/api/migrate') {
    if (!migrateTokenMatches(req)) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Not found.' }));
      return;
    }
    return handleMigrate(req, res);
  }

  try {
    await bootstrap();
  } catch (err) {
    const code = failureCode(err);
    console.error('[bootstrap]', code, err);
    if (!res.headersSent) {
      res.statusCode = 503;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify({ error: 'The site is temporarily unavailable.', code }));
      return;
    }
  }

  // Keep the function alive until Express has finished writing the response.
  return new Promise((resolve, reject) => {
    res.once('finish', resolve);
    res.once('close', resolve);
    try {
      app(req, res);
    } catch (err) {
      reject(err);
    }
  });
};
