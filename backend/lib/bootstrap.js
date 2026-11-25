'use strict';

const db = require('../db');

/** Default taxonomy created on first boot. Nothing here is fake content. */
const DEFAULT_CATEGORIES = [
  {
    slug: 'wits',
    name: 'Wits',
    description: 'Short, clever pieces that play with ideas and language.',
    sort_order: 1,
  },
  {
    slug: 'book-notes',
    name: 'Book Notes',
    description: 'Notes from inside a work in progress.',
    sort_order: 2,
  },
];

const DEFAULT_AUTHOR = {
  id: 1,
  name: 'Mohith',
  pen_name: 'Dhira',
  tagline: 'A jack of all trades, master of none.',
  introduction: [
    'This is Mohith.',
    'A man with a billion dots scattered across the infinite sky of English stars, forever searching for constellations in words, meaning in silence, and stories in the ordinary.',
    '',
    'Not merely to master books, but to become a great storyteller; not simply to write words, but to leave something behind in them.',
    '',
    'Writing as Dhira.',
  ].join('\n'),
  biography: '',
  writing_interests: '',
  personal_description: '',
  location: '',
  public_email: null,
  social_links: '{}',
};

const DEFAULT_BOOKS = [
  {
  title: 'The Book',
  subtitle: 'A work in progress',
  introduction:
    'Notes from inside a work in progress — the writing, the doubt, the discoveries, and everything that happens in between.',
  synopsis: '',
  progress_percent: 42,
  progress_note: 'First draft',
  status: 'drafting',
  release_date: null,
  },
];

/** Create the rows that make the site usable on a brand-new database. */
async function ensureDefaults() {
  for (const category of DEFAULT_CATEGORIES) {
    await db('categories').insert(category).onConflict('slug').ignore();
  }

  const bookCount = await db('books').count({ count: 'id' }).first();
  if (!Number(bookCount.count)) {
    for (const book of DEFAULT_BOOKS) await db('books').insert(book);
  }

  const author = await db('author_profile').where({ id: 1 }).first('id');
  if (!author) await db('author_profile').insert(DEFAULT_AUTHOR).onConflict('id').ignore();
}

module.exports = { ensureDefaults, DEFAULT_CATEGORIES };