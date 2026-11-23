'use strict';

const express = require('express');
const db = require('../../db');
const { asyncHandler } = require('../../lib/errors');
const requireAdmin = require('../../middleware/requireAdmin');

const postsRouter = require('./posts');
const categoriesRouter = require('./categories');
const contentRouter = require('./content');
const messagesRouter = require('./messages');
const uploadsRouter = require('./uploads');

const router = express.Router();

// Every route below this line requires an authenticated admin session.
router.use(requireAdmin);

/* ── GET /api/admin/stats ─────────────────────────────────────────────────── */
router.get(
  '/stats',
  asyncHandler(async (req, res) => {
    const counts = await db.raw(`
      select
        (select count(*) from posts where status = 'published') as published_posts,
        (select count(*) from posts where status = 'draft') as draft_posts,
        (select count(*) from posts where type = 'poem' and status = 'published') as published_poems,
        (select count(*) from posts where type = 'article' and status = 'published') as published_articles,
        (select count(*) from books) as books_total,
        (select count(*) from messages) as messages_total,
        (select count(*) from messages where is_read = 0) as messages_unread
    `);

    const [recentPosts, recentMessages] = await Promise.all([
      db('posts as p')
        .join('categories as c', 'c.id', 'p.category_id')
        .select(
          'p.id',
          'p.title',
          'p.slug',
          'p.status',
          'p.type',
          'p.updated_at',
          'c.name as category_name'
        )
        .orderBy([{ column: 'p.updated_at', order: 'desc' }, { column: 'p.id', order: 'desc' }])
        .limit(5),
      db('messages')
        .select('id', 'name', 'email', 'subject', 'is_read', 'created_at')
        .orderBy([{ column: 'created_at', order: 'desc' }, { column: 'id', order: 'desc' }])
        .limit(5),
    ]);

    res.json({
      stats: counts[0] || {},
      recent_posts: recentPosts,
      recent_messages: recentMessages,
    });
  })
);

router.use('/posts', postsRouter);
router.use('/categories', categoriesRouter);
router.use('/messages', messagesRouter);
router.use('/uploads', uploadsRouter);
router.use('/', contentRouter);

module.exports = router;
