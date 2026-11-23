'use strict';

const db = require('../db');
const { HttpError } = require('./errors');
const { slugify } = require('./slug');

function computeReadingMinutes(content) {
  const words = String(content || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 200));
}

function deriveExcerpt(content, max = 180) {
  const flat = String(content || '').replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const slice = flat.slice(0, max);
  const lastSpace = slice.lastIndexOf(' ');
  return `${(lastSpace > 120 ? slice.slice(0, lastSpace) : slice).trim()}…`;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

async function assertImageExists(imageId, field = 'cover_image_id') {
  if (!imageId) return;
  const exists = await db('images').where({ id: imageId }).first('id');
  if (!exists) {
    throw new HttpError(400, 'That image no longer exists. Please upload it again.', {
      [field]: 'That image no longer exists. Please upload it again.',
    });
  }
}

/**
 * Posts no longer ask the author for a category. Keep a sensible internal
 * default so existing taxonomy/search still works without exposing it in the UI.
 */
async function resolveCategoryId(categoryId) {
  if (categoryId !== null && categoryId !== undefined) {
    const category = await db('categories').where({ id: categoryId }).first('id');
    if (!category) {
      throw new HttpError(400, 'Choose an existing category.', {
        category_id: 'Choose an existing category.',
      });
    }
    return category.id;
  }

  const preferred = await db('categories').where({ slug: 'wits' }).first('id');
  if (preferred) return preferred.id;

  const fallback = await db('categories')
    .orderBy([{ column: 'sort_order', order: 'asc' }, { column: 'id', order: 'asc' }])
    .first('id');
  if (!fallback) {
    throw new HttpError(400, 'No writing category is available. Please add one first.', {
      category_id: 'No writing category is available. Please add one first.',
    });
  }
  return fallback.id;
}

/** Replace a post's tags, creating any tag that does not exist yet. */
async function syncTags(trx, postId, names) {
  await trx('post_tags').where({ post_id: postId }).del();
  if (!names || !names.length) return;

  for (const name of names) {
    const slug = slugify(name) || `tag-${Date.now().toString(36)}`;
    let tag = await trx('tags').where({ slug }).first('id');

    if (!tag) {
      const inserted = await trx('tags')
        .insert({ slug, name })
        .onConflict('slug')
        .ignore()
        .returning('id');
      if (inserted.length) {
        tag = inserted[0];
      } else {
        tag = await trx('tags').where({ slug }).first('id');
      }
    }

    if (tag) {
      await trx('post_tags')
        .insert({ post_id: postId, tag_id: tag.id })
        .onConflict(['post_id', 'tag_id'])
        .ignore();
    }
  }
}

async function getPostDetail(id) {
  const row = await db('posts as p')
    .join('categories as c', 'c.id', 'p.category_id')
    .where('p.id', id)
    .select(
      'p.*',
      'c.name as category_name',
      'c.slug as category_slug'
    )
    .first();

  if (!row) return null;

  const tags = await db('post_tags as pt')
    .join('tags as t', 't.id', 'pt.tag_id')
    .where('pt.post_id', id)
    .select('t.id', 't.name', 't.slug')
    .orderBy('t.name', 'asc');

  return { row, tags };
}

function cleanSocialLinks(links) {
  const out = {};
  for (const [key, value] of Object.entries(links || {})) {
    if (typeof value === 'string' && value.trim()) out[key] = value.trim();
  }
  return out;
}

module.exports = {
  computeReadingMinutes,
  deriveExcerpt,
  todayIso,
  assertImageExists,
  resolveCategoryId,
  syncTags,
  getPostDetail,
  cleanSocialLinks,
};
