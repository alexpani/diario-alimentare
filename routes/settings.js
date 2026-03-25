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

// GET /api/settings/off
router.get('/off', (req, res) => {
  res.json({
    user: process.env.OFF_USER || '',
    pass: process.env.OFF_PASS ? '••••••••' : ''
  });
});

// PUT /api/settings/off
router.put('/off', (req, res) => {
  const { user, pass } = req.body;
  const envPath = path.join(__dirname, '..', '.env');

  try {
    let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';

    // Aggiorna o aggiungi OFF_USER
    if (envContent.includes('OFF_USER=')) {
      envContent = envContent.replace(/^OFF_USER=.*/m, `OFF_USER=${user || ''}`);
    } else {
      envContent += `\nOFF_USER=${user || ''}`;
    }

    // Aggiorna o aggiungi OFF_PASS (solo se fornita, non il placeholder)
    if (pass && pass !== '••••••••') {
      if (envContent.includes('OFF_PASS=')) {
        envContent = envContent.replace(/^OFF_PASS=.*/m, `OFF_PASS=${pass}`);
      } else {
        envContent += `\nOFF_PASS=${pass}`;
      }
      process.env.OFF_PASS = pass;
    }

    fs.writeFileSync(envPath, envContent, 'utf8');
    process.env.OFF_USER = user || '';

    res.json({ ok: true });
  } catch (err) {
    console.error('Errore aggiornamento OFF:', err);
    res.status(500).json({ error: 'Impossibile aggiornare le credenziali' });
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
