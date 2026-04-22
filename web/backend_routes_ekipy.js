// ============================================================
// BACKEND ROUTES — Ekipy i członkowie ekip (stabilne API)
// Wklej do swojego backendu (np. routes/ekipy.js)
// i zarejestruj: app.use('/ekipy', ekipyRouter);
//
// Cel:
// - brak 500 dla typowych błędów walidacji/duplikatów
// - spójny kontrakt dla frontendu:
//   POST   /ekipy/:id/czlonkowie
//   DELETE /ekipy/:id/czlonkowie/:userId
// ============================================================

const express = require('express');
const router = express.Router();

// Wymagane z głównej aplikacji:
// - pool (pg)
// - requireAuth
// - opcjonalnie requireRole(...)
// Tu zakładamy, że są dostępne globalnie lub podmienisz importy.

// ---------- Helpers ----------

function toInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function pickFirstDefined(obj, keys) {
  for (const key of keys) {
    if (obj && obj[key] !== undefined && obj[key] !== null && obj[key] !== '') {
      return obj[key];
    }
  }
  return undefined;
}

function getMemberPayload(body) {
  const userIdRaw = pickFirstDefined(body, [
    'user_id',
    'pracownik_id',
    'uzytkownik_id',
    'userId',
    'pracownikId',
    'uzytkownikId',
  ]);
  const nestedUserIdRaw = body?.user?.id;
  const userId = toInt(userIdRaw ?? nestedUserIdRaw);

  const rolaRaw = pickFirstDefined(body, ['rola', 'rola_w_ekipie']);
  const rola = typeof rolaRaw === 'string' ? rolaRaw.trim() : '';

  return { userId, rola: rola || 'Pomocnik' };
}

function isUniqueViolation(err) {
  // PostgreSQL unique_violation
  return err && err.code === '23505';
}

// ---------- Middleware ----------

async function requireEkipaExists(req, res, next) {
  const ekipaId = toInt(req.params.id);
  if (!ekipaId) {
    return res.status(400).json({ error: 'Nieprawidłowe ID ekipy' });
  }

  try {
    const { rows } = await pool.query(
      'SELECT id, oddzial_id FROM teams WHERE id = $1 LIMIT 1',
      [ekipaId]
    );
    if (!rows.length) {
      return res.status(404).json({ error: 'Ekipa nie istnieje' });
    }
    req.ekipa = rows[0];
    next();
  } catch (err) {
    console.error('[ekipy] requireEkipaExists error', err);
    return res.status(500).json({ error: 'Błąd serwera przy sprawdzaniu ekipy' });
  }
}

async function requireUserExists(req, res, next) {
  const userId = toInt(req.params.userId);
  if (!userId) {
    return res.status(400).json({ error: 'Nieprawidłowe ID użytkownika' });
  }
  req.memberUserId = userId;
  next();
}

// ---------- Routes ----------

// POST /ekipy/:id/czlonkowie
// Body: { user_id | pracownik_id | ... , rola? | rola_w_ekipie? }
router.post('/:id/czlonkowie', requireAuth, requireEkipaExists, async (req, res) => {
  const ekipaId = req.ekipa.id;
  const { userId, rola } = getMemberPayload(req.body);

  if (!userId) {
    return res.status(422).json({
      error: 'Brak poprawnego ID pracownika',
      expectedKeys: [
        'user_id',
        'pracownik_id',
        'uzytkownik_id',
        'userId',
        'pracownikId',
        'uzytkownikId',
        'user.id',
      ],
    });
  }

  try {
    // 1) Użytkownik musi istnieć i być aktywny.
    const userRes = await pool.query(
      `SELECT id, aktywny
       FROM users
       WHERE id = $1
       LIMIT 1`,
      [userId]
    );
    if (!userRes.rows.length) {
      return res.status(404).json({ error: 'Pracownik nie istnieje' });
    }
    if (userRes.rows[0].aktywny === false) {
      return res.status(422).json({ error: 'Nie można przypisać nieaktywnego pracownika' });
    }

    // 2) Nie można dodać brygadzisty ekipy jako członka pomocniczego.
    const leadRes = await pool.query(
      'SELECT brygadzista_id FROM teams WHERE id = $1',
      [ekipaId]
    );
    if (leadRes.rows[0]?.brygadzista_id && Number(leadRes.rows[0].brygadzista_id) === userId) {
      return res.status(409).json({ error: 'Ten użytkownik jest brygadzistą tej ekipy' });
    }

    // 3) Dodanie członka - tabela łącząca team_members (team_id, user_id, rola).
    // Zakładane unikalne: (team_id, user_id)
    const insertRes = await pool.query(
      `INSERT INTO team_members (team_id, user_id, rola, created_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (team_id, user_id)
       DO NOTHING
       RETURNING id, team_id, user_id, rola`,
      [ekipaId, userId, rola]
    );

    if (!insertRes.rows.length) {
      return res.status(409).json({ error: 'Pracownik jest już przypisany do tej ekipy' });
    }

    return res.status(201).json({
      message: 'Pracownik został dodany do ekipy',
      member: insertRes.rows[0],
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return res.status(409).json({ error: 'Pracownik jest już przypisany do tej ekipy' });
    }
    console.error('[ekipy] add member error', {
      ekipaId,
      userId,
      rola,
      error: err,
    });
    return res.status(500).json({ error: 'Błąd serwera podczas dodawania członka' });
  }
});

// DELETE /ekipy/:id/czlonkowie/:userId
router.delete('/:id/czlonkowie/:userId', requireAuth, requireEkipaExists, requireUserExists, async (req, res) => {
  const ekipaId = req.ekipa.id;
  const userId = req.memberUserId;

  try {
    const delRes = await pool.query(
      `DELETE FROM team_members
       WHERE team_id = $1 AND user_id = $2
       RETURNING id`,
      [ekipaId, userId]
    );

    if (!delRes.rows.length) {
      return res.status(404).json({ error: 'Pracownik nie był przypisany do tej ekipy' });
    }

    return res.json({ message: 'Pracownik został usunięty z ekipy' });
  } catch (err) {
    console.error('[ekipy] remove member error', { ekipaId, userId, error: err });
    return res.status(500).json({ error: 'Błąd serwera podczas usuwania członka' });
  }
});

module.exports = router;
