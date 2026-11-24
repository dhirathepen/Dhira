'use strict';

/**
 * Create a consistent snapshot of the local SQLite database.
 *
 *   npm run db:backup
 *
 * VACUUM INTO writes a compact single-file copy that includes anything still
 * in the WAL, so the backup is safe to take while the server is running.
 * Supabase/Postgres backups are managed from the Supabase dashboard instead.
 */

const fs = require('fs');
const path = require('path');
const db = require('../db');
const config = require('../config');

async function backup() {
  if (config.usePostgres) {
    console.log('This site is using Supabase Postgres.');
    console.log('Create or schedule a backup in Supabase → Project Settings → Database → Backups.');
    return;
  }

  const backupDir = path.resolve(__dirname, '..', '..', 'backups');
  fs.mkdirSync(backupDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(backupDir, `dhira-${stamp}.sqlite`);
  const sqlPath = file.replace(/'/g, "''");

  console.log(`Creating backup: ${file}`);
  await db.raw(`VACUUM INTO '${sqlPath}'`);
  const { size } = await fs.promises.stat(file);
  console.log(`✓ Backup written to ${file} (${(size / 1024).toFixed(1)} KB)`);
  console.log(`  Restore: stop the server, then copy this file over ${config.databaseFile}`);
}

backup()
  .catch((err) => {
    console.error('✗ Backup failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => db.destroy());
