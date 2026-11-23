'use strict';

const crypto = require('crypto');
const express = require('express');
const db = require('../../db');
const { asyncHandler, HttpError } = require('../../lib/errors');
const { upload, validateUploadedImage } = require('../../lib/images');
const { uploadLimiter } = require('../../middleware/rateLimit');
const { pruneImage } = require('../../lib/prune');

const router = express.Router();

const EXTENSIONS = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

/* ── POST /api/admin/uploads ──────────────────────────────────────────────── */
router.post(
  '/',
  uploadLimiter,
  upload.single('image'),
  asyncHandler(async (req, res) => {
    const mime = validateUploadedImage(req.file);

    const baseName = String(req.file.originalname || 'image')
      .replace(/\.[a-z0-9]+$/i, '')
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'image';

    const filename = `${baseName}.${EXTENSIONS[mime] || 'img'}`;
    const checksum = crypto.createHash('sha256').update(req.file.buffer).digest('hex');

    const [row] = await db('images')
      .insert({
        filename,
        mime_type: mime,
        byte_size: req.file.size,
        checksum,
        data: req.file.buffer,
      })
      .returning(['id', 'mime_type', 'byte_size', 'filename']);

    res.status(201).json({
      image: {
        id: row.id,
        url: `/api/images/${row.id}`,
        mime_type: row.mime_type,
        byte_size: row.byte_size,
        filename: row.filename,
      },
    });
  })
);

/* ── DELETE /api/admin/uploads/:id ────────────────────────────────────────── */
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw new HttpError(404, 'Image not found.');

    const used = await db('posts').where({ cover_image_id: id }).first('id');
    const usedBook = await db('books').where({ cover_image_id: id }).first('id');
    const usedAuthor = await db('author_profile').where({ profile_image_id: id }).first('id');

    if (used || usedBook || usedAuthor) {
      throw new HttpError(409, 'This image is still used by a piece of content.');
    }

    await pruneImage(id);
    res.json({ message: 'Image deleted.', id });
  })
);

module.exports = router;
