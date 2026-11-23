'use strict';

const { HttpError } = require('./errors');

/** Validate a request body and throw a field-aware 400 on failure. */
function parse(schema, data) {
  const result = schema.safeParse(data === undefined || data === null ? {} : data);

  if (!result.success) {
    const fields = {};
    for (const issue of result.error.issues) {
      const key = issue.path.length ? issue.path.join('.') : '_';
      if (!fields[key]) fields[key] = issue.message;
    }
    const first = Object.values(fields)[0] || 'Please check the form and try again.';
    throw new HttpError(400, first, fields);
  }

  return result.data;
}

const nullable = (value) => (value === '' || value === undefined ? null : value);

module.exports = { parse, nullable };
