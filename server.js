require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');

const authRoutes = require('./routes/auth');
const diaryRoutes = require('./routes/diary');
const foodsRoutes = require('./routes/foods');
const planRoutes = require('./routes/plan');
const settingsRoutes = require('./routes/settings');

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

// Static files
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Routes
app.use('/', authRoutes);
app.use('/api/diary', diaryRoutes);
app.use('/api/foods', foodsRoutes);
app.use('/api/plan', planRoutes);
app.use('/api/settings', settingsRoutes);

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
