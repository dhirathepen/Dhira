# Dhira — Dhira

A personal writing website with a built-in CMS admin panel.

- **Frontend** — static HTML/CSS/JS, served by the Express app
- **Backend** — Node.js + Express 4 + Knex, served from one Express app
- **Database** — a local **SQLite** file (`backend/data/dhira.sqlite`); no external database server, no credentials, no network setup
- **Auth** — cookie-based sessions (HttpOnly `dhira_sid`, SHA-256 session tokens)
- **CSRF** — double-submit cookie `dhira_csrf` + `X-CSRF-Token` header
- **Images** — stored as BLOBs in the `images` table; served via `/api/images/:id` with ETag
- **Poems** — preserved line breaks/indentation/stanzas via `white-space: pre-wrap`
- **Posts** — title, main body, footer note, subtitle, cover, date, tags, featured, draft/published
- **Books** — multiple books with covers, synopsis, progress and status
- **Admin** — real auth, dashboard stats, CRUD for posts/categories/tags/books/author/messages, image uploads
- **Contact** — real POST with honeypot, validation, rate limiting, spam protection

## Stack

- **Node.js** 20+ (tested on 26), **Express** 4, **Knex** 3, **SQLite 3** via `sqlite3`
- CommonJS, one Express app serves frontend static files + API (same-origin cookies/CSRF)
- Frontend: `index.html` (home + book-opening intro), `writing.html`, `wits.html` (single unified writing page), `post.html`, `book.html`, `about.html`, `contact.html`, `404.html`, `admin.html`
- `/` serves the intro animation once per browser session, then forwards to `index.html`; refreshing the home page never replays it. `personal.html` and `thoughts.html` redirect to `wits.html`.
- Backend routes: `/api/*` (public + admin); auth, posts, categories, tags, books, author, contact, images
- Migrations run automatically on boot; env via `.env`; backup via `npm run db:backup`

## Local development

No database installation is required. The app creates the SQLite file and all tables on first boot.

```bash
cd backend
cp .env.example .env      # optional — defaults work out of the box
npm install
npm run admin:create -- --username dhira   # prompts for a password (min 10 chars)
npm run dev               # nodemon, http://localhost:4000
```

Open:

- Site: <http://127.0.0.1:4000/> (plays the intro once, then the home page)
- Home (skip intro): <http://127.0.0.1:4000/index.html>
- Admin: <http://127.0.0.1:4000/admin.html>

`npm run admin:create` can also read the password from the environment for non-interactive setups:

```bash
ADMIN_PASSWORD='a-strong-password' npm run admin:create -- --username dhira
```

Remove `ADMIN_PASSWORD` from the environment afterwards.

### Database file location

The database path is controlled by `DATABASE_FILE` in `backend/.env`:

| Value | Result |
|---|---|
| `data/dhira.sqlite` (default) | `backend/data/dhira.sqlite` — relative paths resolve from the backend folder |
| `C:/my-site/dhira.sqlite` | that absolute path on Windows |
| `/data/dhira.sqlite` | that absolute path on Linux (handy for a mounted volume) |

The parent directory is created automatically. Migrations, default categories, a starter book and the author profile are all created for you.

## Available scripts

Run these from `backend/`:

| Script | Description |
|---|---|
| `npm start` | Start the server, http://localhost:4000 |
| `npm run dev` | Start with nodemon (auto-reload) |
| `npm run migrate` | Run pending Knex migrations |
| `npm run migrate:rollback` | Roll back the last migration |
| `npm run migrate:status` | Show migration status |
| `npm run admin:create -- --username <name>` | Create or reset an admin account |
| `npm run db:backup` | Write a consistent SQLite snapshot into `backups/` |
| `node resetdb.js` | Reset site content to the seeded defaults (keeps admins/messages) |

## Backup / restore

```bash
# From backend/ — creates backups/dhira-<timestamp>.sqlite
npm run db:backup
```

`db:backup` uses SQLite's `VACUUM INTO`, so the copy is compact, consistent, and safe to take while the server is running (it includes anything still in the WAL).

To restore:

1. Stop the server.
2. Copy your chosen `backups/dhira-*.sqlite` over `backend/data/dhira.sqlite`.
3. If you also have `dhira.sqlite-wal` / `dhira.sqlite-shm` files next to the database, delete them so SQLite rebuilds them from the restored file.
4. Start the server again — migrations are idempotent.

You can also just copy the database file while the server is stopped; a plain file copy is a valid backup in that case.

## Deploying

Two setups are supported:

- **Vercel + Supabase Postgres** (recommended here) — set `DATABASE_URL` and the app uses Postgres instead of the local SQLite file.
- **SQLite on a host with a persistent disk** — see Render / VPS below. Without a disk, SQLite content is lost on redeploy.

### Vercel + Supabase

1. Create a Supabase project. In **Project Settings → Database → Connection string**, choose the **Transaction pooler** URI (port `6543`) and copy it. It looks like:
   `postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres`
2. Push this repo to GitHub and import it into Vercel. Framework preset: **Other**, root directory = repository root. `vercel.json` bundles `frontend/**` into the serverless function and routes every request through `api/index.js`. Runtime dependencies are declared in the **root** `package.json` so Vercel installs and bundles them with the function; `backend/package.json` remains for local development.
3. In Vercel → Settings → Environment Variables, add:

   ```text
   DATABASE_URL=<supabase transaction pooler URL>
   DATABASE_SSL=true
   NODE_ENV=production
   RUN_MIGRATIONS=true
   IP_HASH_SECRET=<a long random string>
   SITE_URL=https://<your-project>.vercel.app
   TRUST_PROXY=1
   COOKIE_SECURE=true
   ADMIN_INITIAL_USERNAME=<first admin username>
   ADMIN_INITIAL_PASSWORD=<first admin password, at least 10 chars>
   ```

   Remove `ADMIN_INITIAL_*` after the first successful deploy; they are only used when no admin exists yet. Alternative: with `DATABASE_URL` set locally, run `npm run admin:create -- --username <name> --reset-password` from `backend/`.
4. Deploy with `npx vercel login`, then `npx vercel` (link the project), then `npx vercel --prod`.

Migrations, default categories, book info and the author profile are created automatically on the first request. Uploaded images are stored as database BLOBs, so no persistent Vercel filesystem is needed.

Your existing SQLite content does **not** copy to Supabase automatically — re-add posts/books through `/admin`, or write a one-off export/import script.

### Render

`render.yaml` in the repo root is configured with a 1 GB disk mounted at `/data` and `DATABASE_FILE=/data/dhira.sqlite`. Disks require a paid plan (Starter or above) — the free plan's filesystem is ephemeral.

1. Push the repo to GitHub, then create a **Blueprint** on Render from `render.yaml`, or create the Web Service manually:
   - Root Directory: `backend`
   - Build Command: `npm install`
   - Start Command: `node server.js`
   - Add a disk mounted at `/data` and set `DATABASE_FILE=/data/dhira.sqlite`
2. Set `NODE_ENV=production`, `IP_HASH_SECRET` (a long random string) and, if the frontend is on another domain, `ALLOWED_ORIGINS`.
3. In the service's **Shell** tab, create the first admin:

   ```bash
   npm run admin:create -- --username dhira
   ```

   (Or set `ADMIN_PASSWORD` for that one shell command and remove it afterwards.)
4. Open `https://<your-app>.onrender.com/admin.html` and sign in.

Run `npm run db:backup` from the Render shell before any risky change, and download the resulting file from `backups/`.

### Any VPS / Docker host

Mount a persistent volume at a directory (for example `/data`), set `DATABASE_FILE=/data/dhira.sqlite`, run `npm install && npm start` from `backend/`, and back up that single file on a schedule.

## How it's connected

The single Express app serves all HTML pages from `frontend/` and handles API requests at `/api/*`. Same-origin cookies and double-submit CSRF keep admin/auth secure without a separate origin config.

## Security

- Password hashing: `crypto.scrypt`, min 10 chars; stored as `scrypt$N$r$p$salt$hash`
- Sessions: HttpOnly `dhira_sid` cookie, SameSite=Lax, 7-day TTL, SHA-256 token stored in DB
- CSRF: double-submit cookie `dhira_csrf` + `X-CSRF-Token` header + Origin check
- SQL injection: Knex parameterized queries + identifier escaping
- XSS: user data rendered via `textContent` only; never `innerHTML` for dynamic content
- Upload validation: magic-byte check, PNG/JPEG/WebP/GIF only, 8 MB limit
- Rate limiting: 5 contact messages/hour per IP; login lockout after 5 failures (15 min)
- Secure cookies: `secure` in production; `HttpOnly`; `SameSite=Lax`
- CORS: configured via `ALLOWED_ORIGINS` env var only

## Image storage

- Images uploaded via the admin are stored as BLOBs in the `images` table (SQLite locally, `bytea` in Supabase/Postgres)
- Persistent across restarts — no file volume needed, even on Vercel
- Validation: PNG/JPEG/WebP/GIF only (SVG rejected); 8 MB max; magic-byte check
- Served via `GET /api/images/:id` with ETag and `Cache-Control: immutable`
- If an upload fails validation, the server returns a 400 with details

## Notes

- Local SQLite stores timestamps as `YYYY-MM-DD HH:MM:SS` text; Supabase uses native `timestamp` columns. Shared query helpers live in `backend/lib/dates.js`.
- SQLite uses one connection with `PRAGMA foreign_keys = ON` and WAL journaling. Postgres uses a small SSL-enabled pool that is safe across serverless instances.
- `DATABASE_URL` chooses the database: unset → local SQLite file; set → Supabase/Postgres. Schema, admin accounts and sessions behave the same either way.
- Never commit your real `.env` file — only `.env.example` is tracked. `backend/data/` and `backups/` are already git-ignored so local data and backups stay out of version control.
- Public pages only ever receive posts with `status: published`; drafts are only visible from the admin panel.
- All client rendering uses `textContent` (never innerHTML for user data); paragraphs split on blank lines, `white-space: pre-wrap` preserves lines/indentation.
