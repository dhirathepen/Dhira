'use strict';

/**
 * Reset all site content back to the seeded defaults, keeping admin accounts,
 * contact messages and sessions untouched.
 *
 *   node resetdb.js
 *
 * Child tables are deleted explicitly in foreign-key-safe order so this works
 * on both SQLite and Postgres/Supabase.
 */

const db = require('./db');
const { ensureDefaults } = require('./lib/bootstrap');
const config = require('./config');

async function reset() {
  console.log(
    `Resetting content in ${config.usePostgres ? 'Supabase Postgres' : config.databaseFile} ...`
  );

  // Children first: post_tags -> posts, then everything referencing images.
  const contentTables = [
    'post_tags',
    'posts',
    'books',
    'author_profile',
    'categories',
    'images',
  ];

  for (const table of contentTables) {
    await db(table).del();
  }

  // SQLite keeps AUTOINCREMENT counters in sqlite_sequence; Postgres does not.
  if (!config.usePostgres) {
    const hasSequence = await db.raw(
      "select count(*) as n from sqlite_master where type = 'table' and name = 'sqlite_sequence'"
    );
    if (Number(hasSequence[0].n) > 0) {
      await db.raw('delete from sqlite_sequence where name in (?)', [contentTables]);
    }
  }

  // ensureDefaults() seeds categories, book info and the author profile.
  await ensureDefaults();

  console.log('✓ DB reset to clean defaults');
}

reset()
  .then(() => db.destroy())
  .catch((err) => {
    console.error('✗ Reset failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => db.destroy());
