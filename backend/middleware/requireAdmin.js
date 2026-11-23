'use strict';

/** Reject unauthenticated requests to admin APIs. */
module.exports = function requireAdmin(req, res, next) {
  if (!req.admin) {
    return res.status(401).json({ error: 'Please sign in to continue.' });
  }
  return next();
};
