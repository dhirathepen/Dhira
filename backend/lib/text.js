'use strict';

/** Remove characters that have no business being in user text. */
function stripControlCharacters(value) {
  return String(value)
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
}

/** Collapse whitespace for single-line fields. */
function oneLine(value) {
  return stripControlCharacters(value).replace(/\s+/g, ' ').trim();
}

/** Normalise multi-line content while preserving deliberate line breaks. */
function multiLine(value) {
  return stripControlCharacters(value).replace(/[ \t]+$/gm, '').trim();
}

function escapeLike(value) {
  return String(value).replace(/[\\%_]/g, '\\$&');
}

function parsePagination(query, { defaultPerPage = 9, maxPerPage = 50 } = {}) {
  const rawPage = Number.parseInt(query.page, 10);
  const rawPerPage = Number.parseInt(query.per_page, 10);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  const perPage = Number.isFinite(rawPerPage) && rawPerPage > 0
    ? Math.min(rawPerPage, maxPerPage)
    : defaultPerPage;
  return { page, perPage, offset: (page - 1) * perPage };
}

function paginationMeta({ page, perPage, total }) {
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  return {
    page,
    per_page: perPage,
    total,
    total_pages: totalPages,
    has_prev: page > 1,
    has_next: page < totalPages,
  };
}

module.exports = {
  stripControlCharacters,
  oneLine,
  multiLine,
  escapeLike,
  parsePagination,
  paginationMeta,
};
