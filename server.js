require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');

const authRoutes = require('./routes/auth');
const diaryRoutes = require('./routes/diary');
const foodsRoutes = require('./routes/foods');
const planRoutes = require('./routes/plan');
const settingsRoutes = require('./routes/settings');
const externalRoutes = require('./routes/external');

const app = express();
const PORT = process.env.PORT || 3000;

// Fidati del reverse proxy (Nginx Proxy Manager) per X-Forwarded-* headers
app.set('trust proxy', 1);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'food-diary-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production', // true in prod (HTTPS), false in locale
    httpOnly: true,
    maxAge: 30 * 24 * 60 * 60 * 1000 // 30 giorni
  }
}));

// Static files — no-cache su index.html e sw.js per evitare cache stantia su nginx/browser
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('index.html') || filePath.endsWith('sw.js') || filePath.endsWith('manifest.json')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// no-cache anche sulla fallback route che serve index.html
app.use((req, res, next) => {
  if (req.path === '/' || req.path === '/index.html') {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});

// Routes
app.use('/', authRoutes);
app.use('/api/diary', diaryRoutes);
app.use('/api/foods', foodsRoutes);
app.use('/api/plan', planRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/external', externalRoutes);

// Fallback: serve index.html per tutte le route non-API
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api/')) {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  } else {
    res.status(404).json({ error: 'Not found' });
  }
});

app.listen(PORT, () => {
  console.log(`FoodDiary avviato su http://localhost:${PORT}`);
});
