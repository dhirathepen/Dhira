'use strict';

const db = require('../db');

/**
 * Delete an image only when nothing references it any more.
 * Called after content is replaced or removed so uploads do not leak.
 */
async function pruneImage(imageId) {
  if (!imageId) return;

  const [post, book, author] = await Promise.all([
    db('posts').where({ cover_image_id: imageId }).first('id'),
    db('books').where({ cover_image_id: imageId }).first('id'),
    db('author_profile').where({ profile_image_id: imageId }).first('id'),
  ]);

  if (!post && !book && !author) {
    await db('images').where({ id: imageId }).del();
  }
}

module.exports = { pruneImage };
