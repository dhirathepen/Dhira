'use strict';

/**
 * Password hashing with scrypt (Node's built-in, memory-hard KDF).
 * Stored format: scrypt$N$r$p$salt$hash
 */

const crypto = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);

const PARAMS = { N: 16384, r: 8, p: 1, keylen: 64, maxmem: 64 * 1024 * 1024 };

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('base64url');
  const derived = await scrypt(password, salt, PARAMS.keylen, PARAMS);
  return [
    'scrypt',
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt,
    Buffer.from(derived).toString('base64url'),
  ].join('$');
}

async function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = parts[4];
  const expected = Buffer.from(parts[5], 'base64url');
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p) || !salt || !expected.length) {
    return false;
  }

  try {
    const derived = await scrypt(password, salt, expected.length, {
      N, r, p, maxmem: PARAMS.maxmem,
    });
    const actual = Buffer.from(derived);
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// Verify against a real hash when the username does not exist so that response
// timing does not reveal whether an account is present.
let dummyHashPromise;
function dummyHash() {
  if (!dummyHashPromise) {
    dummyHashPromise = hashPassword(crypto.randomBytes(24).toString('hex'));
  }
  return dummyHashPromise;
}

async function burnPasswordCheck(password) {
  const stored = await dummyHash();
  await verifyPassword(password, stored);
  return false;
}

module.exports = { hashPassword, verifyPassword, burnPasswordCheck };
