'use strict';

const { z } = require('zod');
const { oneLine, multiLine } = require('./text');

/* ── helpers ──────────────────────────────────────────────────────────────── */

const single = (value) => oneLine(value);

const shortText = (min, max, label) =>
  z
    .string({ required_error: `${label} is required.` })
    .transform(single)
    .pipe(
      z
        .string()
        .min(min, `${label} is too short.`)
        .max(max, `${label} cannot exceed ${max} characters.`)
    );

const optionalShort = (max) =>
  z.preprocess(
    (value) => (value === undefined || value === null ? '' : value),
    z.string().transform(single).pipe(z.string().max(max, `This field cannot exceed ${max} characters.`))
  );

const longText = (min, max, label) =>
  z
    .string({ required_error: `${label} is required.` })
    .transform(multiLine)
    .pipe(
      z
        .string()
        .min(min, `${label} is too short.`)
        .max(max, `${label} cannot exceed ${max.toLocaleString()} characters.`)
    );

const optionalLong = (max) =>
  z.preprocess(
    (value) => (value === undefined || value === null ? '' : value),
    z.string().transform(multiLine).pipe(z.string().max(max, `This field cannot exceed ${max.toLocaleString()} characters.`))
  );

const flag = z.preprocess(
  (value) => value === true || value === 'true' || value === 1 || value === '1',
  z.boolean()
);

const optionalId = z.preprocess(
  (value) => (value === '' || value === null || value === undefined ? null : Number(value)),
  z.number({ invalid_type_error: 'Choose a valid item.' }).int().positive().nullable()
);

function isCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

const optionalDate = z.preprocess(
  (value) => (value === '' || value === null || value === undefined ? null : value),
  z
    .string()
    .refine(isCalendarDate, 'Use a real date in the format YYYY-MM-DD.')
    .nullable()
);

const slugField = z.preprocess(
  (value) => (value === undefined || value === null ? '' : value),
  z
    .string()
    .transform(single)
    .pipe(
      z
        .string()
        .max(90, 'Slug cannot exceed 90 characters.')
        .regex(/^([a-z0-9]+(?:-[a-z0-9]+)*)?$/, 'Use lowercase letters, numbers and hyphens only.')
    )
);

const tagList = z
  .preprocess(
    (value) => {
      if (value === undefined || value === null || value === '') return [];
      if (Array.isArray(value)) return value;
      return String(value).split(',');
    },
    z.array(z.union([z.string(), z.number()]))
  )
  .transform((values) => {
    const seen = new Set();
    const tags = [];
    for (const raw of values) {
      const name = oneLine(String(raw)).slice(0, 40);
      const key = name.toLowerCase();
      if (!name || seen.has(key)) continue;
      seen.add(key);
      tags.push(name);
    }
    return tags.slice(0, 12);
  });

const password = z
  .string({ required_error: 'Password is required.' })
  .min(10, 'Use at least 10 characters.')
  .max(200, 'Password is too long.');

const httpUrl = z
  .string()
  .transform(single)
  .pipe(z.string().max(500, 'Link is too long.'))
  .refine((value) => {
    if (!value) return true;
    try {
      const parsed = new URL(value);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }, 'Enter a full link starting with http:// or https://');

const publicEmail = z.preprocess(
  (value) => (value === undefined || value === null || String(value).trim() === '' ? null : String(value).trim()),
  z.string().email('Enter a valid email address.').max(200).nullable()
);

/* ── auth ─────────────────────────────────────────────────────────────────── */

const loginSchema = z.object({
  username: shortText(1, 100, 'Username'),
  password: z.string().min(1, 'Password is required.').max(200),
});

const passwordChangeSchema = z.object({
  current_password: z.string().min(1, 'Enter your current password.').max(200),
  new_password: password,
});

/* ── posts ────────────────────────────────────────────────────────────────── */

const POST_TYPES = ['poem', 'article'];
const POST_STATUSES = ['draft', 'published'];

const postSchema = z.object({
  title: shortText(1, 300, 'Title'),
  subtitle: optionalShort(300),
  content: longText(1, 200000, 'Content'),
  footer_note: optionalLong(20000),
  excerpt: optionalShort(500),
  category_id: optionalId.default(null),
  type: z.enum(POST_TYPES).default('article'),
  status: z.enum(POST_STATUSES).default('draft'),
  featured: flag.default(false),
  cover_image_id: optionalId.default(null),
  published_on: optionalDate.default(null),
  tags: tagList,
  slug: slugField,
});

const postStatusSchema = z.object({ status: z.enum(POST_STATUSES) });

/* ── categories & tags ────────────────────────────────────────────────────── */

const categorySchema = z.object({
  name: shortText(1, 80, 'Category name'),
  description: optionalShort(300),
  slug: slugField,
});

/* ── book ─────────────────────────────────────────────────────────────────── */

const BOOK_STATUSES = ['drafting', 'editing', 'with_editor', 'cover_design', 'preorder', 'published'];

const bookSchema = z.object({
  title: shortText(1, 200, 'Book title'),
  subtitle: optionalShort(300),
  introduction: optionalLong(4000),
  synopsis: optionalLong(12000),
  progress_percent: z.coerce
    .number({ invalid_type_error: 'Progress must be a number.' })
    .int()
    .min(0, 'Progress cannot be below 0.')
    .max(100, 'Progress cannot be above 100.')
    .default(0),
  progress_note: optionalShort(120),
  status: z.enum(BOOK_STATUSES).default('drafting'),
  release_date: optionalDate.default(null),
  cover_image_id: optionalId.default(null),
});

/* ── author ───────────────────────────────────────────────────────────────── */

const socialLinksSchema = z
  .object({
    website: httpUrl.optional().default(''),
    instagram: httpUrl.optional().default(''),
    x: httpUrl.optional().default(''),
    facebook: httpUrl.optional().default(''),
    goodreads: httpUrl.optional().default(''),
    linkedin: httpUrl.optional().default(''),
    youtube: httpUrl.optional().default(''),
    newsletter: httpUrl.optional().default(''),
  })
  .partial()
  .default({});

const authorSchema = z.object({
  name: shortText(1, 120, 'Name'),
  pen_name: optionalShort(120),
  tagline: optionalShort(240),
  introduction: optionalLong(4000),
  biography: optionalLong(12000),
  writing_interests: optionalShort(500),
  personal_description: optionalLong(8000),
  profile_image_id: optionalId.default(null),
  public_email: publicEmail.default(null),
  location: optionalShort(120),
  social_links: socialLinksSchema,
});

/* ── messages ─────────────────────────────────────────────────────────────── */

const CONTACT_CATEGORIES = ['general', 'reader', 'book', 'poetry', 'other'];

const contactSchema = z.object({
  name: shortText(2, 100, 'Name'),
  email: z
    .string({ required_error: 'Email is required.' })
    .transform((value) => String(value).trim().toLowerCase())
    .pipe(z.string().email('Enter a valid email address.').max(200)),
  subject: shortText(3, 200, 'Subject'),
  message: longText(10, 5000, 'Message'),
  category: z.enum(CONTACT_CATEGORIES).default('general'),
});

const messageUpdateSchema = z.object({ is_read: flag });

module.exports = {
  POST_TYPES,
  POST_STATUSES,
  BOOK_STATUSES,
  CONTACT_CATEGORIES,
  loginSchema,
  passwordChangeSchema,
  postSchema,
  postStatusSchema,
  categorySchema,
  bookSchema,
  authorSchema,
  contactSchema,
  messageUpdateSchema,
};
