'use strict';

/**
 * Image handling.
 *
 * Files are validated by their magic bytes (never by the client-supplied
 * filename or MIME type) and stored in the database so uploads survive
 * restarts and redeploys. SVG is intentionally rejected because it can
 * execute script when opened in a browser.
 */

const multer = require('multer');
const config = require('../config');
const { HttpError } = require('./errors');

const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

function detectImageType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;

  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  const header = buffer.subarray(0, 6).toString('ascii');
  if (header === 'GIF87a' || header === 'GIF89a') return 'image/gif';

  return null;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes, files: 1, fields: 10 },
  fileFilter(req, file, cb) {
    // First line of defence; magic bytes are checked again after parsing.
    if (!file.mimetype || !file.mimetype.startsWith('image/')) {
      return cb(new HttpError(400, 'Please upload a PNG, JPEG, WebP or GIF image.'));
    }
    return cb(null, true);
  },
});

function validateUploadedImage(file) {
  if (!file || !file.buffer || !file.buffer.length) {
    throw new HttpError(400, 'Choose an image to upload.');
  }
  if (file.size > config.maxUploadBytes) {
    throw new HttpError(413, `Image is too large. The limit is ${Math.round(config.maxUploadBytes / (1024 * 1024))} MB.`);
  }

  const mime = detectImageType(file.buffer);
  if (!mime || !ALLOWED.has(mime)) {
    throw new HttpError(400, 'That file is not a supported image. Upload a PNG, JPEG, WebP or GIF.');
  }

  return mime;
}

module.exports = { upload, validateUploadedImage, detectImageType };
