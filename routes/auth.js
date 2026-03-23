const express = require('express');
const router = express.Router();

function isAuth(req, res, next) {
  // Per disabilitare l'auth: AUTH_ENABLED=false nel .env
  // Per riattivarla: AUTH_ENABLED=true (o rimuovere la riga)
  if (process.env.AUTH_ENABLED === 'false') return next();

  if (req.session && req.session.authenticated) {
    return next();
  }
  if (req.xhr || req.originalUrl.startsWith('/api/')) {
    return res.status(401).json({ error: 'Non autenticato' });
  }
  res.redirect('/');
}

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  const validUser = process.env.ADMIN_USER || 'admin';
  const validPass = process.env.ADMIN_PASSWORD || 'password123';

  if (username === validUser && password === validPass) {
    req.session.authenticated = true;
    req.session.username = username;
    return res.json({ ok: true });
  }
  res.status(401).json({ error: 'Credenziali non valide' });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

router.get('/api/me', isAuth, (req, res) => {
  res.json({ username: req.session.username });
});

module.exports = router;
module.exports.isAuth = isAuth;
