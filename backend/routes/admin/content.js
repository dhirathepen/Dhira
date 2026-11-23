'use strict';

const express = require('express');
const db = require('../../db');
const { asyncHandler, notFound } = require('../../lib/errors');
const { parse } = require('../../lib/validate');
const { bookSchema, authorSchema } = require('../../lib/schemas');
const { escapeLike, parsePagination, paginationMeta } = require('../../lib/text');
const { serializeBook, serializeAuthor } = require('../../lib/serialize');
const { assertImageExists, cleanSocialLinks } = require('../../lib/content');
const { pruneImage } = require('../../lib/prune');

const router = express.Router();

const BOOK_COLUMNS = [
  'id',
  'title',
  'subtitle',
  'introduction',
  'synopsis',
  'progress_percent',
  'progress_note',
  'status',
  'release_date',
  'cover_image_id',
  'created_at',
  'updated_at',
];

/* ── Books ─────────────────────────────────────────────────────────────────── */

router.get(
  '/books',
  asyncHandler(async (req, res) => {
    const { page, perPage, offset } = parsePagination(req.query, {
      defaultPerPage: 20,
      maxPerPage: 100,
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
      .select(BOOK_COLUMNS)
      .orderBy([{ column: 'created_at', order: 'desc' }, { column: 'id', order: 'desc' }])
      .limit(perPage)
      .offset(offset);

    res.json({
      items: rows.map(serializeBook),
      pagination: paginationMeta({ page, perPage, total }),
    });
  })
);

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

router.post(
  '/books',
  asyncHandler(async (req, res) => {
    const data = parse(bookSchema, req.body);
    await assertImageExists(data.cover_image_id, 'cover_image_id');

    const [row] = await db('books')
      .insert({
        title: data.title,
        subtitle: data.subtitle,
        introduction: data.introduction,
        synopsis: data.synopsis,
        progress_percent: data.progress_percent,
        progress_note: data.progress_note,
        status: data.status,
        release_date: data.release_date,
        cover_image_id: data.cover_image_id,
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      })
      .returning('*');

    res.status(201).json({ book: serializeBook(row) });
  })
);

router.put(
  '/books/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw notFound('Book not found.');

    const existing = await db('books').where({ id }).first();
    if (!existing) throw notFound('Book not found.');

    const data = parse(bookSchema, req.body);
    await assertImageExists(data.cover_image_id, 'cover_image_id');

    const [row] = await db('books')
      .where({ id })
      .update({
        title: data.title,
        subtitle: data.subtitle,
        introduction: data.introduction,
        synopsis: data.synopsis,
        progress_percent: data.progress_percent,
        progress_note: data.progress_note,
        status: data.status,
        release_date: data.release_date,
        cover_image_id: data.cover_image_id,
        updated_at: db.fn.now(),
      })
      .returning('*');

    if (existing.cover_image_id && existing.cover_image_id !== data.cover_image_id) {
      await pruneImage(existing.cover_image_id);
    }

    res.json({ book: serializeBook(row) });
  })
);

router.delete(
  '/books/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw notFound('Book not found.');

    const existing = await db('books').where({ id }).first('id', 'cover_image_id');
    if (!existing) throw notFound('Book not found.');

    await db('books').where({ id }).del();
    await pruneImage(existing.cover_image_id);

    res.json({ message: 'Book deleted.', id });
  })
);

/* ── Author profile ───────────────────────────────────────────────────────── */

router.get(
  '/author',
  asyncHandler(async (req, res) => {
    const row = await db('author_profile').where({ id: 1 }).first();
    res.json({ author: serializeAuthor(row) });
  })
);

router.put(
  '/author',
  asyncHandler(async (req, res) => {
    const data = parse(authorSchema, req.body);
    await assertImageExists(data.profile_image_id, 'profile_image_id');

    const existing = await db('author_profile').where({ id: 1 }).first('profile_image_id');

    const [row] = await db('author_profile')
      .where({ id: 1 })
      .update({
        name: data.name,
        pen_name: data.pen_name,
        tagline: data.tagline,
        introduction: data.introduction,
        biography: data.biography,
        writing_interests: data.writing_interests,
        personal_description: data.personal_description,
        profile_image_id: data.profile_image_id,
        public_email: data.public_email,
        location: data.location,
        social_links: JSON.stringify(cleanSocialLinks(data.social_links)),
        updated_at: db.fn.now(),
      })
      .returning('*');

    if (existing.profile_image_id && existing.profile_image_id !== data.profile_image_id) {
      await pruneImage(existing.profile_image_id);
    }

    res.json({ author: serializeAuthor(row) });
  })
);

module.exports = router;
