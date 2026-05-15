const express = require('express');
const passport = require('passport');
const { Strategy: GoogleStrategy } = require('passport-google-oauth20');

function buildAuthRouter() {
  const router = express.Router();

  const callbackUrl = process.env.GOOGLE_CALLBACK_URL || 'http://localhost:4000/auth/google/callback';

  passport.use(new GoogleStrategy(  
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: callbackUrl,
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const email = profile.emails && profile.emails[0] ? profile.emails[0].value.toLowerCase() : '';
        if (!email) {
          return done(new Error('Google account email is required'));
        }

        return done(null, {
          id: profile.id,
          email,
          name: profile.displayName || email,
          picture: profile.photos && profile.photos[0] ? profile.photos[0].value : '',
        });
      } catch (err) {
        return done(err);
      }
    }
  ));

  passport.serializeUser((user, done) => done(null, user));
  passport.deserializeUser((user, done) => done(null, user));

  router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'], prompt: 'select_account' }));

  router.get('/google/callback', passport.authenticate('google', {
    failureRedirect: '/?auth=failed'
  }), (req, res) => {
    req.session.user = req.user;
    res.redirect('/?auth=success');
  });

  router.get('/logout', (req, res) => {
    req.logout(() => {
      req.session.destroy(() => {
        res.redirect('/');
      });
    });
  });

  router.get('/session', (req, res) => {
    res.json({
      authenticated: !!req.user,
      user: req.user || null
    });
  });

  return router;
}

module.exports = { buildAuthRouter, passport };
