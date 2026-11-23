'use strict';

const express = require('express');
const db = require('../db');
const { asyncHandler, HttpError, notFound } = require('../lib/errors');
const { parse } = require('../lib/validate');
const { contactSchema } = require('../lib/schemas');
const { escapeLike, parsePagination, paginationMeta } = require('../lib/text');
const { hashIp } = require('../lib/ip');
const { contactLimiter } = require('../middleware/rateLimit');
const {
  serializePost,
  serializeCategory,
  serializeBook,
  serializeAuthor,
} = require('../lib/serialize');

const router = express.Router();

/* ── shared helpers ───────────────────────────────────────────────────────── */

const POST_COLUMNS = [
  'p.id',
  'p.slug',
  'p.title',
  'p.subtitle',
  'p.excerpt',
  'p.footer_note',
  'p.type',
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

async function tagsForPosts(postIds) {
  const map = new Map();
  if (!postIds.length) return map;

  const rows = await db('post_tags as pt')
    .join('tags as t', 't.id', 'pt.tag_id')
    .whereIn('pt.post_id', postIds)
    .select('pt.post_id', 't.id', 't.name', 't.slug')
    .orderBy('t.name', 'asc');

  for (const row of rows) {
    if (!map.has(row.post_id)) map.set(row.post_id, []);
    map.get(row.post_id).push({ id: row.id, name: row.name, slug: row.slug });
  }
  return map;
}

function normalizeSlug(value) {
  return String(value || '').trim().toLowerCase();
}

/* ── GET /api/posts ───────────────────────────────────────────────────────── */
router.get(
  '/posts',
  asyncHandler(async (req, res) => {
    const { page, perPage, offset } = parsePagination(req.query, {
      defaultPerPage: 9,
      maxPerPage: 50,
    });

    const query = db('posts as p')
      .leftJoin('categories as c', 'c.id', 'p.category_id')
      .where('p.status', 'published');

    const category = normalizeSlug(req.query.category);
    if (category) query.where('c.slug', category);

    const type = String(req.query.type || '').trim().toLowerCase();
    if (type === 'poem' || type === 'article') query.where('p.type', type);

    const featured = String(req.query.featured || '').toLowerCase();
    if (featured === 'true' || featured === '1') query.where('p.featured', true);

    const tag = normalizeSlug(req.query.tag);
    if (tag) {
      query.whereIn(
        'p.id',
        db('post_tags as pt')
          .join('tags as t', 't.id', 'pt.tag_id')
          .where('t.slug', tag)
          .select('pt.post_id')
      );
    }

    const search = String(req.query.q || '').trim().slice(0, 200);
    if (search) {
      const term = `%${escapeLike(search)}%`;
      query.whereRaw(
        "(p.title LIKE ? ESCAPE '\\' OR p.subtitle LIKE ? ESCAPE '\\' OR p.excerpt LIKE ? ESCAPE '\\' OR p.footer_note LIKE ? ESCAPE '\\' OR p.content LIKE ? ESCAPE '\\')",
        [term, term, term, term, term]
      );
    }

    const countRow = await query.clone().count({ count: 'p.id' }).first();
    const total = Number(countRow.count || 0);

    const rows = await query
      .clone()
      .select(POST_COLUMNS)
      .orderBy([
        { column: 'p.published_on', order: 'desc' },
        { column: 'p.id', order: 'desc' },
      ])
      .limit(perPage)
      .offset(offset);

    const tagMap = await tagsForPosts(rows.map((row) => row.id));

    res.json({
      items: rows.map((row) => serializePost(row, tagMap.get(row.id) || [])),
      pagination: paginationMeta({ page, perPage, total }),
    });
  })
);

/* ── GET /api/posts/:slug ─────────────────────────────────────────────────── */
router.get(
  '/posts/:slug',
  asyncHandler(async (req, res) => {
    const slug = String(req.params.slug || '').trim();
    if (!/^[a-z0-9-]{1,100}$/.test(slug)) throw notFound('That piece could not be found.');

    const row = await db('posts as p')
      .leftJoin('categories as c', 'c.id', 'p.category_id')
      .where({ 'p.slug': slug, 'p.status': 'published' })
      .select([...POST_COLUMNS, 'p.content'])
      .first();

    if (!row) throw notFound('That piece could not be found.');

    const tagMap = await tagsForPosts([row.id]);

    const [newer, older] = await Promise.all([
      db('posts')
        .where({ status: 'published' })
        .whereRaw('(published_on, id) > (?, ?)', [row.published_on, row.id])
        .orderBy([
          { column: 'published_on', order: 'asc' },
          { column: 'id', order: 'asc' },
        ])
        .first('slug', 'title'),
      db('posts')
        .where({ status: 'published' })
        .whereRaw('(published_on, id) < (?, ?)', [row.published_on, row.id])
        .orderBy([
          { column: 'published_on', order: 'desc' },
          { column: 'id', order: 'desc' },
        ])
        .first('slug', 'title'),
    ]);

    res.json({
      post: serializePost(row, tagMap.get(row.id) || [], { includeContent: true }),
      newer: newer || null,
      older: older || null,
    });
  })
);

/* ── GET /api/categories ──────────────────────────────────────────────────── */
router.get(
  '/categories',
  asyncHandler(async (req, res) => {
    const rows = await db('categories as c')
      .select(
        'c.*',
        db.raw(
          "(select count(*) from posts p where p.category_id = c.id and p.status = 'published') as post_count"
        )
      )
      .orderBy([{ column: 'c.sort_order', order: 'asc' }, { column: 'c.name', order: 'asc' }]);

    res.json({ items: rows.map(serializeCategory) });
  })
);

/* ── GET /api/tags ────────────────────────────────────────────────────────── */
router.get(
  '/tags',
  asyncHandler(async (req, res) => {
    const rows = await db('tags as t')
      .select(
        't.id',
        't.name',
        't.slug',
        db.raw(
          `(select count(*) from post_tags pt
             join posts p on p.id = pt.post_id
             where pt.tag_id = t.id and p.status = 'published') as post_count`
        )
      )
      .orderBy('t.name', 'asc');

    res.json({
      items: rows
        .map((row) => ({ ...row, post_count: Number(row.post_count) }))
        .filter((row) => row.post_count > 0),
    });
  })
);

/* ── GET /api/books ───────────────────────────────────────────────────────── */
router.get(
  '/books',
  asyncHandler(async (req, res) => {
    const { page, perPage, offset } = parsePagination(req.query, {
      defaultPerPage: 12,
      maxPerPage: 50,
    });

    const query = db('books');

    const status = String(req.query.status || '').trim();
    if (status) query.where({ status });

    const search = String(req.query.q || '').trim().slice(0, 200);
    if (search) {
      const term = `%${escapeLike(search)}%`;
      query.whereRaw(
        "(title LIKE ? ESCAPE '\\' OR subtitle LIKE ? ESCAPE '\\' OR synopsis LIKE ? ESCAPE '\\')",
        [term, term, term]
      );
    }

    const countRow = await query.clone().count({ count: 'id' }).first();
    const total = Number(countRow.count || 0);

    const rows = await query
      .clone()
      .orderBy([{ column: 'created_at', order: 'desc' }, { column: 'id', order: 'desc' }])
      .limit(perPage)
      .offset(offset);

    res.json({
      items: rows.map(serializeBook),
      pagination: paginationMeta({ page, perPage, total }),
    });
  })
);

/* ── GET /api/books/:id ───────────────────────────────────────────────────── */
router.get(
  '/books/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw notFound('Book not found.');

    const row = await db('books').where({ id }).first();
    if (!row) throw notFound('Book not found.');

    res.json({ book: serializeBook(row) });
  })
);

/* ── GET /api/author ──────────────────────────────────────────────────────── */
router.get(
  '/author',
  asyncHandler(async (req, res) => {
    const row = await db('author_profile').where({ id: 1 }).first();
    res.json({ author: serializeAuthor(row) });
  })
);

/* ── POST /api/contact ────────────────────────────────────────────────────── */
router.post(
  '/contact',
  contactLimiter,
  asyncHandler(async (req, res) => {
    const body = req.body || {};

    // Honeypot: real visitors never see or fill this field.
    if (typeof body.website === 'string' && body.website.trim() !== '') {
      throw new HttpError(400, 'Your message could not be sent. Please try again.');
    }

    const data = parse(contactSchema, body);
    const ipHash = hashIp(req.ip);

    // Durable rate limit (survives restarts and multiple app instances).
    const hourly = await db('messages')
      .where({ ip_hash: ipHash })
      .where('created_at', '>', db.raw("datetime('now', '-1 hour')"))
      .count({ count: 'id' })
      .first();

    if (Number(hourly.count) >= 5) {
      throw new HttpError(429, 'You have sent several messages recently. Please try again later.');
    }

    const duplicate = await db('messages')
      .where({ ip_hash: ipHash })
      .whereRaw('lower(subject) = lower(?)', [data.subject])
      .whereRaw('message = ?', [data.message])
      .where('created_at', '>', db.raw("datetime('now', '-10 minutes')"))
      .first('id');

    if (duplicate) {
      return res.status(201).json({
        message: 'Thank you — your message has already reached me. I will write back soon.',
      });
    }

    await db('messages').insert({
      name: data.name,
      email: data.email,
      subject: data.subject,
      message: data.message,
      category: data.category,
      ip_hash: ipHash,
      user_agent: String(req.get('user-agent') || '').slice(0, 300),
    });

    return res.status(201).json({
      message: 'Thank you for writing. Your message has reached me — I will write back soon.',
    });
  })
);

/* ── GET /api/images/:id ──────────────────────────────────────────────────── */
router.get(
  '/images/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw notFound('Image not found.');

    const image = await db('images').where({ id }).first();
    if (!image) throw notFound('Image not found.');

    const etag = `"img-${image.id}-${String(image.checksum).slice(0, 16)}"`;
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.set('ETag', etag);
    res.set('X-Content-Type-Options', 'nosniff');
    res.set(
      'Content-Disposition',
      `inline; filename="${String(image.filename).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120)}"`
    );

    if (req.get('if-none-match') === etag) return res.status(304).end();

    return res.type(image.mime_type).send(image.data);
  })
);

module.exports = router;
