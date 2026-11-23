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

module.exports = { toDbTimestamp, fromDbTimestamp };
