'use strict';

const app = require('./app');
const db = require('./db');
const config = require('./config');
const { ensureDefaults } = require('./lib/bootstrap');
const { deleteExpiredSessions } = require('./lib/session');

async function start() {
  await db.raw('select 1');
  const dbLabel = config.usePostgres
    ? `Supabase Postgres (${new URL(config.databaseUrl).host})`
    : `SQLite (${config.databaseFile})`;
  console.log(`✓ Database connected: ${dbLabel}`);

  if (config.runMigrations) {
    const [, applied] = await db.migrate.latest();
    if (applied.length) {
      console.log(`✓ Applied ${applied.length} database migration(s)`);
    } else {
      console.log('✓ Database schema is up to date');
    }
  }

  await ensureDefaults();
  await deleteExpiredSessions();

  // Housekeeping: drop expired sessions once an hour.
  const cleanup = setInterval(() => {
    deleteExpiredSessions().catch((err) => console.error('[session cleanup]', err.message));
  }, 60 * 60 * 1000);
  cleanup.unref();

  const server = app.listen(config.port, () => {
    console.log(`✓ Dhira is running at http://localhost:${config.port}`);
    console.log(`  Admin: http://localhost:${config.port}/admin`);
  });

  server.on('error', (err) => {
    console.error('✗ Server error:', err.message);
  });

  const shutdown = (signal) => {
    console.log(`\n${signal} received — closing server…`);
    server.close(async () => {
      try {
        await db.destroy();
      } finally {
        process.exit(0);
      }
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

start().catch(async (err) => {
  console.error('✗ Failed to start:', err.message);
  if (config.env !== 'production' && err.stack) console.error(err.stack);
  await db.destroy().catch(() => {});
  process.exit(1);
});
