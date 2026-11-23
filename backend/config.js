'use strict';

/**
 * Central configuration.
 * Every secret comes from the environment — nothing sensitive lives in this file.
 */

const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const env = process.env.NODE_ENV === 'production' ? 'production' : 'development';

const toInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toBool = (value, fallback = false) => {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
};

// SQLite stores the whole site in one local file. A relative path is resolved
// from the backend directory, so the app works out of the box with no server.
const databaseFile = path.isAbsolute(process.env.DATABASE_FILE || '')
  ? process.env.DATABASE_FILE
  : path.resolve(__dirname, process.env.DATABASE_FILE || 'data/dhira.sqlite');
const siteUrl = (process.env.SITE_URL || '').replace(/\/+$/, '');
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim().replace(/\/+$/, ''))
  .filter(Boolean);

// The IP salt is only used to store non-reversible fingerprints for rate
// limiting. A configured value keeps fingerprints stable across restarts.
const ipHashSecret =
  process.env.IP_HASH_SECRET ||
  crypto.createHash('sha256').update(`dhira-ip:${databaseFile}`).digest('hex');

const config = {
  env,
  isProduction: env === 'production',
  port: toInt(process.env.PORT, 4000),
  databaseFile,
  siteUrl,
  allowedOrigins,
  trustProxy: process.env.TRUST_PROXY === undefined ? '1' : process.env.TRUST_PROXY,
  runMigrations: toBool(process.env.RUN_MIGRATIONS, true),
  frontendDir: path.resolve(__dirname, '..', 'frontend'),
  session: {
    cookieName: process.env.SESSION_COOKIE_NAME || 'dhira_sid',
    ttlDays: toInt(process.env.SESSION_TTL_DAYS, 7),
    // Cookies are marked Secure in production. Set COOKIE_SECURE=false only
    // when running production over plain HTTP on a private network.
    secure: toBool(process.env.COOKIE_SECURE, env === 'production'),
  },
  csrfCookieName: 'dhira_csrf',
  maxUploadBytes: toInt(process.env.MAX_UPLOAD_MB, 8) * 1024 * 1024,
  ipHashSecret,
  bootstrapAdmin: {
    username: (process.env.ADMIN_INITIAL_USERNAME || '').trim(),
    password: process.env.ADMIN_INITIAL_PASSWORD || '',
  },
};

module.exports = config;
