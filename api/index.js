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

let ready;

function bootstrap() {
  if (!ready) {
    ready = (async () => {
      await db.raw('select 1');
      if (config.runMigrations) await db.migrate.latest();
      await ensureDefaults();
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
    console.error('[bootstrap]', err);
    if (!res.headersSent) {
      res.statusCode = 503;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'The site is temporarily unavailable.' }));
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
