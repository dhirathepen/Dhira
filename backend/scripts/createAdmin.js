'use strict';

/**
 * Create or reset the admin account.
 *
 *   npm run admin:create
 *   npm run admin:create -- --username dhira --reset-password
 *
 * The password is read from a hidden prompt (or from the ADMIN_PASSWORD
 * environment variable for automated setups). It is never written to disk or
 * logged. Passwords must be at least 10 characters.
 */

const readline = require('readline');
const db = require('../db');
const { hashPassword } = require('../lib/password');
const { ensureDefaults } = require('../lib/bootstrap');

function getArg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function askHidden(question) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      reject(new Error('No terminal is available for a hidden password prompt. Set ADMIN_PASSWORD instead.'));
      return;
    }

    process.stdout.write(question);
    const stdin = process.stdin;
    stdin.resume();
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');

    let value = '';
    let done = false;

    const cleanup = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
      process.stdout.write('\n');
    };

    const onData = (chunk) => {
      for (const char of String(chunk)) {
        if (done) return;

        if (char === '\u0003') {
          cleanup();
          process.stdout.write('Cancelled.\n');
          process.exit(130);
        } else if (char === '\r' || char === '\n') {
          done = true;
          cleanup();
          resolve(value);
          return;
        } else if (char === '\u007f' || char === '\b') {
          if (value.length) {
            value = value.slice(0, -1);
            process.stdout.write('\b \b');
          }
        } else if (char >= ' ') {
          value += char;
          process.stdout.write('*');
        }
      }
    };

    stdin.on('data', onData);
  });
}

(async () => {
  const reset = process.argv.includes('--reset-password');

  let username = (getArg('username') || process.env.ADMIN_USERNAME || '').trim().toLowerCase();

  if (!username) {
    username = (await ask('Admin username: ')).toLowerCase();
  }

  if (!/^[a-z0-9._-]{3,50}$/.test(username)) {
    throw new Error('Username must be 3-50 characters using letters, numbers, dot, dash or underscore.');
  }

  let password = process.env.ADMIN_PASSWORD || '';

  if (!password) {
    password = await askHidden(`Password for "${username}" (at least 10 characters): `);
    const confirm = await askHidden('Confirm password: ');
    if (password !== confirm) throw new Error('Passwords do not match.');
  }

  if (password.length < 10) {
    throw new Error('Password must be at least 10 characters.');
  }
  if (password.length > 200) {
    throw new Error('Password is too long.');
  }

  await db.migrate.latest();
  await ensureDefaults();

  const existing = await db('admins').where({ username }).first();
  const passwordHash = await hashPassword(password);

  if (existing) {
    if (!reset) {
      console.log(`\nAn admin named "${username}" already exists.`);
      console.log('Re-run with --reset-password to replace its password.');
    } else {
      await db('admins')
        .where({ id: existing.id })
        .update({
          password_hash: passwordHash,
          failed_attempts: 0,
          locked_until: null,
          updated_at: db.fn.now(),
        });
      await db('sessions').where({ admin_id: existing.id }).del();
      console.log(`\n✓ Password reset for "${username}". All sessions were signed out.`);
    }
  } else {
    await db('admins').insert({ username, password_hash: passwordHash });
    console.log(`\n✓ Admin "${username}" created. Sign in at /admin`);
  }

  console.log('  Remove ADMIN_PASSWORD / ADMIN_INITIAL_PASSWORD from your environment when you are done.\n');
  await db.destroy();
})().catch(async (err) => {
  console.error(`\n✗ ${err.message}\n`);
  await db.destroy().catch(() => {});
  process.exit(1);
});
