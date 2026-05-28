const express = require('express');
const { z } = require('zod');
const pool = require('../config/database');
const logger = require('../config/logger');
const { authMiddleware, isDyrektorOrAdmin, isKierownik } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

const DEFAULT_KOMMO_MAPPING = {
  account_key: 'default',
  status_map: {
    'do_realizacji': 'Do_Zatwierdzenia',
    'zaplanowane': 'Zaplanowane',
    'w_realizacji': 'W_Realizacji',
    'zakonczone': 'Zakonczone',
    'anulowane': 'Anulowane',
  },
  field_aliases: {
    klient_nazwa: ['klient', 'klient nazwa', 'nazwa klienta', 'name'],
    klient_telefon: ['telefon', 'phone'],
    klient_email: ['email', 'e-mail'],
    adres: ['adres', 'address', 'adres realizacji', 'adres uslugi'],
    miasto: ['miasto', 'city'],
    typ_uslugi: ['typ uslugi', 'zakres', 'zakres prac', 'service'],
    opis: ['opis prac', 'description'],
    wartosc_planowana: ['wartosc', 'budzet', 'price', 'value'],
    priorytet: ['priorytet', 'priority'],
    data_planowana: ['data planowana', 'termin'],
    oddzial_id: ['oddzial id', 'branch id'],
    ekipa_id: ['ekipa id', 'team id'],
    pin_lat: ['lat', 'latitude'],
    pin_lng: ['lng', 'lon', 'longitude'],
    notatki_wewnetrzne: ['notatki', 'notes', 'opis'],
  },
  options: {
    auto_geocode: true,
    save_remote_attachments_as_documents: true,
    copy_attachment_binaries_to_storage: false,
  },
};

const jsonRecord = z.record(z.any()).default({});
const stringArray = z.array(z.string().trim().min(1)).default([]);

const configSchema = z.object({
  account_key: z.string().trim().min(1).max(120).default('default'),
  status_map: z.record(z.string().trim().min(1), z.string().trim().min(1)).default({}),
  field_aliases: z.record(z.string().trim().min(1), stringArray).default({}),
  options: jsonRecord,
});

function canViewKommoConfig(user) {
  return isDyrektorOrAdmin(user) || isKierownik(user);
}

async function ensureKommoConfigTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS kommo_account_mappings (
      id SERIAL PRIMARY KEY,
      account_key VARCHAR(120) NOT NULL UNIQUE,
      status_map JSONB NOT NULL DEFAULT '{}'::jsonb,
      field_aliases JSONB NOT NULL DEFAULT '{}'::jsonb,
      options JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_kommo_account_mappings_account ON kommo_account_mappings(account_key)');
}

function mergeWithDefaults(row) {
  return {
    ...DEFAULT_KOMMO_MAPPING,
    ...(row || {}),
    account_key: row?.account_key || DEFAULT_KOMMO_MAPPING.account_key,
    status_map: {
      ...DEFAULT_KOMMO_MAPPING.status_map,
      ...(row?.status_map || {}),
    },
    field_aliases: {
      ...DEFAULT_KOMMO_MAPPING.field_aliases,
      ...(row?.field_aliases || {}),
    },
    options: {
      ...DEFAULT_KOMMO_MAPPING.options,
      ...(row?.options || {}),
    },
  };
}

router.get('/config', async (req, res) => {
  if (!canViewKommoConfig(req.user)) return res.status(403).json({ error: 'Brak uprawnien' });
  const accountKey = String(req.query.account_key || 'default').trim() || 'default';
  try {
    await ensureKommoConfigTable();
    const result = await pool.query(
      `SELECT id, account_key, status_map, field_aliases, options, updated_at, updated_by
         FROM kommo_account_mappings
        WHERE account_key = $1`,
      [accountKey]
    );
    res.json(mergeWithDefaults(result.rows[0]));
  } catch (err) {
    logger.error('kommo.config.get', { message: err.message });
    res.status(500).json({ error: err.message });
  }
});

router.put('/config', async (req, res) => {
  if (!isDyrektorOrAdmin(req.user)) return res.status(403).json({ error: 'Brak uprawnien' });
  const parsed = configSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'Niepoprawna konfiguracja Kommo', details: parsed.error.flatten() });
  const data = mergeWithDefaults(parsed.data);

  try {
    await ensureKommoConfigTable();
    const result = await pool.query(
      `INSERT INTO kommo_account_mappings (
         account_key, status_map, field_aliases, options, created_by, updated_by
       ) VALUES ($1,$2::jsonb,$3::jsonb,$4::jsonb,$5,$5)
       ON CONFLICT (account_key) DO UPDATE SET
         status_map = EXCLUDED.status_map,
         field_aliases = EXCLUDED.field_aliases,
         options = EXCLUDED.options,
         updated_by = EXCLUDED.updated_by,
         updated_at = NOW()
       RETURNING id, account_key, status_map, field_aliases, options, updated_at, updated_by`,
      [
        data.account_key,
        JSON.stringify(data.status_map),
        JSON.stringify(data.field_aliases),
        JSON.stringify(data.options),
        req.user.id || null,
      ]
    );
    res.json(mergeWithDefaults(result.rows[0]));
  } catch (err) {
    logger.error('kommo.config.put', { message: err.message });
    res.status(500).json({ error: err.message });
  }
});

module.exports = { router, DEFAULT_KOMMO_MAPPING, ensureKommoConfigTable, mergeWithDefaults };
