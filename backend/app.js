'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const multer = require('multer');

const config = require('./config');
const { HttpError } = require('./lib/errors');
const { ensureCsrfCookie, verifyCsrf } = require('./lib/csrf');
const { attachSession } = require('./lib/session');
const { apiLimiter } = require('./middleware/rateLimit');

const authRoutes = require('./routes/auth');
const publicRoutes = require('./routes/public');
const adminRoutes = require('./routes/admin');

const app = express();

/* ── proxy & security headers ─────────────────────────────────────────────── */
const trustProxy = config.trustProxy;
app.set('trust proxy', /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy === 'true');

app.disable('x-powered-by');

const connectSources = ["'self'", ...config.allowedOrigins];

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        // The original site uses small inline scripts and styles. All
        // author-supplied content is rendered as text, never as HTML.
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
        connectSrc: connectSources,
        objectSrc: ["'none'"],
        frameSrc: ["'self'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        // The home page previews itself inside the book-opening intro.
        frameAncestors: ["'self'"],
        ...(config.isProduction
          ? { upgradeInsecureRequests: [] }
          : { upgradeInsecureRequests: null }),
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    hsts: config.isProduction ? { maxAge: 15552000, includeSubDomains: true } : false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  })
);

/* ── CORS (only for a separately hosted frontend) ─────────────────────────── */
app.use((req, res, next) => {
  const origin = req.get('origin');

  if (origin && config.allowedOrigins.includes(origin.replace(/\/+$/, ''))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-CSRF-Token');
    res.setHeader('Access-Control-Expose-Headers', 'X-CSRF-Token');
    res.setHeader('Access-Control-Max-Age', '600');

    if (req.method === 'OPTIONS') return res.status(204).end();
  } else if (req.method === 'OPTIONS' && req.path.startsWith('/api')) {
    return res.status(204).end();
  }

  return next();
});

/* ── body parsing & cookies ───────────────────────────────────────────────── */
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(cookieParser());

/* ── API pipeline ─────────────────────────────────────────────────────────── */
app.use('/api', (req, res, next) => {
  if (!req.path.startsWith('/images/')) res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use('/api', ensureCsrfCookie);
app.use('/api', verifyCsrf);
app.use('/api', attachSession);
app.use('/api', apiLimiter);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.get('/api/csrf', (req, res) => {
  res.json({ csrfToken: req.csrfToken });
});

app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api', publicRoutes);

/* ── frontend ─────────────────────────────────────────────────────────────── */
app.get('/', (req, res) => res.sendFile(path.join(config.frontendDir, 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(config.frontendDir, 'admin.html')));

app.use(
  express.static(config.frontendDir, {
    extensions: ['html'],
    index: 'index.html',
    maxAge: config.isProduction ? '1h' : 0,
    setHeaders(res, filePath) {
      if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('X-Content-Type-Options', 'nosniff');
    },
  })
);

/* ── 404 ──────────────────────────────────────────────────────────────────── */
app.use((req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'API route not found.' });
  }

  const notFoundPage = path.join(config.frontendDir, '404.html');
  if (fs.existsSync(notFoundPage)) return res.status(404).sendFile(notFoundPage);
  return res.status(404).type('text').send('Not found.');
});

/* ── error handler ────────────────────────────────────────────────────────── */
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (res.headersSent) return;

  // Multer (file upload) errors
  if (err instanceof multer.MulterError) {
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    const message =
      err.code === 'LIMIT_FILE_SIZE'
        ? `Image is too large. The limit is ${Math.round(config.maxUploadBytes / (1024 * 1024))} MB.`
        : 'The upload could not be processed.';
    return res.status(status).json({ error: message });
  }

  if (err instanceof HttpError) {
    const payload = { error: err.message };
    if (err.fields) payload.fields = err.fields;
    return res.status(err.status).json(payload);
  }

  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'The request body is not valid JSON.' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'That request is too large.' });
  }

  // Constraint violations from SQLite (SQLITE_CONSTRAINT_*) or Postgres
  // (23505 unique, 23503 foreign key, 23502 not null).
  const constraintCode = typeof err.code === 'string' ? err.code : '';
  if (
    constraintCode.startsWith('SQLITE_CONSTRAINT') ||
    ['23505', '23503', '23502'].includes(constraintCode)
  ) {
    const foreignKey = constraintCode.includes('FOREIGNKEY') || constraintCode === '23503';
    const message = foreignKey
      ? 'That item is still in use somewhere else.'
      : 'That value is already in use.';
    return res.status(409).json({ error: message });
  }

  console.error('[error]', err);
  return res.status(500).json({ error: 'Something went wrong on the server.' });
});

module.exports = app;
