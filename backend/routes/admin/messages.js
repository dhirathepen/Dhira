'use strict';

const express = require('express');
const db = require('../../db');
const { asyncHandler, notFound } = require('../../lib/errors');
const { parse } = require('../../lib/validate');
const { messageUpdateSchema } = require('../../lib/schemas');
const { escapeLike, parsePagination, paginationMeta } = require('../../lib/text');
const { serializeMessage } = require('../../lib/serialize');

const router = express.Router();

/* ── GET /api/admin/messages ──────────────────────────────────────────────── */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { page, perPage, offset } = parsePagination(req.query, {
      defaultPerPage: 20,
      maxPerPage: 100,
    });

    const query = db('messages');

    const status = String(req.query.status || '').trim();
    if (status === 'unread') query.where({ is_read: false });
    if (status === 'read') query.where({ is_read: true });

    const category = String(req.query.category || '').trim();
    if (category) query.where({ category });

    const search = String(req.query.q || '').trim().slice(0, 200);
    if (search) {
      const term = `%${escapeLike(search)}%`;
      query.whereRaw(
        "(name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\' OR subject LIKE ? ESCAPE '\\' OR message LIKE ? ESCAPE '\\')",
        [term, term, term, term]
      );
    }

    const countRow = await query.clone().count({ count: 'id' }).first();
    const total = Number(countRow.count || 0);

    const rows = await query
      .clone()
      .select(
        'id',
        'name',
        'email',
        'subject',
        'category',
        'is_read',
        'read_at',
        'created_at',
        db.raw('substr(message, 1, 220) as preview'),
        db.raw('length(message) as message_length')
      )
      .orderBy([{ column: 'created_at', order: 'desc' }, { column: 'id', order: 'desc' }])
      .limit(perPage)
      .offset(offset);

    const counts = await db('messages')
      .select(
        db.raw('count(*) as total'),
        db.raw('sum(case when is_read = false then 1 else 0 end) as unread')
      )
      .first();

    res.json({
      // SQLite stores booleans as 0/1; keep the API shape consistent.
      items: rows.map((row) => ({
        ...row,
        is_read: Boolean(row.is_read),
        message_length: Number(row.message_length),
      })),
      counts: { total: Number(counts.total), unread: Number(counts.unread) },
      pagination: paginationMeta({ page, perPage, total }),
    });
  })
);

/* ── GET /api/admin/messages/:id ──────────────────────────────────────────── */
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw notFound('Message not found.');

    const existing = await db('messages').where({ id }).first();
    if (!existing) throw notFound('Message not found.');

    let row = existing;
    if (!existing.is_read) {
      const updated = await db('messages')
        .where({ id })
        .update({ is_read: true, read_at: db.fn.now() })
        .returning('*');
      row = updated[0];
    }

    res.json({ message: serializeMessage(row) });
  })
);

/* ── PATCH /api/admin/messages/:id ────────────────────────────────────────── */
router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw notFound('Message not found.');

    const { is_read: isRead } = parse(messageUpdateSchema, req.body);

    const existing = await db('messages').where({ id }).first('id');
    if (!existing) throw notFound('Message not found.');

    const [row] = await db('messages')
      .where({ id })
      .update({
        is_read: isRead,
        read_at: isRead ? db.fn.now() : null,
      })
      .returning('*');

    res.json({ message: serializeMessage(row) });
  })
);

/* ── DELETE /api/admin/messages/:id ───────────────────────────────────────── */
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw notFound('Message not found.');

    const deleted = await db('messages').where({ id }).del();
    if (!deleted) throw notFound('Message not found.');

    res.json({ message: 'Message deleted.', id });
  })
);

module.exports = router;
