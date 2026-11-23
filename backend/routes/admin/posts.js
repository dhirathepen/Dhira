'use strict';

const express = require('express');
const db = require('../../db');
const { asyncHandler, HttpError, notFound } = require('../../lib/errors');
const { parse } = require('../../lib/validate');
const { postSchema, postStatusSchema } = require('../../lib/schemas');
const { uniqueSlug } = require('../../lib/slug');
const { escapeLike, parsePagination, paginationMeta } = require('../../lib/text');
const { serializePost } = require('../../lib/serialize');
const {
  computeReadingMinutes,
  deriveExcerpt,
  todayIso,
  assertImageExists,
  resolveCategoryId,
  syncTags,
  getPostDetail,
} = require('../../lib/content');
const { pruneImage } = require('../../lib/prune');

const router = express.Router();

const LIST_COLUMNS = [
  'p.id',
  'p.slug',
  'p.title',
  'p.subtitle',
  'p.excerpt',
  'p.footer_note',
  'p.type',
  'p.status',
  'p.featured',
  'p.published_on',
  'p.cover_image_id',
  'p.reading_minutes',
  'p.created_at',
  'p.updated_at',
  'c.id as category_id',
  'c.name as category_name',
  'c.slug as category_slug',
];

function detailResponse(detail) {
  if (!detail) return null;
  return serializePost(detail.row, detail.tags, { includeContent: true });
}

async function loadTags(postId) {
  return db('post_tags as pt')
    .join('tags as t', 't.id', 'pt.tag_id')
    .where('pt.post_id', postId)
    .select('t.id', 't.name', 't.slug')
    .orderBy('t.name', 'asc');
}

/* ── GET /api/admin/posts ─────────────────────────────────────────────────── */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { page, perPage, offset } = parsePagination(req.query, {
      defaultPerPage: 20,
      maxPerPage: 100,
    });

    const query = db('posts as p').join('categories as c', 'c.id', 'p.category_id');

    const status = String(req.query.status || '').trim();
    if (status === 'draft' || status === 'published') query.where('p.status', status);

    const category = String(req.query.category || '').trim();
    if (category) query.where('c.slug', category);

    const type = String(req.query.type || '').trim();
    if (type === 'poem' || type === 'article') query.where('p.type', type);

    const search = String(req.query.q || '').trim().slice(0, 200);
    if (search) {
      const term = `%${escapeLike(search)}%`;
      query.whereRaw(
        "(p.title LIKE ? ESCAPE '\\' OR p.subtitle LIKE ? ESCAPE '\\' OR p.excerpt LIKE ? ESCAPE '\\' OR p.footer_note LIKE ? ESCAPE '\\')",
        [term, term, term, term]
      );
    }

    const countRow = await query.clone().count({ count: 'p.id' }).first();
    const total = Number(countRow.count || 0);

    const rows = await query
      .clone()
      .select(LIST_COLUMNS)
      .orderBy([
        { column: 'p.updated_at', order: 'desc' },
        { column: 'p.id', order: 'desc' },
      ])
      .limit(perPage)
      .offset(offset);

    const ids = rows.map((row) => row.id);
    const tagMap = new Map();
    if (ids.length) {
      const tagRows = await db('post_tags as pt')
        .join('tags as t', 't.id', 'pt.tag_id')
        .whereIn('pt.post_id', ids)
        .select('pt.post_id', 't.id', 't.name', 't.slug');
      for (const tag of tagRows) {
        if (!tagMap.has(tag.post_id)) tagMap.set(tag.post_id, []);
        tagMap.get(tag.post_id).push({ id: tag.id, name: tag.name, slug: tag.slug });
      }
    }

    res.json({
      items: rows.map((row) => serializePost(row, tagMap.get(row.id) || [])),
      pagination: paginationMeta({ page, perPage, total }),
    });
  })
);

/* ── GET /api/admin/posts/:id ─────────────────────────────────────────────── */
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw notFound('Post not found.');

    const detail = await getPostDetail(id);
    if (!detail) throw notFound('Post not found.');

    res.json({ post: detailResponse(detail) });
  })
);

/* ── POST /api/admin/posts ────────────────────────────────────────────────── */
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const data = parse(postSchema, req.body);
    const categoryId = await resolveCategoryId(data.category_id);
    await assertImageExists(data.cover_image_id);

    const slug = await uniqueSlug(db, 'posts', data.slug || data.title);
    const excerpt = data.excerpt || deriveExcerpt(data.content);
    const publishedOn =
      data.status === 'published' ? data.published_on || todayIso() : data.published_on;

    let postId;
    await db.transaction(async (trx) => {
      const inserted = await trx('posts')
        .insert({
          slug,
          title: data.title,
          subtitle: data.subtitle,
          content: data.content,
          footer_note: data.footer_note,
          excerpt,
          category_id: categoryId,
          type: data.type,
          status: data.status,
          featured: data.featured,
          cover_image_id: data.cover_image_id,
          published_on: publishedOn,
          reading_minutes: computeReadingMinutes(data.content),
          created_at: db.fn.now(),
          updated_at: db.fn.now(),
        })
        .returning('id');

      postId = inserted[0].id;
      await syncTags(trx, postId, data.tags);
    });

    const detail = await getPostDetail(postId);
    res.status(201).json({ post: detailResponse(detail) });
  })
);

/* ── PUT /api/admin/posts/:id ─────────────────────────────────────────────── */
router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw notFound('Post not found.');

    const existing = await db('posts').where({ id }).first();
    if (!existing) throw notFound('Post not found.');

    const data = parse(postSchema, req.body);
    const categoryId = await resolveCategoryId(data.category_id);
    await assertImageExists(data.cover_image_id);

    let slug = existing.slug;
    if (!data.slug) {
      slug = await uniqueSlug(db, 'posts', data.title, id);
    } else if (data.slug !== existing.slug) {
      slug = await uniqueSlug(db, 'posts', data.slug, id);
    }

    const excerpt = data.excerpt || deriveExcerpt(data.content);
    let publishedOn = data.published_on;
    if (data.status === 'published' && !publishedOn) {
      publishedOn = existing.published_on || todayIso();
    }

    await db.transaction(async (trx) => {
      await trx('posts')
        .where({ id })
        .update({
          slug,
          title: data.title,
          subtitle: data.subtitle,
          content: data.content,
          footer_note: data.footer_note,
          excerpt,
          category_id: categoryId,
          type: data.type,
          status: data.status,
          featured: data.featured,
          cover_image_id: data.cover_image_id,
          published_on: publishedOn,
          reading_minutes: computeReadingMinutes(data.content),
          updated_at: db.fn.now(),
        });

      await syncTags(trx, id, data.tags);
    });

    if (existing.cover_image_id && existing.cover_image_id !== data.cover_image_id) {
      await pruneImage(existing.cover_image_id);
    }

    const detail = await getPostDetail(id);
    res.json({ post: detailResponse(detail) });
  })
);

/* ── PATCH /api/admin/posts/:id/status ────────────────────────────────────── */
router.patch(
  '/:id/status',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw notFound('Post not found.');

    const { status } = parse(postStatusSchema, req.body);
    const existing = await db('posts').where({ id }).first();
    if (!existing) throw notFound('Post not found.');

    const update = { status, updated_at: db.fn.now() };
    if (status === 'published' && !existing.published_on) update.published_on = todayIso();

    const [row] = await db('posts').where({ id }).update(update).returning([
      'id',
      'slug',
      'status',
      'published_on',
    ]);

    res.json({ post: row });
  })
);

/* ── DELETE /api/admin/posts/:id ──────────────────────────────────────────── */
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw notFound('Post not found.');

    const existing = await db('posts').where({ id }).first('id', 'cover_image_id');
    if (!existing) throw notFound('Post not found.');

    await db('posts').where({ id }).del();
    await pruneImage(existing.cover_image_id);

    res.json({ message: 'Post deleted.', id });
  })
);

/* ── POST /api/admin/posts/:id/duplicate (small convenience) ───────────────── */
router.post(
  '/:id/duplicate',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw notFound('Post not found.');

    const source = await db('posts').where({ id }).first();
    if (!source) throw notFound('Post not found.');

    const slug = await uniqueSlug(db, 'posts', `${source.slug}-copy`);
    const tagRows = await loadTags(id);

    let newId;
    await db.transaction(async (trx) => {
      const inserted = await trx('posts')
        .insert({
          slug,
          title: `${source.title} (copy)`,
          subtitle: source.subtitle,
          content: source.content,
          footer_note: source.footer_note || '',
          excerpt: source.excerpt,
          category_id: source.category_id,
          type: source.type,
          status: 'draft',
          featured: false,
          cover_image_id: source.cover_image_id,
          published_on: null,
          reading_minutes: source.reading_minutes,
          created_at: db.fn.now(),
          updated_at: db.fn.now(),
        })
        .returning('id');
      newId = inserted[0].id;
      await syncTags(trx, newId, tagRows.map((tag) => tag.name));
    });

    const detail = await getPostDetail(newId);
    res.status(201).json({ post: detailResponse(detail) });
  })
);

module.exports = router;
