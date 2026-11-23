'use strict';

/** An error that is safe to show to the client. */
class HttpError extends Error {
  constructor(status, message, fields) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    if (fields) this.fields = fields;
  }
}

/** Wrap async route handlers so rejections reach the error middleware. */
const asyncHandler = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

const notFound = (message = 'Not found.') => new HttpError(404, message);

module.exports = { HttpError, asyncHandler, notFound };
