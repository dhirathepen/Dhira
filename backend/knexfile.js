'use strict';

const fs = require('fs');
const path = require('path');
const config = require('./config');

// SQLite will not create the parent directory for the database file.
fs.mkdirSync(path.dirname(config.databaseFile), { recursive: true });

/** Shared Knex configuration — used by the app, the CLI and scripts. */
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
  migrations: {
    directory: path.join(__dirname, 'migrations'),
    tableName: 'knex_migrations',
  },
};
