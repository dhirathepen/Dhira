'use strict';

/**
 * Knex's SQLite driver stores JavaScript Date objects as millisecond integers,
 * while CURRENT_TIMESTAMP is 'YYYY-MM-DD HH:MM:SS' text. Mixing the two makes
 * comparisons silently fail, so every date written to SQLite goes through here.
 */
function toDbTimestamp(value) {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().replace('T', ' ').slice(0, 19);
}

function fromDbTimestamp(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return new Date(value);
  const text = String(value);
  return new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(text)
    ? text.replace(' ', 'T') + 'Z'
    : text);
}

/**
 * Dialect-neutral "now minus N minutes" for rate-limit queries.
 * Values passed here are internal constants, never user input.
 */
function nowMinus(db, minutes) {
  const amount = Number(minutes);
  if (!Number.isFinite(amount)) throw new TypeError('minutes must be a number');
  if (db.client && db.client.config && db.client.config.client === 'pg') {
    return db.raw(`NOW() - INTERVAL '${amount} minutes'`);
  }
  return db.raw(`datetime('now', '-${amount} minutes')`);
}

/**
 * Postgres DATE columns come back as Date objects while SQLite returns text.
 * Normalize both to the API's `YYYY-MM-DD` shape without a timezone shift.
 */
function toDateOnly(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

module.exports = { toDbTimestamp, fromDbTimestamp, nowMinus, toDateOnly };
