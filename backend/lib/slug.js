'use strict';

/** Convert a title into a URL-safe slug. */
function slugify(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/** Produce a slug that is not already taken in `table`. */
async function uniqueSlug(db, table, desired, ignoreId = null) {
  let base = slugify(desired);
  if (!base) base = `entry-${Date.now().toString(36)}`;

  let candidate = base;
  for (let suffix = 2; suffix < 500; suffix += 1) {
    const query = db(table).where({ slug: candidate });
    if (ignoreId) query.whereNot({ id: ignoreId });
    const exists = await query.first('id');
    if (!exists) return candidate;
    candidate = `${base}-${suffix}`.slice(0, 90);
  }

  return `${base}-${Date.now().toString(36)}`;
}

module.exports = { slugify, uniqueSlug };
