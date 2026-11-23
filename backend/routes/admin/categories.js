'use strict';

const express = require('express');
const db = require('../../db');
const { asyncHandler, HttpError, notFound } = require('../../lib/errors');
const { parse } = require('../../lib/validate');
const { categorySchema } = require('../../lib/schemas');
const { uniqueSlug } = require('../../lib/slug');
const { serializeCategory } = require('../../lib/serialize');

const router = express.Router();

/* ── GET /api/admin/categories ────────────────────────────────────────────── */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const rows = await db('categories as c')
      .select(
        'c.*',
        db.raw('(select count(*) from posts p where p.category_id = c.id) as post_count'),
        db.raw(
          "(select count(*) from posts p where p.category_id = c.id and p.status = 'published') as published_count"
        )
      )
      .orderBy([{ column: 'c.sort_order', order: 'asc' }, { column: 'c.name', order: 'asc' }]);

    res.json({
      items: rows.map((row) => ({
        ...serializeCategory(row),
        published_count: Number(row.published_count || 0),
      })),
    });
  })
);

/* ── POST /api/admin/categories ───────────────────────────────────────────── */
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const data = parse(categorySchema, req.body);
    const slug = await uniqueSlug(db, 'categories', data.slug || data.name);

    const maxRow = await db('categories').max({ value: 'sort_order' }).first();
    const sortOrder = Number(maxRow.value || 0) + 1;

    const [row] = await db('categories')
      .insert({
        slug,
        name: data.name,
        description: data.description,
        sort_order: sortOrder,
        updated_at: db.fn.now(),
      })
      .returning('*');

    res.status(201).json({ category: serializeCategory(row) });
  })
);

/* ── PUT /api/admin/categories/:id ────────────────────────────────────────── */
router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw notFound('Category not found.');

    const existing = await db('categories').where({ id }).first();
    if (!existing) throw notFound('Category not found.');

    const data = parse(categorySchema, req.body);
    let slug = existing.slug;
    if (data.slug && data.slug !== existing.slug) {
      slug = await uniqueSlug(db, 'categories', data.slug, id);
    }

    const [row] = await db('categories')
      .where({ id })
      .update({
        name: data.name,
        description: data.description,
        slug,
        updated_at: db.fn.now(),
      })
      .returning('*');

    res.json({ category: serializeCategory(row) });
  })
);

/* ── DELETE /api/admin/categories/:id ─────────────────────────────────────── */
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw notFound('Category not found.');

    const used = await db('posts').where({ category_id: id }).count({ count: 'id' }).first();
    if (Number(used.count) > 0) {
      throw new HttpError(
        409,
        `This category still holds ${used.count} post(s). Move or delete them first.`
      );
    }

    const deleted = await db('categories').where({ id }).del();
    if (!deleted) throw notFound('Category not found.');

    res.json({ message: 'Category deleted.', id });
  })
);

/* ── GET /api/admin/categories/tags ───────────────────────────────────────── */
router.get(
  '/tags/all',
  asyncHandler(async (req, res) => {
    const rows = await db('tags as t')
      .select(
        't.id',
        't.name',
        't.slug',
        db.raw('(select count(*) from post_tags pt where pt.tag_id = t.id) as post_count')
      )
      .orderBy('t.name', 'asc');

    res.json({
      items: rows.map((row) => ({ ...row, post_count: Number(row.post_count) })),
    });
  })
);

/* ── DELETE /api/admin/categories/tags/:tagId ─────────────────────────────── */
router.delete(
  '/tags/:tagId',
  asyncHandler(async (req, res) => {
    const tagId = Number(req.params.tagId);
    if (!Number.isInteger(tagId) || tagId <= 0) throw notFound('Tag not found.');

    const deleted = await db('tags').where({ id: tagId }).del();
    if (!deleted) throw notFound('Tag not found.');

    res.json({ message: 'Tag removed.', id: tagId });
  })
);

module.exports = router;
