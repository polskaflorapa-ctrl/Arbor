/**
 * Wyceny terenowe (M1 / F1) — lead → wizyta → obiekty → zdjęcia → auto-cena → zatwierdzenie → PDF → klient → zlecenie.
 */
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const pool = require('../config/database');
const logger = require('../config/logger');
const { authMiddleware } = require('../middleware/auth');
const { validateBody, validateParams } = require('../middleware/validate');
const { z } = require('zod');
const { recalculateQuotation } = require('../services/quotationPricing');
const {
  rebuildApprovals,
  notifyApproversForQuotation,
  canUserDecideApproval,
} = require('../services/quotationApprovals');
const { afterQuotationFullyApproved } = require('../services/quotationFinalize');
const { validateQuotationCompleteForVisitEnd, gpsCheckForVisitStart } = require('../services/quotationValidation');
const { applyAutoFlags } = require('../services/quotationItemFlags');

const router = express.Router();
router.use(authMiddleware);

const QUOTATION_STATUSES = [
  'OczekujePrzypisania',
  'Umowiana',
  'Draft',
  'W_Zatwierdzeniu',
  'Zatwierdzona',
  'Zwrocona',
  'Odrzucona',
  'Wyslana_Klientowi',
  'Zaakceptowana',
  'Wygasla',
];

const isDyrektor = (u) => u.rola === 'Dyrektor' || u.rola === 'Administrator';
const isKierownik = (u) => u.rola === 'Kierownik';
const isWyceniajacy = (u) => u.rola === 'Wyceniający';
function toInt(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

async function fetchQuotation(id) {
  const { rows } = await pool.query(`SELECT * FROM quotations WHERE id = $1`, [id]);
  return rows[0] || null;
}

function canView(user, row) {
  if (!row) return false;
  if (isDyrektor(user)) return true;
  if (isKierownik(user) && Number(user.oddzial_id) === Number(row.oddzial_id)) return true;
  if (isWyceniajacy(user) && Number(row.wyceniajacy_id) === Number(user.id)) return true;
  if (['Specjalista', 'Brygadzista'].includes(user.rola) && Number(user.oddzial_id) === Number(row.oddzial_id)) {
    return true;
  }
  return false;
}

function canEditDraft(user, row) {
  if (!row || row.locked_at) return false;
  if (!['Draft', 'Zwrocona', 'Umowiana'].includes(row.status)) return false;
  if (!isWyceniajacy(user) || Number(row.wyceniajacy_id) !== Number(user.id)) return false;
  return true;
}

const idParam = z.object({ id: z.coerce.number().int().positive() });
const itemIdParam = z.object({ id: z.coerce.number().int().positive(), itemId: z.coerce.number().int().positive() });
const approvalIdParam = z.object({
  id: z.coerce.number().int().positive(),
  aid: z.coerce.number().int().positive(),
});

function toFloatBody(val) {
  if (val === '' || val === null || val === undefined) return null;
  const n = parseFloat(String(val));
  return Number.isNaN(n) ? null : n;
}

const qItemPhotoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join('uploads', 'quotations', 'items');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '') || '.jpg';
    cb(null, `qitem_${req.params.id}_${req.params.itemId}_${Date.now()}${ext}`);
  },
});
const qItemPhotoUpload = multer({
  storage: qItemPhotoStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Tylko obrazy'), false);
  },
});

const qHeadPhotoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join('uploads', 'quotations', 'head');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '') || '.jpg';
    cb(null, `qhead_${req.params.id}_${Date.now()}${ext}`);
  },
});
const qHeadPhotoUpload = multer({
  storage: qHeadPhotoStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Tylko obrazy'), false);
  },
});

const createSchema = z.object({
  wyceniajacy_id: z.coerce.number().int().positive().optional().nullable(),
  crm_lead_id: z.coerce.number().int().positive().optional().nullable(),
  kommo_lead_external_id: z.string().max(64).optional().nullable(),
  klient_nazwa: z.string().max(200).optional().nullable(),
  klient_telefon: z.string().max(40).optional().nullable(),
  klient_email: z.string().max(255).optional().nullable(),
  adres: z.string().max(500).optional().nullable(),
  miasto: z.string().max(100).optional().nullable(),
  lat: z.number().optional().nullable(),
  lng: z.number().optional().nullable(),
  kommo_sales_notes: z.string().optional().nullable(),
  status: z.enum(['Draft', 'Umowiana']).optional(),
});

const patchSchema = z
  .object({
    klient_nazwa: z.string().max(200).optional().nullable(),
    klient_telefon: z.string().max(40).optional().nullable(),
    klient_email: z.string().max(255).optional().nullable(),
    adres: z.string().max(500).optional().nullable(),
    miasto: z.string().max(100).optional().nullable(),
    lat: z.number().optional().nullable(),
    lng: z.number().optional().nullable(),
    kommo_sales_notes: z.string().optional().nullable(),
    wartosc_sugerowana: z.number().optional().nullable(),
    wartosc_zaproponowana: z.number().optional().nullable(),
    marza_pct: z.number().optional().nullable(),
    korekta_uzasadnienie: z.string().max(2000).optional().nullable(),
    korekta_dropdown: z.string().max(80).optional().nullable(),
    waznosc_do: z.string().max(40).optional().nullable(),
    status: z.enum(QUOTATION_STATUSES).optional(),
    priorytet: z.string().max(30).optional().nullable(),
    flag_pomnikowe: z.boolean().optional(),
    flag_reklamacja_vip: z.boolean().optional(),
    klient_czeka_na_miejscu: z.boolean().optional(),
    data_wizyty_planowana: z.string().max(40).optional().nullable(),
    reopen_note: z.string().max(2000).optional().nullable(),
  })
  .strict();

const visitGpsSchema = z.object({
  lat: z.number(),
  lng: z.number(),
});

const visitStartSchema = visitGpsSchema.extend({
  gps_override_ack: z.boolean().optional(),
  gps_override_note: z.string().max(500).optional().nullable(),
});

const visitEndSchema = visitGpsSchema.extend({
  waznosc_do: z.string().max(40).optional().nullable(),
});

const assignSchema = z.object({
  wyceniajacy_id: z.coerce.number().int().positive(),
  data_wizyty_planowana: z.string().max(40).optional().nullable(),
});

const itemCreateSchema = z.object({
  kolejnosc: z.coerce.number().int().min(0).optional(),
  gatunek: z.string().min(1).max(64),
  wysokosc_pas: z.string().min(1).max(32),
  piersnica_pas: z.string().max(32).optional().nullable(),
  typ_pracy: z.string().min(1).max(80),
  warunki_dojazdu: z.string().max(80).optional().nullable(),
  przeszkody: z.array(z.string()).optional(),
  wymagane_uprawnienia: z.array(z.string()).optional(),
  czas_planowany_min: z.coerce.number().int().min(0).optional().nullable(),
  wymagany_sprzet: z.string().max(500).optional().nullable(),
  koszt_wlasny: z.number().optional().nullable(),
  cena_pozycji: z.number().optional().nullable(),
  metadata: z.record(z.unknown()).optional(),
});

const itemPatchSchema = itemCreateSchema.partial();

const photoSchema = z.object({
  original_url: z.string().url().max(2000),
  annotated_preview_url: z.string().url().max(2000).optional().nullable(),
  rendered_png_url: z.string().url().max(2000).optional().nullable(),
  annotations_json: z.record(z.unknown()).optional(),
  photo_kind: z.enum(['general', 'annotated']).optional(),
  lat: z.number().optional().nullable(),
  lng: z.number().optional().nullable(),
  photo_timestamp: z.string().max(40).optional(),
  autor_typ: z.string().max(24).optional(),
});

router.get('/norms/service-times', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM quotation_service_norms WHERE valid_to IS NULL OR valid_to >= CURRENT_DATE ORDER BY gatunek_key, wysokosc_pas`
    );
    res.json(rows);
  } catch (e) {
    logger.error('quotations.norms', { message: e.message });
    res.status(500).json({ error: 'Błąd katalogu norm' });
  }
});

router.get('/panel/do-przypisania', async (req, res) => {
  try {
    const u = req.user;
    if (!isKierownik(u) && !isDyrektor(u)) {
      return res.status(403).json({ error: 'Brak dostępu' });
    }
    const p = [];
    let sql = `SELECT q.* FROM quotations q WHERE q.status = 'OczekujePrzypisania'`;
    if (isKierownik(u) && u.oddzial_id) {
      p.push(u.oddzial_id);
      sql += ` AND q.oddzial_id = $1`;
    }
    sql += ` ORDER BY q.updated_at DESC NULLS LAST LIMIT 200`;
    const { rows } = await pool.query(sql, p);
    res.json(rows);
  } catch (e) {
    logger.error('quotations.panel.assign', { message: e.message });
    res.status(500).json({ error: 'Błąd listy' });
  }
});

router.get('/panel/moje-zatwierdzenia', async (req, res) => {
  try {
    const u = req.user;
    const { rows } = await pool.query(
      `SELECT q.*, a.id AS approval_id, a.wymagany_typ, a.due_at, a.decyzja
       FROM quotation_approvals a
       JOIN quotations q ON q.id = a.quotation_id
       WHERE a.decyzja = 'Pending' AND q.status = 'W_Zatwierdzeniu'
       ORDER BY a.due_at NULLS LAST, q.id DESC`
    );
    const out = rows.filter((r) => canUserDecideApproval(u, { wymagany_typ: r.wymagany_typ, id: r.approval_id }, r));
    res.json(out);
  } catch (e) {
    logger.error('quotations.panel.approvals', { message: e.message });
    res.status(500).json({ error: 'Błąd kolejki' });
  }
});

router.get('/', async (req, res) => {
  try {
    const u = req.user;
    const st = req.query.status ? String(req.query.status) : null;
    let sql = `SELECT q.* FROM quotations q WHERE 1=1`;
    const p = [];
    if (isWyceniajacy(u)) {
      p.push(u.id);
      sql += ` AND q.wyceniajacy_id = $${p.length}`;
    } else if (isKierownik(u) && u.oddzial_id) {
      p.push(u.oddzial_id);
      sql += ` AND q.oddzial_id = $${p.length}`;
    } else if (!isDyrektor(u)) {
      p.push(u.oddzial_id);
      sql += ` AND q.oddzial_id = $${p.length}`;
    }
    if (st && QUOTATION_STATUSES.includes(st)) {
      p.push(st);
      sql += ` AND q.status = $${p.length}`;
    }
    sql += ` ORDER BY q.updated_at DESC NULLS LAST, q.id DESC LIMIT 200`;
    const { rows } = await pool.query(sql, p);
    res.json(rows);
  } catch (e) {
    logger.error('quotations.list', { message: e.message });
    res.status(500).json({ error: 'Błąd listy wycen terenowych' });
  }
});

router.post('/', validateBody(createSchema), async (req, res) => {
  const u = req.user;
  if (!isWyceniajacy(u) && !isKierownik(u) && !isDyrektor(u)) {
    return res.status(403).json({ error: 'Brak uprawnień do tworzenia wyceny terenowej' });
  }
  const b = req.body;
  const oddzialId = toInt(u.oddzial_id);
  if (!oddzialId) return res.status(400).json({ error: 'Użytkownik bez oddziału' });
  let wycId = isWyceniajacy(u) ? toInt(u.id) : toInt(b.wyceniajacy_id);
  const status = b.status === 'Umowiana' ? 'Umowiana' : 'Draft';
  if (!wycId && (isKierownik(u) || isDyrektor(u))) {
    return res.status(400).json({ error: 'Podaj wyceniajacy_id (przypisanie wyceny)' });
  }

  try {
    const now = new Date().toISOString();
    const { rows } = await pool.query(
      `INSERT INTO quotations (
        crm_lead_id, kommo_lead_external_id, wyceniajacy_id, oddzial_id,
        klient_nazwa, klient_telefon, klient_email, adres, miasto, lat, lng,
        kommo_sales_notes, status, created_by, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
      RETURNING *`,
      [
        toInt(b.crm_lead_id),
        b.kommo_lead_external_id || null,
        wycId,
        oddzialId,
        b.klient_nazwa || null,
        b.klient_telefon || null,
        b.klient_email || null,
        b.adres || null,
        b.miasto || null,
        b.lat ?? null,
        b.lng ?? null,
        b.kommo_sales_notes || null,
        status,
        u.id,
        now,
        now,
      ]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    logger.error('quotations.create', { message: e.message });
    res.status(500).json({ error: 'Nie udało się utworzyć wyceny' });
  }
});

router.post('/:id/assign', validateParams(idParam), validateBody(assignSchema), async (req, res) => {
  const row = await fetchQuotation(req.params.id);
  if (!row) return res.status(404).json({ error: 'Nie znaleziono' });
  const u = req.user;
  if (!isKierownik(u) && !isDyrektor(u)) return res.status(403).json({ error: 'Brak uprawnień' });
  if (isKierownik(u) && Number(u.oddzial_id) !== Number(row.oddzial_id)) {
    return res.status(403).json({ error: 'Inny oddział' });
  }
  if (row.status !== 'OczekujePrzypisania') {
    return res.status(400).json({ error: 'Wycena nie oczekuje na przypisanie' });
  }
  if (!row.lat || !row.lng) {
    return res.status(400).json({ error: 'Brak zgeokodowanego adresu — popraw adres w Kommo i ponów import' });
  }
  const { wyceniajacy_id, data_wizyty_planowana } = req.body;
  const wu = await pool.query(`SELECT id, oddzial_id FROM users WHERE id = $1 AND rola = 'Wyceniający'`, [wyceniajacy_id]);
  if (!wu.rows[0]) return res.status(400).json({ error: 'Nieprawidłowy wyceniający' });
  if (Number(wu.rows[0].oddzial_id) !== Number(row.oddzial_id)) {
    return res.status(400).json({ error: 'Wyceniający musi być z tego samego oddziału' });
  }
  const now = new Date().toISOString();
  const { rows } = await pool.query(
    `UPDATE quotations SET wyceniajacy_id = $1, status = 'Umowiana', data_wizyty_planowana = COALESCE($2::timestamptz, data_wizyty_planowana), updated_at = $3 WHERE id = $4 RETURNING *`,
    [wyceniajacy_id, data_wizyty_planowana || null, now, req.params.id]
  );
  const out = rows[0];
  await pool.query(
    `INSERT INTO notifications (from_user_id, to_user_id, task_id, quotation_id, typ, tresc, status)
     VALUES ($1, $2, NULL, $3, 'quotation_assigned', $4, 'Nowe')`,
    [
      u.id,
      wyceniajacy_id,
      req.params.id,
      `Przypisano Cię do wyceny terenowej #${req.params.id}. ${out.adres || ''} ${out.miasto || ''}`.trim(),
    ]
  );
  res.json(out);
});

router.get('/:id', validateParams(idParam), async (req, res) => {
  const row = await fetchQuotation(req.params.id);
  if (!row) return res.status(404).json({ error: 'Nie znaleziono' });
  if (!canView(req.user, row)) return res.status(403).json({ error: 'Brak dostępu' });
  res.json(row);
});

router.patch('/:id', validateParams(idParam), validateBody(patchSchema), async (req, res) => {
  const row = await fetchQuotation(req.params.id);
  if (!row) return res.status(404).json({ error: 'Nie znaleziono' });
  const u = req.user;
  const locked = !!row.locked_at;
  if (locked && !isDyrektor(u) && !isKierownik(u)) {
    return res.status(400).json({ error: 'Wycena zablokowana po zakończeniu wizyty — wymagane otwarcie przez kierownika' });
  }
  if (!canView(u, row)) return res.status(403).json({ error: 'Brak dostępu' });

  const b = req.body;
  if (b.reopen_note && (isKierownik(u) || isDyrektor(u)) && locked) {
    const now = new Date().toISOString();
    const { rows } = await pool.query(
      `UPDATE quotations SET locked_at = NULL, status = 'Draft', reopened_at = $1, reopened_note = $2, reopened_by = $3, updated_at = $1 WHERE id = $4 RETURNING *`,
      [now, b.reopen_note, u.id, req.params.id]
    );
    if (row.wyceniajacy_id) {
      await pool.query(
        `INSERT INTO notifications (from_user_id, to_user_id, task_id, quotation_id, typ, tresc, status)
         VALUES ($1, $2, NULL, $3, 'quotation_reopened', $4, 'Nowe')`,
        [u.id, row.wyceniajacy_id, req.params.id, `Wycena #${req.params.id} otwarta do poprawek: ${b.reopen_note}`]
      );
    }
    return res.json(rows[0]);
  }

  if (['Draft', 'Zwrocona', 'Umowiana'].includes(row.status) && !canEditDraft(u, row) && !isKierownik(u) && !isDyrektor(u)) {
    return res.status(403).json({ error: 'Brak uprawnień do edycji' });
  }

  const sets = [];
  const vals = [req.params.id];
  let i = 2;
  const push = (col, val) => {
    sets.push(`${col} = $${i++}`);
    vals.push(val);
  };
  for (const k of [
    'klient_nazwa',
    'klient_telefon',
    'klient_email',
    'adres',
    'miasto',
    'lat',
    'lng',
    'kommo_sales_notes',
    'wartosc_sugerowana',
    'wartosc_zaproponowana',
    'marza_pct',
    'korekta_uzasadnienie',
    'korekta_dropdown',
    'waznosc_do',
    'status',
    'priorytet',
    'flag_pomnikowe',
    'flag_reklamacja_vip',
    'klient_czeka_na_miejscu',
    'data_wizyty_planowana',
  ]) {
    if (b[k] !== undefined) push(k, b[k]);
  }
  if (sets.length === 0) return res.json(row);
  push('updated_at', new Date().toISOString());
  try {
    const { rows } = await pool.query(`UPDATE quotations SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, vals);
    let out = rows[0];
    if (b.wartosc_zaproponowana != null || b.wartosc_sugerowana != null) {
      const k0 = Number(out.koszt_wlasny_calkowity);
      const p0 = Number(out.wartosc_zaproponowana);
      if (Number.isFinite(k0) && Number.isFinite(p0) && p0 > 0) {
        const m = ((p0 - k0) / p0) * 100;
        const r2 = await pool.query(`UPDATE quotations SET marza_pct = $1 WHERE id = $2 RETURNING *`, [m, req.params.id]);
        out = r2.rows[0];
      }
    }
    res.json(out);
  } catch (e) {
    logger.error('quotations.patch', { message: e.message });
    res.status(500).json({ error: 'Aktualizacja nie powiodła się' });
  }
});

router.post('/:id/visit/start', validateParams(idParam), validateBody(visitStartSchema), async (req, res) => {
  const row = await fetchQuotation(req.params.id);
  if (!row) return res.status(404).json({ error: 'Nie znaleziono' });
  const u = req.user;
  const owner = isWyceniajacy(u) && Number(row.wyceniajacy_id) === Number(u.id);
  if (!canEditDraft(u, row) && !owner && !isDyrektor(u)) {
    return res.status(403).json({ error: 'Brak uprawnień' });
  }
  if (!['Umowiana', 'Draft', 'Zwrocona'].includes(row.status)) {
    return res.status(400).json({ error: 'Nieprawidłowy status do rozpoczęcia wizyty' });
  }
  if (row.visit_started_at) return res.status(400).json({ error: 'Wizyta już rozpoczęta' });
  const { lat, lng, gps_override_ack, gps_override_note } = req.body;
  if (!row.lat || !row.lng) {
    return res.status(400).json({ error: 'Brak współrzędnych adresu wyceny (geokodowanie)' });
  }
  const chk = gpsCheckForVisitStart(row, lat, lng);
  if (!chk.ok) {
    if (chk.needsOverride) {
      if (!gps_override_ack || !String(gps_override_note || '').trim()) {
        return res.status(400).json({
          error: chk.message,
          code: 'GPS_FAR_FROM_SITE',
          distanceM: chk.distanceM,
          requires_confirmation: true,
        });
      }
    } else {
      return res.status(400).json({ error: chk.message || 'GPS' });
    }
  }
  const now = new Date().toISOString();
  const nextStatus = row.status === 'Umowiana' ? 'Draft' : row.status;
  const { rows } = await pool.query(
    `UPDATE quotations SET visit_started_at = $1, visit_start_lat = $2, visit_start_lng = $3,
      visit_gps_override_note = $4, visit_gps_override_at = $5, status = $6, updated_at = $1
     WHERE id = $7 RETURNING *`,
    [
      now,
      lat,
      lng,
      gps_override_ack ? gps_override_note || null : null,
      gps_override_ack ? now : null,
      nextStatus,
      req.params.id,
    ]
  );
  res.json(rows[0]);
});

router.post('/:id/visit/end', validateParams(idParam), validateBody(visitEndSchema), async (req, res) => {
  const row = await fetchQuotation(req.params.id);
  if (!row) return res.status(404).json({ error: 'Nie znaleziono' });
  if (!isWyceniajacy(req.user) || Number(row.wyceniajacy_id) !== Number(req.user.id)) {
    if (!isDyrektor(req.user)) return res.status(403).json({ error: 'Brak uprawnień' });
  }
  if (!row.visit_started_at) return res.status(400).json({ error: 'Najpierw rozpocznij wizytę' });
  try {
    await recalculateQuotation(pool, req.params.id);
  } catch (e) {
    logger.warn('quotations.visitEnd.recalc', { message: e.message });
  }
  const v = await validateQuotationCompleteForVisitEnd(pool, req.params.id);
  if (!v.ok) return res.status(400).json({ error: 'Wycena niekompletna', details: v.errors });

  const { lat, lng, waznosc_do: wzBody } = req.body;
  const waznosc = wzBody || row.waznosc_do;
  if (!waznosc) return res.status(400).json({ error: 'Podaj ważność oferty (waznosc_do)' });

  const now = new Date().toISOString();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE quotations SET visit_ended_at = $1, visit_end_lat = $2, visit_end_lng = $3,
        locked_at = $1, czas_wizyty_minuty = GREATEST(1, EXTRACT(EPOCH FROM ($1::timestamptz - visit_started_at))::int / 60),
        status = 'W_Zatwierdzeniu', waznosc_do = COALESCE($4::timestamptz, waznosc_do), updated_at = $1
       WHERE id = $5`,
      [now, lat, lng, waznosc, req.params.id]
    );
    await rebuildApprovals(client, req.params.id);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    logger.error('quotations.visitEnd', { message: e.message });
    return res.status(500).json({ error: 'Nie udało się zakończyć wizyty' });
  } finally {
    client.release();
  }
  await notifyApproversForQuotation(pool, req.params.id);
  const out = await fetchQuotation(req.params.id);
  res.json(out);
});

/** @deprecated — zakończenie wizyty wysyła od razu do zatwierdzenia (F1.7). */
router.post('/:id/submit-approval', validateParams(idParam), async (req, res) => {
  const row = await fetchQuotation(req.params.id);
  if (!row) return res.status(404).json({ error: 'Nie znaleziono' });
  if (row.status === 'W_Zatwierdzeniu') return res.json(row);
  return res.status(400).json({ error: 'Użyj „Zakończ wizytę” — wycena jest wysyłana do akceptacji automatycznie po zakończeniu wizyty' });
});

router.get('/:id/items', validateParams(idParam), async (req, res) => {
  const row = await fetchQuotation(req.params.id);
  if (!row) return res.status(404).json({ error: 'Nie znaleziono' });
  if (!canView(req.user, row)) return res.status(403).json({ error: 'Brak dostępu' });
  const { rows } = await pool.query(
    `SELECT * FROM quotation_items WHERE quotation_id = $1 ORDER BY kolejnosc ASC, id ASC`,
    [req.params.id]
  );
  res.json(rows);
});

router.post('/:id/items', validateParams(idParam), validateBody(itemCreateSchema), async (req, res) => {
  const row = await fetchQuotation(req.params.id);
  if (!row) return res.status(404).json({ error: 'Nie znaleziono' });
  if (!canEditDraft(req.user, row)) return res.status(403).json({ error: 'Brak uprawnień' });
  const b = req.body;
  const flags = applyAutoFlags(b);
  try {
    const { rows } = await pool.query(
      `INSERT INTO quotation_items (
        quotation_id, kolejnosc, gatunek, wysokosc_pas, piersnica_pas, typ_pracy, warunki_dojazdu,
        przeszkody, wymagane_uprawnienia, czas_planowany_min, wymagany_sprzet, koszt_wlasny, cena_pozycji, metadata
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12,$13,$14::jsonb)
      RETURNING *`,
      [
        req.params.id,
        b.kolejnosc ?? 0,
        b.gatunek,
        b.wysokosc_pas,
        b.piersnica_pas ?? null,
        b.typ_pracy,
        b.warunki_dojazdu ?? null,
        JSON.stringify(flags.przeszkody),
        JSON.stringify(flags.wymagane_uprawnienia),
        b.czas_planowany_min ?? null,
        b.wymagany_sprzet ?? null,
        b.koszt_wlasny ?? null,
        b.cena_pozycji ?? null,
        JSON.stringify(b.metadata || {}),
      ]
    );
    await pool.query(`UPDATE quotations SET updated_at = NOW() WHERE id = $1`, [req.params.id]);
    try {
      await recalculateQuotation(pool, req.params.id);
    } catch (e) {
      logger.warn('quotations.item.recalc', { message: e.message });
    }
    const r2 = await pool.query(`SELECT * FROM quotation_items WHERE id = $1`, [rows[0].id]);
    res.status(201).json(r2.rows[0]);
  } catch (e) {
    logger.error('quotations.item.create', { message: e.message });
    res.status(500).json({ error: 'Nie udało się dodać pozycji' });
  }
});

router.patch('/:id/items/:itemId', validateParams(itemIdParam), validateBody(itemPatchSchema), async (req, res) => {
  const row = await fetchQuotation(req.params.id);
  if (!row) return res.status(404).json({ error: 'Nie znaleziono' });
  if (!canEditDraft(req.user, row)) return res.status(403).json({ error: 'Brak uprawnień' });
  const b = { ...req.body };
  const cur = (await pool.query(`SELECT * FROM quotation_items WHERE id = $1 AND quotation_id = $2`, [req.params.itemId, req.params.id]))
    .rows[0];
  if (!cur) return res.status(404).json({ error: 'Brak pozycji' });
  const merged = { ...cur, ...b, przeszkody: b.przeszkody ?? cur.przeszkody, wymagane_uprawnienia: b.wymagane_uprawnienia ?? cur.wymagane_uprawnienia };
  const flags = applyAutoFlags(merged);
  const sets = [];
  const vals = [req.params.itemId, req.params.id];
  let i = 3;
  const add = (col, val) => {
    if (val === undefined) return;
    if (['przeszkody', 'wymagane_uprawnienia', 'metadata'].includes(col)) {
      sets.push(`${col} = $${i++}::jsonb`);
      vals.push(JSON.stringify(val));
    } else {
      sets.push(`${col} = $${i++}`);
      vals.push(val);
    }
  };
  const patch = { ...b, przeszkody: flags.przeszkody, wymagane_uprawnienia: flags.wymagane_uprawnienia };
  for (const k of Object.keys(itemPatchSchema.shape)) {
    if (patch[k] !== undefined) add(k, patch[k]);
  }
  if (!sets.length) {
    const r = await pool.query(`SELECT * FROM quotation_items WHERE id = $1 AND quotation_id = $2`, vals);
    return res.json(r.rows[0] || null);
  }
  const { rows } = await pool.query(
    `UPDATE quotation_items SET ${sets.join(', ')} WHERE id = $1 AND quotation_id = $2 RETURNING *`,
    vals
  );
  await pool.query(`UPDATE quotations SET updated_at = NOW() WHERE id = $1`, [req.params.id]);
  try {
    await recalculateQuotation(pool, req.params.id);
  } catch (e) {
    logger.warn('quotations.item.patch.recalc', { message: e.message });
  }
  res.json(rows[0]);
});

router.delete('/:id/items/:itemId', validateParams(itemIdParam), async (req, res) => {
  const row = await fetchQuotation(req.params.id);
  if (!row) return res.status(404).json({ error: 'Nie znaleziono' });
  if (!canEditDraft(req.user, row)) return res.status(403).json({ error: 'Brak uprawnień' });
  await pool.query(`DELETE FROM annotated_photos WHERE parent_object_type = 'quotation_item' AND parent_object_id = $1`, [
    req.params.itemId,
  ]);
  await pool.query(`DELETE FROM quotation_items WHERE id = $1 AND quotation_id = $2`, [req.params.itemId, req.params.id]);
  await pool.query(`UPDATE quotations SET updated_at = NOW() WHERE id = $1`, [req.params.id]);
  res.json({ ok: true });
});

router.get('/:id/items/:itemId/photos', validateParams(itemIdParam), async (req, res) => {
  const row = await fetchQuotation(req.params.id);
  if (!row) return res.status(404).json({ error: 'Nie znaleziono' });
  if (!canView(req.user, row)) return res.status(403).json({ error: 'Brak dostępu' });
  const it = await pool.query(`SELECT 1 FROM quotation_items WHERE id = $1 AND quotation_id = $2`, [
    req.params.itemId,
    req.params.id,
  ]);
  if (!it.rows[0]) return res.status(404).json({ error: 'Brak pozycji' });
  const { rows } = await pool.query(
    `SELECT * FROM annotated_photos WHERE parent_object_type = 'quotation_item' AND parent_object_id = $1 ORDER BY id`,
    [req.params.itemId]
  );
  res.json(rows);
});

router.post('/:id/items/:itemId/photos', validateParams(itemIdParam), validateBody(photoSchema), async (req, res) => {
  const row = await fetchQuotation(req.params.id);
  if (!row) return res.status(404).json({ error: 'Nie znaleziono' });
  if (!canView(req.user, row)) return res.status(403).json({ error: 'Brak dostępu' });
  const reviewer = isKierownik(req.user) || isDyrektor(req.user);
  if (!canEditDraft(req.user, row) && !reviewer) {
    return res.status(403).json({ error: 'Brak uprawnień do dodawania zdjęć' });
  }
  const it = await pool.query(`SELECT 1 FROM quotation_items WHERE id = $1 AND quotation_id = $2`, [
    req.params.itemId,
    req.params.id,
  ]);
  if (!it.rows[0]) return res.status(404).json({ error: 'Brak pozycji' });
  const b = req.body;
  const ts = b.photo_timestamp || new Date().toISOString();
  const kind = b.photo_kind || 'general';
  const autorTyp =
    b.autor_typ || (isWyceniajacy(req.user) ? 'Wyceniający' : reviewer ? 'Recenzent' : 'Brygadzista');
  const { rows } = await pool.query(
    `INSERT INTO annotated_photos (
      parent_object_type, parent_object_id, original_url, annotated_preview_url, rendered_png_url, annotations_json,
      lat, lng, photo_timestamp, autor_user_id, autor_typ, photo_kind
    ) VALUES ('quotation_item', $1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11) RETURNING *`,
    [
      req.params.itemId,
      b.original_url,
      b.annotated_preview_url || null,
      b.rendered_png_url || null,
      JSON.stringify(b.annotations_json || {}),
      b.lat ?? null,
      b.lng ?? null,
      ts,
      req.user.id,
      autorTyp,
      kind,
    ]
  );
  res.status(201).json(rows[0]);
});

/** Multipart upload zdjęcia do pozycji (jak /tasks/:id/zdjecia) — pole `zdjecie`, opcjonalnie `photo_kind`, `lat`, `lng`. */
router.post(
  '/:id/items/:itemId/zdjecia',
  validateParams(itemIdParam),
  qItemPhotoUpload.single('zdjecie'),
  async (req, res) => {
    try {
      const row = await fetchQuotation(req.params.id);
      if (!row) return res.status(404).json({ error: 'Nie znaleziono' });
      if (!canView(req.user, row)) return res.status(403).json({ error: 'Brak dostępu' });
      const reviewer = isKierownik(req.user) || isDyrektor(req.user);
      if (!canEditDraft(req.user, row) && !reviewer) {
        return res.status(403).json({ error: 'Brak uprawnień do dodawania zdjęć' });
      }
      const it = await pool.query(`SELECT 1 FROM quotation_items WHERE id = $1 AND quotation_id = $2`, [
        req.params.itemId,
        req.params.id,
      ]);
      if (!it.rows[0]) return res.status(404).json({ error: 'Brak pozycji' });
      if (!req.file) return res.status(400).json({ error: 'Brak pliku (pole zdjecie)' });
      const rel = `/uploads/quotations/items/${req.file.filename}`;
      const kind = req.body.photo_kind === 'annotated' ? 'annotated' : 'general';
      const ts = new Date().toISOString();
      const autorTyp =
        req.body.autor_typ ||
        (isWyceniajacy(req.user) ? 'Wyceniający' : reviewer ? 'Recenzent' : 'Brygadzista');
      const { rows } = await pool.query(
        `INSERT INTO annotated_photos (
        parent_object_type, parent_object_id, original_url, annotated_preview_url, rendered_png_url, annotations_json,
        lat, lng, photo_timestamp, autor_user_id, autor_typ, photo_kind
      ) VALUES ('quotation_item', $1, $2, NULL, NULL, '{}'::jsonb, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [
          req.params.itemId,
          rel,
          toFloatBody(req.body.lat),
          toFloatBody(req.body.lng),
          ts,
          req.user.id,
          autorTyp,
          kind,
        ]
      );
      res.status(201).json(rows[0]);
    } catch (err) {
      logger.error('quotations.item.zdjecia', { message: err.message });
      res.status(500).json({ error: err.message || 'Błąd uploadu' });
    }
  }
);

router.get('/:id/approvals', validateParams(idParam), async (req, res) => {
  const row = await fetchQuotation(req.params.id);
  if (!row) return res.status(404).json({ error: 'Nie znaleziono' });
  if (!canView(req.user, row)) return res.status(403).json({ error: 'Brak dostępu' });
  const { rows } = await pool.query(`SELECT * FROM quotation_approvals WHERE quotation_id = $1 ORDER BY id`, [req.params.id]);
  res.json(rows);
});

const decisionSchema = z.object({
  decyzja: z.enum(['Approved', 'Returned', 'Rejected']),
  komentarz: z.string().max(4000).optional().nullable(),
});

router.post(
  '/:id/approvals/:aid/decision',
  validateParams(approvalIdParam),
  validateBody(decisionSchema),
  async (req, res) => {
    const row = await fetchQuotation(req.params.id);
    if (!row) return res.status(404).json({ error: 'Nie znaleziono' });
    const u = req.user;
    const appr = (
      await pool.query(`SELECT * FROM quotation_approvals WHERE id = $1 AND quotation_id = $2`, [req.params.aid, req.params.id])
    ).rows[0];
    if (!appr) return res.status(404).json({ error: 'Brak akceptacji' });
    if (!canUserDecideApproval(u, appr, row)) {
      return res.status(403).json({ error: 'Brak uprawnień do tej roli zatwierdzającego' });
    }
    const { decyzja, komentarz } = req.body;
    const now = new Date().toISOString();
    if (decyzja === 'Rejected' && !String(komentarz || '').trim()) {
      return res.status(400).json({ error: 'Odrzucenie wymaga uzasadnienia (komentarz)' });
    }
    await pool.query(
      `UPDATE quotation_approvals SET decyzja = $1, komentarz = $2, data_decyzji = $3, zatwierdzajacy_user_id = $4
       WHERE id = $5 AND quotation_id = $6`,
      [decyzja, komentarz || null, now, u.id, req.params.aid, req.params.id]
    );

    if (decyzja === 'Returned') {
      await pool.query(`DELETE FROM quotation_approvals WHERE quotation_id = $1`, [req.params.id]);
      await pool.query(`UPDATE quotations SET status = 'Zwrocona', locked_at = NULL, updated_at = $1 WHERE id = $2`, [
        now,
        req.params.id,
      ]);
      if (row.wyceniajacy_id) {
        await pool.query(
          `INSERT INTO notifications (from_user_id, to_user_id, task_id, quotation_id, typ, tresc, status)
           VALUES ($1, $2, NULL, $3, 'quotation_returned', $4, 'Nowe')`,
          [u.id, row.wyceniajacy_id, req.params.id, `Wycena #${req.params.id} zwrócona: ${komentarz || ''}`]
        );
      }
    } else if (decyzja === 'Rejected') {
      await pool.query(`UPDATE quotations SET status = 'Odrzucona', updated_at = $1 WHERE id = $2`, [now, req.params.id]);
    } else {
      const { rows: pend } = await pool.query(
        `SELECT COUNT(*)::int AS c FROM quotation_approvals WHERE quotation_id = $1 AND decyzja = 'Pending'`,
        [req.params.id]
      );
      if (!pend[0] || pend[0].c === 0) {
        await pool.query(`UPDATE quotations SET status = 'Zatwierdzona', data_zatwierdzenia = $1, updated_at = $1 WHERE id = $2`, [
          now,
          req.params.id,
        ]);
        try {
          await afterQuotationFullyApproved(pool, req.params.id);
        } catch (e) {
          logger.error('quotations.afterApproved', { message: e.message });
        }
      }
    }
    const out = await fetchQuotation(req.params.id);
    res.json(out);
  }
);

router.get('/:id/photos', validateParams(idParam), async (req, res) => {
  const row = await fetchQuotation(req.params.id);
  if (!row) return res.status(404).json({ error: 'Nie znaleziono' });
  if (!canView(req.user, row)) return res.status(403).json({ error: 'Brak dostępu' });
  const { rows } = await pool.query(
    `SELECT * FROM annotated_photos
     WHERE (parent_object_type = 'quotation' AND parent_object_id = $1)
        OR (parent_object_type = 'quotation_item' AND parent_object_id IN (
          SELECT id FROM quotation_items WHERE quotation_id = $1
        ))
     ORDER BY id`,
    [req.params.id]
  );
  res.json(rows);
});

router.post('/:id/photos', validateParams(idParam), validateBody(photoSchema), async (req, res) => {
  const row = await fetchQuotation(req.params.id);
  if (!row) return res.status(404).json({ error: 'Nie znaleziono' });
  if (!canView(req.user, row)) return res.status(403).json({ error: 'Brak dostępu' });
  const reviewer = isKierownik(req.user) || isDyrektor(req.user);
  if (!canEditDraft(req.user, row) && !reviewer) {
    return res.status(403).json({ error: 'Brak uprawnień do dodawania zdjęć' });
  }
  const b = req.body;
  const ts = b.photo_timestamp || new Date().toISOString();
  const autorTyp =
    b.autor_typ || (isWyceniajacy(req.user) ? 'Wyceniający' : reviewer ? 'Recenzent' : 'Brygadzista');
  const kind = b.photo_kind || 'general';
  const { rows } = await pool.query(
    `INSERT INTO annotated_photos (
      parent_object_type, parent_object_id, original_url, annotated_preview_url, rendered_png_url, annotations_json,
      lat, lng, photo_timestamp, autor_user_id, autor_typ, photo_kind
    ) VALUES ('quotation', $1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11) RETURNING *`,
    [
      req.params.id,
      b.original_url,
      b.annotated_preview_url || null,
      b.rendered_png_url || null,
      JSON.stringify(b.annotations_json || {}),
      b.lat ?? null,
      b.lng ?? null,
      ts,
      req.user.id,
      autorTyp,
      kind,
    ]
  );
  res.status(201).json(rows[0]);
});

router.post('/:id/zdjecia', validateParams(idParam), qHeadPhotoUpload.single('zdjecie'), async (req, res) => {
  try {
    const row = await fetchQuotation(req.params.id);
    if (!row) return res.status(404).json({ error: 'Nie znaleziono' });
    if (!canView(req.user, row)) return res.status(403).json({ error: 'Brak dostępu' });
    const reviewer = isKierownik(req.user) || isDyrektor(req.user);
    if (!canEditDraft(req.user, row) && !reviewer) {
      return res.status(403).json({ error: 'Brak uprawnień do dodawania zdjęć' });
    }
    if (!req.file) return res.status(400).json({ error: 'Brak pliku (pole zdjecie)' });
    const rel = `/uploads/quotations/head/${req.file.filename}`;
    const kind = req.body.photo_kind === 'annotated' ? 'annotated' : 'general';
    const ts = new Date().toISOString();
    const autorTyp =
      req.body.autor_typ || (isWyceniajacy(req.user) ? 'Wyceniający' : reviewer ? 'Recenzent' : 'Brygadzista');
    const { rows } = await pool.query(
      `INSERT INTO annotated_photos (
      parent_object_type, parent_object_id, original_url, annotated_preview_url, rendered_png_url, annotations_json,
      lat, lng, photo_timestamp, autor_user_id, autor_typ, photo_kind
    ) VALUES ('quotation', $1, $2, NULL, NULL, '{}'::jsonb, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        req.params.id,
        rel,
        toFloatBody(req.body.lat),
        toFloatBody(req.body.lng),
        ts,
        req.user.id,
        autorTyp,
        kind,
      ]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    logger.error('quotations.zdjecia', { message: err.message });
    res.status(500).json({ error: err.message || 'Błąd uploadu' });
  }
});

router.post('/:id/recalculate-pricing', validateParams(idParam), async (req, res) => {
  const row = await fetchQuotation(req.params.id);
  if (!row) return res.status(404).json({ error: 'Nie znaleziono' });
  if (!canView(req.user, row)) return res.status(403).json({ error: 'Brak dostępu' });
  if (!canEditDraft(req.user, row) && !isKierownik(req.user) && !isDyrektor(req.user)) {
    return res.status(403).json({ error: 'Brak uprawnień' });
  }
  try {
    const out = await recalculateQuotation(pool, req.params.id);
    res.json(out);
  } catch (e) {
    logger.error('quotations.recalculate', { message: e.message });
    res.status(500).json({ error: 'Błąd przeliczenia' });
  }
});

module.exports = router;
