function requireHR(req, res, next) {
  if (req.session && req.session.hr) {
    return next();
  }
  res.redirect('/hr/login');
}

module.exports = { requireHR };
