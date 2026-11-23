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
  tagline: 'A jack of all trades, exploring everything.',
  introduction:
    "I'm Mohith, writing under the pen name Dhira. I enjoy exploring new ideas, learning new skills, and taking on challenges — just for fun.",
  biography:
    'I am firmly committed to the philosophy of being a jack of all trades, master of none — but often better than a master of one. My curiosity often leads me to different fields and interests, giving me the opportunity to learn from a wide range of experiences. Writing is always one of them.',
  writing_interests: 'Essays · Poetry · Observation',
  personal_description: '',
  location: '',
  public_email: 'dhirathepen@gmail.com',
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
  if (!author) await db('author_profile').insert(DEFAULT_AUTHOR);
}

module.exports = { ensureDefaults, DEFAULT_CATEGORIES };