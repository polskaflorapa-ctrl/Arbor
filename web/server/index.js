/**
 * Lokalny serwer API dla arbor-web (wyceny, wideo, rozliczenie, demo logowanie).
 *
 * Uruchomienie:
 *   cd server && npm install && npm start
 * W drugim terminalu: npm start (CRA) — proxy /api → localhost:3001
 *
 * Loginy demo (hasło = login): admin, oleg, kierownik, specjalista
 */
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.development') });

const express = require('express');
const path = require('path');
const cors = require('cors');
const apiRouter = require('./routes/api');

const app = express();
const PORT = Number(process.env.PORT) || 3001;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '12mb' }));
app.use('/api/uploads', express.static(path.join(__dirname, 'uploads')));

app.use('/api', apiRouter);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Server error' });
});

app.listen(PORT, () => {
  console.log(`[arbor-api-local] http://localhost:${PORT}/api  (health: GET /api/health)`);
  console.log('[arbor-api-local] Demo logowanie: POST /api/auth/login  { "login":"oleg","haslo":"oleg" }');
});
