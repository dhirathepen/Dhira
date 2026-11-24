'use strict';

const { toDateOnly } = require('./dates');

/** JSON shapes returned by the API. No secrets ever pass through here. */

function imageRef(id) {
  if (!id) return null;
  return { id: Number(id), url: `/api/images/${id}` };
}

function parseSocialLinks(value) {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }
  return value;
}

function serializePost(row, tags = [], { includeContent = false } = {}) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    subtitle: row.subtitle || '',
    excerpt: row.excerpt || '',
    footer_note: row.footer_note || '',
    ...(includeContent ? { content: row.content } : {}),
    type: row.type,
    status: row.status,
    featured: Boolean(row.featured),
    published_on: toDateOnly(row.published_on),
    category: row.category_id
      ? { id: row.category_id, name: row.category_name, slug: row.category_slug }
      : null,
    tags,
    cover: imageRef(row.cover_image_id),
    reading_minutes: row.reading_minutes || 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function serializeCategory(row) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description || '',
    sort_order: row.sort_order || 0,
    post_count: row.post_count !== undefined ? Number(row.post_count) : undefined,
  };
}

function serializeBook(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    subtitle: row.subtitle || '',
    introduction: row.introduction || '',
    synopsis: row.synopsis || '',
    progress_percent: row.progress_percent,
    progress_note: row.progress_note || '',
    status: row.status,
    release_date: toDateOnly(row.release_date),
    cover: imageRef(row.cover_image_id),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function serializeAuthor(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    pen_name: row.pen_name || '',
    tagline: row.tagline || '',
    introduction: row.introduction || '',
    biography: row.biography || '',
    writing_interests: row.writing_interests || '',
    personal_description: row.personal_description || '',
    profile_image: imageRef(row.profile_image_id),
    public_email: row.public_email || null,
    location: row.location || '',
    social_links: parseSocialLinks(row.social_links),
    updated_at: row.updated_at,
  };
}

function serializeMessage(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    subject: row.subject,
    message: row.message,
    category: row.category,
    is_read: Boolean(row.is_read),
    read_at: row.read_at || null,
    created_at: row.created_at,
  };
}

module.exports = {
  imageRef,
  serializePost,
  serializeCategory,
  serializeBook,
  serializeAuthor,
  serializeMessage,
};
