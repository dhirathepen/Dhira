'use strict';

/**
 * Vercel serverless entry point.
 *
 * The Express app is created once per warm function instance. Migrations and
 * default content are only ensured on a cold start, then reused for later
 * requests in the same instance.
 */

const db = require('../backend/db');
const config = require('../backend/config');
const app = require('../backend/app');
const { ensureDefaults } = require('../backend/lib/bootstrap');
const { deleteExpiredSessions } = require('../backend/lib/session');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isMigrationLocked(err) {
  return Boolean(
    err && (err.name === 'MigrationLocked' || /already locked/i.test(err.message || ''))
  );
}

/**
 * Serverless cold starts can overlap, so two instances may try to migrate at
 * the same time. Knex only lets one hold the lock. When that happens we wait
 * and then check whether the other instance already finished the work; a lock
 * left behind by a killed instance is ignored once nothing is pending.
 */
async function migrate() {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await db.migrate.latest();
      return;
    } catch (err) {
      if (!isMigrationLocked(err)) throw err;

      const [, pending] = await db.migrate.list();
      if (!pending.length) return;

      // Keep this short: serverless functions have a hard time limit, and a
      // stale lock is the far more common case than a long-running migration.
      if (attempt >= 2) {
        const locked = new Error(
          'Database migrations are locked. Release the stale lock in the Supabase SQL editor: ' +
            'update knex_migrations_lock set is_locked = 0;'
        );
        locked.name = 'MigrationLocked';
        throw locked;
      }

      await sleep(500 * (attempt + 1));
    }
  }
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
