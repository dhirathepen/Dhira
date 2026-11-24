'use strict';

const BASE = 'http://127.0.0.1:4000';
const USERNAME = process.env.TEST_USER || 'dhira';
const PASSWORD = process.env.TEST_PASS || 'DhiraTest2026!';

const jar = new Map();
let csrf = '';

function storeCookies(res) {
  const list = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const raw of list) {
    const pair = raw.split(';')[0];
    const idx = pair.indexOf('=');
    if (idx > 0) jar.set(pair.slice(0, idx), pair.slice(idx + 1));
  }
}

function cookieHeader() {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

async function request(method, path, body, { csrfHeader = true, auth = true } = {}) {
  const headers = {};
  if (auth) headers.Cookie = cookieHeader();
  if (csrfHeader && csrf) headers['X-CSRF-Token'] = csrf;
  if (body !== undefined && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';

  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    redirect: 'manual',
  });
  storeCookies(res);
  const rotated = res.headers.get('x-csrf-token');
  if (rotated) csrf = rotated;
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text.slice(0, 200); }
  return { status: res.status, data, headers: res.headers };
}

const results = [];
function check(name, condition, detail = '') {
  results.push({ name, ok: Boolean(condition), detail });
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

(async () => {
  // 1. CSRF handshake
  let r = await request('GET', '/api/csrf');
  csrf = r.data.csrfToken;
  check('GET /api/csrf issues token', r.status === 200 && typeof csrf === 'string' && csrf.length > 30);

  // 2. Unauthorized admin
  r = await request('GET', '/api/admin/stats');
  check('Admin stats blocked without session', r.status === 401, `status ${r.status}`);

  // 3. CSRF enforcement
  r = await request('POST', '/api/auth/login', { username: USERNAME, password: PASSWORD }, { csrfHeader: false });
  check('Login blocked without CSRF header', r.status === 403, `status ${r.status}`);

  // 4. Wrong password
  r = await request('POST', '/api/auth/login', { username: USERNAME, password: 'wrong-password' });
  check('Wrong password rejected', r.status === 401, `status ${r.status}`);

  // 5. Correct login
  r = await request('POST', '/api/auth/login', { username: USERNAME, password: PASSWORD });
  check('Admin login succeeds', r.status === 200 && r.data.admin.username === USERNAME, `status ${r.status}`);

  // 6. Session works
  r = await request('GET', '/api/auth/me');
  check('GET /api/auth/me works', r.status === 200 && r.data.admin.username === USERNAME);

  // 7. Categories
  r = await request('GET', '/api/categories');
  const categories = r.data.items || [];
  check('Default categories exist', r.status === 200 && categories.length >= 2, `${categories.length} categories`);
  const witsCat = categories.find((c) => c.slug === 'wits');
  const bookNotesCat = categories.find((c) => c.slug === 'book-notes');
  check('Unified Wits and Book Notes categories exist', Boolean(witsCat && bookNotesCat));
  void bookNotesCat;

  // 8. Create a published poem (multi-line)
  const poemContent = 'The lamp is low,\nand the house is quiet.\n\nI keep one word\nlike a coal in my hand.\n\n    — for the morning';
  const title = `Test Poem ${Date.now()}`;
  r = await request('POST', '/api/admin/posts', {
    title,
    subtitle: 'A test in stillness',
    content: poemContent,
    footer_note: 'Tags: stillness · morning',
    excerpt: '',
    type: 'poem',
    status: 'published',
    featured: true,
    published_on: '2026-11-20',
    tags: ['test', 'stillness'],
  });
  check('Create published poem', r.status === 201 && r.data.post.status === 'published', `status ${r.status}`);
  const poem = r.data.post;

  check('Poem content keeps line breaks', poem && poem.content === poemContent);
  check('Post footer note saved', poem && poem.footer_note === 'Tags: stillness · morning');
  check('Category defaults to Wits', poem && poem.category && poem.category.slug === 'wits');
  check('Tags saved', poem && poem.tags.length === 2, JSON.stringify(poem && poem.tags));
  check('Reading minutes computed', poem && poem.reading_minutes >= 1);

  // 9. Public list hides drafts and content
  r = await request('GET', `/api/posts?category=wits&per_page=50`);
  const listed = (r.data.items || []).find((item) => item.id === poem.id);
  check('Poem appears in public list', r.status === 200 && listed, `status ${r.status}`);
  check('List omits full content', listed && listed.content === undefined);
  check('Featured flag public', listed && listed.featured === true);

  // 10. Detail endpoint
  r = await request('GET', `/api/posts/${poem.slug}`);
  check('Fetch poem by slug', r.status === 200 && r.data.post.id === poem.id);
  check('Detail preserves content exactly', r.data.post && r.data.post.content === poemContent);
  check('Detail exposes footer note', r.data.post && r.data.post.footer_note === 'Tags: stillness · morning');

  // 11. Search
  r = await request('GET', `/api/posts?q=coal&per_page=50`);
  check('Search finds poem by content word', (r.data.items || []).some((p) => p.id === poem.id));

  r = await request('GET', `/api/posts?q=${encodeURIComponent('zzz-nothing-matches-zzz')}`);
  check('Empty search returns empty state', r.status === 200 && r.data.items.length === 0);

  // 12. Duplicate title -> unique slug
  r = await request('POST', '/api/admin/posts', {
    title, content: 'Second copy content.', type: 'article',
    status: 'draft', featured: false, tags: [],
  });
  check('Duplicate title gets unique slug', r.status === 201 && r.data.post.slug !== poem.slug, r.data.post && r.data.post.slug);
  const draft = r.data.post;

  // 13. Draft hidden publicly, visible to admin
  r = await request('GET', `/api/posts/${draft.slug}`);
  check('Draft is not public', r.status === 404, `status ${r.status}`);

  r = await request('GET', '/api/admin/posts?status=draft&per_page=100');
  check('Draft visible in admin list', r.status === 200 && r.data.items.some((p) => p.id === draft.id));

  // 14. Publish toggle
  r = await request('PATCH', `/api/admin/posts/${draft.id}/status`, { status: 'published' });
  check('Publish toggle works', r.status === 200 && r.data.post.status === 'published');

  r = await request('GET', `/api/posts/${draft.slug}`);
  check('Published post is public', r.status === 200);

  // 15. Edit post
  r = await request('PUT', `/api/admin/posts/${draft.id}`, {
    title: `${title} edited`, subtitle: '', content: 'Edited body.\n\nNew stanza.',
    footer_note: 'See also: the first poem.', excerpt: 'Custom excerpt',
    type: 'article', status: 'published', featured: false,
    published_on: '2026-11-21', tags: ['edited'],
  });
  check('Edit post works', r.status === 200 && r.data.post.title.endsWith('edited') && r.data.post.excerpt === 'Custom excerpt');
  check('Footer note editable', r.data.post.footer_note === 'See also: the first poem.');
  check('Category preserved when omitted', r.data.post.category.slug === 'wits');

  // 16. Upload an image
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const form = new FormData();
  form.append('image', new Blob([png], { type: 'image/png' }), 'test-pixel.png');
  r = await request('POST', '/api/admin/uploads', form);
  check('Image upload accepted', r.status === 201 && r.data.image.url, `status ${r.status}`);
  const image = r.data.image;

  r = await request('GET', image.url, undefined);
  check('Uploaded image served', r.status === 200 && String(r.headers.get('content-type')).includes('image/png'));

  // Reject a fake image (text renamed .png)
  const fake = new FormData();
  fake.append('image', new Blob([Buffer.from('not an image at all')], { type: 'image/png' }), 'fake.png');
  r = await request('POST', '/api/admin/uploads', fake);
  check('Fake image rejected by magic bytes', r.status === 400, `status ${r.status}`);

  // 17. Attach cover
  r = await request('PUT', `/api/admin/posts/${poem.id}`, {
    title: poem.title, subtitle: poem.subtitle, content: poemContent,
    footer_note: 'Tags: stillness · morning', excerpt: '',
    type: 'poem', status: 'published', featured: true,
    published_on: '2026-11-20', tags: ['test', 'stillness'], cover_image_id: image.id, slug: poem.slug,
  });
  check('Cover image attached', r.status === 200 && r.data.post.cover && r.data.post.cover.id === image.id);

  // 18. Multiple books
  r = await request('GET', '/api/admin/books');
  check('Admin books list readable', r.status === 200 && Array.isArray(r.data.items) && r.data.items.length >= 1);

  r = await request('POST', '/api/admin/books', {
    title: 'Test Book', subtitle: 'A story in progress', introduction: 'An introduction.',
    synopsis: 'A synopsis.\n\nWith paragraphs.', progress_percent: 42, progress_note: 'Chapter 4',
    status: 'drafting', release_date: '2027-03-01', cover_image_id: image.id,
  });
  check('Book created', r.status === 201 && r.data.book.title === 'Test Book', `status ${r.status}`);
  const book = r.data.book;

  r = await request('GET', '/api/books');
  check('Public books list includes new book', r.status === 200 && r.data.items.some((item) => item.id === book.id));

  r = await request('GET', `/api/books/${book.id}`);
  check('Public book detail works', r.status === 200 && r.data.book.id === book.id);

  r = await request('PUT', `/api/admin/books/${book.id}`, {
    title: book.title, subtitle: book.subtitle, introduction: book.introduction,
    synopsis: book.synopsis, progress_percent: 63, progress_note: 'Chapter 5',
    status: 'editing', release_date: book.release_date, cover_image_id: image.id,
  });
  check('Book updates', r.status === 200 && r.data.book.progress_percent === 63 && r.data.book.status === 'editing');

  // 19. Author profile (restore the real profile after these writes)
  r = await request('GET', '/api/admin/author');
  const savedAuthor = r.data.author;
  r = await request('PUT', '/api/admin/author', {
    name: 'Mohith', pen_name: 'Dhira', tagline: 'Writer, observer.',
    introduction: 'Introduction line one.\n\nLine two.', biography: 'A longer biography.',
    writing_interests: 'Poetry · Essays', personal_description: 'Personal notes.',
    public_email: 'hello@example.com', location: 'India',
    social_links: { website: 'https://example.com', instagram: '', x: 'https://x.com/dhira' },
  });
  check('Author profile updates', r.status === 200 && r.data.author.name === 'Mohith' && r.data.author.public_email === 'hello@example.com');
  check('Empty social links removed', r.data.author.social_links.instagram === undefined);
  r = await request('GET', '/api/author');
  check('Author public endpoint works', r.status === 200 && r.data.author.pen_name === 'Dhira');

  // Invalid link rejected
  r = await request('PUT', '/api/admin/author', {
    name: 'Mohith', social_links: { website: 'javascript:alert(1)' },
  });
  check('javascript: social link rejected', r.status === 400, `status ${r.status}`);

  await request('PUT', '/api/admin/author', {
    name: savedAuthor.name,
    pen_name: savedAuthor.pen_name,
    tagline: savedAuthor.tagline,
    introduction: savedAuthor.introduction,
    biography: savedAuthor.biography,
    writing_interests: savedAuthor.writing_interests,
    personal_description: savedAuthor.personal_description,
    profile_image_id: savedAuthor.profile_image ? savedAuthor.profile_image.id : null,
    public_email: savedAuthor.public_email,
    location: savedAuthor.location,
    social_links: savedAuthor.social_links || {},
  });

  // 20. Contact message
  r = await request('POST', '/api/contact', {
    name: 'Test Reader', email: 'reader@example.com', subject: `Hello ${Date.now()}`,
    message: 'I loved the poem about the lamp. Thank you for writing it.', category: 'reader', website: '',
  });
  check('Contact message accepted', r.status === 201, `status ${r.status}`);

  // Honeypot
  r = await request('POST', '/api/contact', {
    name: 'Spam Bot', email: 'bot@example.com', subject: 'Spam', message: 'Buy things now at my website.',
    category: 'general', website: 'https://spam.example',
  });
  check('Honeypot blocked', r.status === 400, `status ${r.status}`);

  // Invalid email
  r = await request('POST', '/api/contact', {
    name: 'Reader', email: 'not-an-email', subject: 'Hi', message: 'This should fail validation nicely.',
    category: 'general', website: '',
  });
  check('Invalid email rejected', r.status === 400 && r.data.fields && r.data.fields.email, JSON.stringify(r.data.fields));

  // 21. Admin messages
  r = await request('GET', '/api/admin/messages?status=unread&per_page=50');
  const message = (r.data.items || []).find((m) => m.email === 'reader@example.com');
  check('Message appears in admin inbox', r.status === 200 && message && message.is_read === false);
  check('Inbox unread count', r.data.counts.unread >= 1);

  r = await request('GET', `/api/admin/messages/${message.id}`);
  check('Opening message marks it read', r.status === 200 && r.data.message.is_read === true && r.data.message.read_at);

  r = await request('PATCH', `/api/admin/messages/${message.id}`, { is_read: false });
  check('Message can be marked unread', r.status === 200 && r.data.message.is_read === false);

  // XSS payload stored as text
  r = await request('POST', '/api/admin/posts', {
    title: `XSS test ${Date.now()}`, content: '<script>window.__xss = true;</script>\n\n<img src=x onerror=alert(1)>',
    type: 'article', status: 'published', tags: ['<b>bold</b>'],
  });
  check('Post with markup accepted as text', r.status === 201);
  const xss = r.data.post;
  r = await request('GET', `/api/posts/${xss.slug}`);
  check('Markup preserved verbatim (client escapes it)', r.data.post.content.includes('<script>'));

  // 22. Deleting
  r = await request('DELETE', `/api/admin/posts/${xss.id}`);
  check('Delete post works', r.status === 200);
  r = await request('GET', `/api/posts/${xss.slug}`);
  check('Deleted post is gone', r.status === 404);

  r = await request('DELETE', `/api/admin/books/${book.id}`);
  check('Delete book works', r.status === 200);

  r = await request('DELETE', `/api/admin/messages/${message.id}`);
  check('Delete message works', r.status === 200);

  // cleanup remaining test posts
  await request('DELETE', `/api/admin/posts/${poem.id}`);
  await request('DELETE', `/api/admin/posts/${draft.id}`);

  // 23. Logout
  r = await request('POST', '/api/auth/logout');
  check('Logout works', r.status === 200);
  r = await request('GET', '/api/auth/me');
  check('Session invalid after logout', r.status === 401);

  // 24. Static hosting
  r = await request('GET', '/', undefined);
  check('Homepage served', r.status === 200 && String(r.data).includes('Dhira'));
  r = await request('GET', '/admin', undefined);
  check('Admin page served', r.status === 200 && /admin/i.test(String(r.data)));

  const failed = results.filter((item) => !item.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log('FAILED:', failed.map((f) => f.name).join(' | '));
    process.exit(1);
  }
})().catch((err) => {
  console.error('Test runner crashed:', err);
  process.exit(2);
});
