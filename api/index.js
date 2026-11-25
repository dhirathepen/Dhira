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

// Arbitrary constant used with Postgres advisory locks.
const MIGRATION_LOCK_KEY = 726613;

/**
 * Run migrations exactly once across all cold starts.
 *
 * Knex uses a row in `knex_migrations_lock` as its mutex, which stays set
 * forever if the process is killed mid-migration (common on serverless). We
 * therefore serialise on a Postgres *advisory* lock instead: it belongs to the
 * database session, so Postgres releases it automatically when a function
 * dies. Only while holding it do we clear any leftover knex flag and migrate.
 */
async function migrate() {
  if (!config.usePostgres) {
    await db.migrate.latest();
    return;
  }

  const client = db.client;
  const conn = await client.acquireConnection();

  try {
    let locked = false;
    for (let attempt = 0; attempt < 10 && !locked; attempt += 1) {
      const result = await conn.query('select pg_try_advisory_lock($1) as locked', [MIGRATION_LOCK_KEY]);
      locked = Boolean(result.rows[0].locked);
      if (!locked) await sleep(500);
    }

    // Another instance is migrating right now; let it finish.
    if (!locked) return;

    try {
      // Safe to clear: we hold the advisory lock, so no other instance can be
      // mid-migration. Ignored on a brand-new database where the table is absent.
      await conn.query('update knex_migrations_lock set is_locked = 0').catch(() => {});
      await db.migrate.latest();
    } finally {
      await conn.query('select pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]).catch(() => {});
    }
  } finally {
    await client.releaseConnection(conn);
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
