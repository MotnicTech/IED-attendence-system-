'use strict';

function requireHR(req, res, next) {
  if (req.session && req.session.hr) return next();
  return res.redirect('/hr/login');
}

function requireEmployee(req, res, next) {
  if (req.session && req.session.employee) return next();
  return res.redirect('/emp/login');
}

module.exports = { requireHR, requireEmployee };
