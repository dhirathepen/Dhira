'use strict';

const rateLimit = require('express-rate-limit');

const json = (message) => (req, res) => res.status(429).json({ error: message });

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 600,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: json('Too many requests. Please slow down for a moment.'),
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 12,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: json('Too many sign-in attempts. Please wait 15 minutes and try again.'),
});

const contactLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 8,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: json('Too many messages from this connection. Please try again in an hour.'),
});

const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 80,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: json('Too many uploads. Please try again shortly.'),
});

module.exports = { apiLimiter, authLimiter, contactLimiter, uploadLimiter };
