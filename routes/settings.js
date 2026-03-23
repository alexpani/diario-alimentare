const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { isAuth } = require('./auth');

router.use(isAuth);

// PATCH /api/settings/password
router.patch('/password', (req, res) => {
  const { current_password, new_password } = req.body;

  if (!current_password || !new_password) {
    return res.status(400).json({ error: 'Password attuale e nuova password sono obbligatorie' });
  }

  if (current_password !== (process.env.ADMIN_PASSWORD || 'password123')) {
    return res.status(401).json({ error: 'Password attuale non corretta' });
  }

  if (new_password.length < 6) {
    return res.status(400).json({ error: 'La nuova password deve essere lunga almeno 6 caratteri' });
  }

  const envPath = path.join(__dirname, '..', '.env');

  try {
    let envContent = '';
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, 'utf8');
      if (envContent.includes('ADMIN_PASSWORD=')) {
        envContent = envContent.replace(/^ADMIN_PASSWORD=.*/m, `ADMIN_PASSWORD=${new_password}`);
      } else {
        envContent += `\nADMIN_PASSWORD=${new_password}`;
      }
    } else {
      envContent = `PORT=${process.env.PORT || 3000}\nSESSION_SECRET=${process.env.SESSION_SECRET || 'secret'}\nADMIN_USER=${process.env.ADMIN_USER || 'admin'}\nADMIN_PASSWORD=${new_password}\n`;
    }

    fs.writeFileSync(envPath, envContent, 'utf8');
    process.env.ADMIN_PASSWORD = new_password;

    req.session.destroy(() => {
      res.json({ ok: true, message: 'Password aggiornata. Effettua di nuovo il login.' });
    });
  } catch (err) {
    console.error('Errore aggiornamento .env:', err);
    res.status(500).json({ error: 'Impossibile aggiornare il file .env' });
  }
});

// GET /api/settings/info
router.get('/info', (req, res) => {
  const pkg = require('../package.json');
  res.json({
    version: pkg.version,
    name: pkg.description,
    node: process.version
  });
});

module.exports = router;
