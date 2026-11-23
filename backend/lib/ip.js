'use strict';

const crypto = require('crypto');
const config = require('../config');

/** Non-reversible fingerprint used for spam/rate-limit bookkeeping. */
function hashIp(ip) {
  return crypto
    .createHmac('sha256', config.ipHashSecret)
    .update(String(ip || 'unknown'))
    .digest('hex');
}

module.exports = { hashIp };
