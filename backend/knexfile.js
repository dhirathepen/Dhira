'use strict';

const fs = require('fs');
const path = require('path');
const config = require('./config');

const migrations = {
  directory: path.join(__dirname, 'migrations'),
  tableName: 'knex_migrations',
};

/**
 * Local development needs no setup, so it keeps the SQLite file. Whenever
 * DATABASE_URL is present (e.g. a Supabase Postgres connection string), the
 * whole app switches to Postgres with the same schema and queries.
 */
if (config.usePostgres) {
  module.exports = {
    client: 'pg',
    connection: {
      connectionString: config.databaseUrl,
      // Supabase requires TLS. rejectUnauthorized:false keeps the pooler
      // hostname working in minimal serverless CA bundles.
      ssl: config.databaseSsl ? { rejectUnauthorized: false } : false,
    },
    // Serverless invocations come and go — don't hold idle connections open.
    pool: { min: 0, max: 5 },
    acquireConnectionTimeout: 20000,
    migrations,
  };
} else {
  // SQLite will not create the parent directory for the database file.
  fs.mkdirSync(path.dirname(config.databaseFile), { recursive: true });

  module.exports = {
    client: 'sqlite3',
    connection: {
      filename: config.databaseFile,
      // Keep BLOBs and buffers intact; needed for uploaded images.
      supportBigNumbers: true,
    },
    useNullAsDefault: true,
    // A single writer avoids SQLITE_BUSY errors. Reads are still fast because
    // the whole database is a local file.
    pool: {
      min: 1,
      max: 1,
      afterCreate(conn, done) {
        conn.run('PRAGMA foreign_keys = ON', (foreignErr) => {
          if (foreignErr) return done(foreignErr, conn);
          conn.run('PRAGMA journal_mode = WAL', (journalErr) => done(journalErr, conn));
        });
      },
    },
    acquireConnectionTimeout: 20000,
    migrations,
  };
}
