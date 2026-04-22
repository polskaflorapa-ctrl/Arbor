const jwt = require('jsonwebtoken');

const SECRET = process.env.ARBOR_JWT_SECRET || 'arbor-dev-secret-change-in-production';

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    login: u.login,
    imie: u.imie,
    nazwisko: u.nazwisko,
    rola: u.rola,
    oddzial_id: u.oddzial_id ?? null,
    oddzial_nazwa: u.oddzial_nazwa ?? null,
    ekipa_id: u.ekipa_id ?? null,
  };
}

function signUser(u) {
  return jwt.sign(
    {
      sub: u.id,
      login: u.login,
      rola: u.rola,
      imie: u.imie,
      nazwisko: u.nazwisko,
      oddzial_id: u.oddzial_id,
      oddzial_nazwa: u.oddzial_nazwa,
      ekipa_id: u.ekipa_id,
    },
    SECRET,
    { expiresIn: '7d' }
  );
}

function requireAuth(req, res, next) {
  const h = req.headers.authorization || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return res.status(401).json({ error: 'Brak tokenu' });
  try {
    const payload = jwt.verify(m[1], SECRET);
    req.user = {
      id: payload.sub,
      login: payload.login,
      rola: payload.rola,
      imie: payload.imie,
      nazwisko: payload.nazwisko,
      oddzial_id: payload.oddzial_id,
      oddzial_nazwa: payload.oddzial_nazwa,
      ekipa_id: payload.ekipa_id,
    };
    next();
  } catch {
    return res.status(401).json({ error: 'Nieprawidłowy token' });
  }
}

module.exports = { SECRET, publicUser, signUser, requireAuth };
