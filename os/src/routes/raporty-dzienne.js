const express = require('express');
const pool = require('../config/database');
const logger = require('../config/logger');
const { authMiddleware } = require('../middleware/auth');
const { env } = require('../config/env');
const nodemailer = require('nodemailer');
const { logAudit } = require('../services/audit');
const { dispatchWebhook } = require('../services/webhook');
const { validateQuery, validateBody, validateParams } = require('../middleware/validate');
const { z } = require('zod');

const router = express.Router();

const dailyReportIdParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const dailyReportUserIdParamsSchema = z.object({
  userId: z.coerce.number().int().positive(),
});

const raportyListQuerySchema = z.object({
  data: z.string().max(20).optional(),
  user_id: z.coerce.number().int().positive().optional(),
  status: z.string().max(50).optional(),
  from_date: z.string().max(20).optional(),
  to_date: z.string().max(20).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const raportyUserListQuerySchema = z.object({
  from_date: z.string().max(20).optional(),
  to_date: z.string().max(20).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const dailyReportUpsertSchema = z.object({
  data_raportu: z.string().trim().min(1, 'Data raportu jest wymagana'),
  opis_pracy: z.string().optional().nullable(),
  podpis_url: z.string().optional().nullable(),
  zadania: z
    .array(
      z.object({
        task_id: z.coerce.number().int(),
        czas_minuty: z.coerce.number().int().min(0).optional(),
        uwagi: z.string().optional().nullable(),
      })
    )
    .optional(),
  materialy: z
    .array(
      z.object({
        nazwa: z.string().min(1),
        ilosc: z.coerce.number().optional(),
        jednostka: z.string().max(20).optional(),
        koszt_jednostkowy: z.coerce.number().optional(),
      })
    )
    .optional(),
});

const isDyrektor = (user) => user.rola === 'Dyrektor' || user.rola === 'Administrator';
const isKierownik = (user) => user.rola === 'Kierownik';

// ============================================
// FUNKCJE POMOCNICZE
// ============================================

const ensureTablesExist = async () => {
  // Tabela daily_reports
  await pool.query(`
    CREATE TABLE IF NOT EXISTS daily_reports (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      oddzial_id INTEGER REFERENCES branches(id),
      data_raportu DATE NOT NULL,
      czas_pracy_minuty INTEGER DEFAULT 0,
      opis_pracy TEXT,
      podpis_url TEXT,
      status VARCHAR(50) DEFAULT 'Roboczy',
      wyslany_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(user_id, data_raportu)
    )
  `);

  // Tabela daily_report_tasks
  await pool.query(`
    CREATE TABLE IF NOT EXISTS daily_report_tasks (
      id SERIAL PRIMARY KEY,
      report_id INTEGER REFERENCES daily_reports(id) ON DELETE CASCADE,
      task_id INTEGER REFERENCES tasks(id),
      czas_minuty INTEGER DEFAULT 0,
      uwagi TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // Tabela daily_report_materials
  await pool.query(`
    CREATE TABLE IF NOT EXISTS daily_report_materials (
      id SERIAL PRIMARY KEY,
      report_id INTEGER REFERENCES daily_reports(id) ON DELETE CASCADE,
      nazwa VARCHAR(200) NOT NULL,
      ilosc DECIMAL(10,2) DEFAULT 1,
      jednostka VARCHAR(20) DEFAULT 'szt',
      koszt_jednostkowy DECIMAL(10,2) DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // Indeksy
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_daily_reports_user ON daily_reports(user_id);
    CREATE INDEX IF NOT EXISTS idx_daily_reports_data ON daily_reports(data_raportu);
    CREATE INDEX IF NOT EXISTS idx_daily_reports_status ON daily_reports(status);
    CREATE INDEX IF NOT EXISTS idx_daily_report_tasks_report ON daily_report_tasks(report_id);
    CREATE INDEX IF NOT EXISTS idx_daily_report_materials_report ON daily_report_materials(report_id);
  `);
};

const formatMinutes = (minutes) => {
  if (!minutes) return '0h 0min';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}min`;
};

// ============================================
// POBIERZ RAPORTY
// ============================================

// GET /api/raporty-dzienne — lista raportów
router.get('/', authMiddleware, validateQuery(raportyListQuerySchema), async (req, res) => {
  try {
    await ensureTablesExist();

    const { data, user_id, status, from_date, to_date, limit, offset } = req.query;
    let where = 'WHERE 1=1';
    let params = [];
    let idx = 1;

    if (req.user.rola === 'Brygadzista') {
      where += ` AND r.user_id = $${idx++}`;
      params.push(req.user.id);
    } else if (isKierownik(req.user)) {
      where += ` AND r.oddzial_id = $${idx++}`;
      params.push(req.user.oddzial_id);
    } else if (!isDyrektor(req.user)) {
      where += ` AND r.oddzial_id = $${idx++}`;
      params.push(req.user.oddzial_id);
    }

    if (data) {
      where += ` AND r.data_raportu = $${idx++}`;
      params.push(data);
    }

    if (from_date) {
      where += ` AND r.data_raportu >= $${idx++}`;
      params.push(from_date);
    }

    if (to_date) {
      where += ` AND r.data_raportu <= $${idx++}`;
      params.push(to_date);
    }

    if (status) {
      where += ` AND r.status = $${idx++}`;
      params.push(status);
    }

    if (user_id != null && isDyrektor(req.user)) {
      where += ` AND r.user_id = $${idx++}`;
      params.push(user_id);
    }

    const joinFrom = `
       FROM daily_reports r
       LEFT JOIN users u ON r.user_id = u.id
       LEFT JOIN branches b ON r.oddzial_id = b.id
       ${where}`;
    const selectList = `SELECT r.*,
        u.imie || ' ' || u.nazwisko as pracownik_nazwa,
        b.nazwa as oddzial_nazwa ${joinFrom}`;

    if (limit != null) {
      const lim = Number(limit);
      const off = Number(offset ?? 0);
      const countR = await pool.query(`SELECT COUNT(*)::int AS c ${joinFrom}`, params);
      const total = countR.rows[0]?.c ?? 0;
      const limIdx = params.length + 1;
      const offIdx = params.length + 2;
      const result = await pool.query(
        `${selectList} ORDER BY r.data_raportu DESC, r.created_at DESC LIMIT $${limIdx} OFFSET $${offIdx}`,
        [...params, lim, off]
      );
      return res.json({ items: result.rows, total, limit: lim, offset: off });
    }

    const result = await pool.query(
      `${selectList} ORDER BY r.data_raportu DESC, r.created_at DESC`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    logger.error('Blad pobierania raportow dziennych', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

// GET /api/raporty-dzienne/user/:userId — raporty użytkownika (Dyrektor / Administrator)
router.get('/user/:userId', authMiddleware, validateParams(dailyReportUserIdParamsSchema), validateQuery(raportyUserListQuerySchema), async (req, res) => {
  try {
    if (!isDyrektor(req.user)) {
      return res.status(403).json({ error: req.t('errors.auth.forbidden') });
    }

    await ensureTablesExist();

    const { userId } = req.params;
    const { from_date, to_date, limit, offset } = req.query;

    let where = 'WHERE r.user_id = $1';
    let params = [userId];
    let idx = 2;

    if (from_date) {
      where += ` AND r.data_raportu >= $${idx++}`;
      params.push(from_date);
    }

    if (to_date) {
      where += ` AND r.data_raportu <= $${idx++}`;
      params.push(to_date);
    }

    const joinFrom = `
      FROM daily_reports r
      LEFT JOIN users u ON r.user_id = u.id
      ${where}`;
    const selectList = `SELECT r.*,
        u.imie || ' ' || u.nazwisko as pracownik_nazwa ${joinFrom}`;

    if (limit != null) {
      const lim = Number(limit);
      const off = Number(offset ?? 0);
      const countR = await pool.query(`SELECT COUNT(*)::int AS c ${joinFrom}`, params);
      const total = countR.rows[0]?.c ?? 0;
      const limIdx = params.length + 1;
      const offIdx = params.length + 2;
      const result = await pool.query(
        `${selectList} ORDER BY r.data_raportu DESC LIMIT $${limIdx} OFFSET $${offIdx}`,
        [...params, lim, off]
      );
      return res.json({ items: result.rows, total, limit: lim, offset: off });
    }

    const result = await pool.query(`${selectList} ORDER BY r.data_raportu DESC`, params);
    res.json(result.rows);
  } catch (err) {
    logger.error('Blad pobierania raportow uzytkownika', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

// GET /api/raporty-dzienne/:id — szczegóły raportu
router.get('/:id', authMiddleware, validateParams(dailyReportIdParamsSchema), async (req, res) => {
  try {
    await ensureTablesExist();
    
    const { id } = req.params;
    
    const result = await pool.query(
      `SELECT r.*,
        u.imie || ' ' || u.nazwisko as pracownik_nazwa,
        u.telefon as pracownik_telefon,
        b.nazwa as oddzial_nazwa
       FROM daily_reports r
       LEFT JOIN users u ON r.user_id = u.id
       LEFT JOIN branches b ON r.oddzial_id = b.id
       WHERE r.id = $1`,
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: req.t('errors.raportyDaily.reportNotFound') });
    }
    
    const raport = result.rows[0];
    
    if (req.user.rola === 'Brygadzista' && raport.user_id !== req.user.id) {
      return res.status(403).json({ error: req.t('errors.raportyDaily.reportAccessDenied') });
    }
    if (isKierownik(req.user) && raport.oddzial_id !== req.user.oddzial_id) {
      return res.status(403).json({ error: req.t('errors.raportyDaily.reportAccessDenied') });
    }

    const zadania = await pool.query(
      `SELECT rt.*, t.klient_nazwa, t.adres, t.typ_uslugi, t.status as task_status
       FROM daily_report_tasks rt
       LEFT JOIN tasks t ON rt.task_id = t.id
       WHERE rt.report_id = $1
       ORDER BY rt.id`,
      [id]
    );

    const materialy = await pool.query(
      'SELECT * FROM daily_report_materials WHERE report_id = $1 ORDER BY id',
      [id]
    );

    res.json({
      ...raport,
      czas_pracy_human: formatMinutes(raport.czas_pracy_minuty),
      zadania: zadania.rows,
      materialy: materialy.rows
    });
  } catch (err) {
    logger.error('Blad pobierania szczegolow raportu dziennego', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

// POST /api/raporty-dzienne — utwórz lub zaktualizuj raport
router.post('/', authMiddleware, validateBody(dailyReportUpsertSchema), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await ensureTablesExist();

    const { data_raportu, opis_pracy, zadania, materialy, podpis_url } = req.body;

    const existing = await client.query(
      'SELECT id, status FROM daily_reports WHERE user_id = $1 AND data_raportu = $2',
      [req.user.id, data_raportu]
    );

    let reportId;

    if (existing.rows.length > 0) {
      reportId = existing.rows[0].id;
      if (existing.rows[0].status === 'Wyslany') {
        return res.status(400).json({ error: req.t('errors.raportyDaily.cannotEditSent') });
      }
      
      await client.query(
        `UPDATE daily_reports 
         SET opis_pracy = $1, podpis_url = $2, status = 'Roboczy', updated_at = NOW()
         WHERE id = $3`,
        [opis_pracy || null, podpis_url || null, reportId]
      );
      await client.query('DELETE FROM daily_report_tasks WHERE report_id = $1', [reportId]);
      await client.query('DELETE FROM daily_report_materials WHERE report_id = $1', [reportId]);
    } else {
      const result = await client.query(
        `INSERT INTO daily_reports (user_id, oddzial_id, data_raportu, opis_pracy, podpis_url, status, created_at)
         VALUES ($1, $2, $3, $4, $5, 'Roboczy', NOW()) 
         RETURNING id`,
        [req.user.id, req.user.oddzial_id, data_raportu, opis_pracy || null, podpis_url || null]
      );
      reportId = result.rows[0].id;
    }

    let lacznyczas = 0;
    if (zadania && zadania.length > 0) {
      for (const z of zadania) {
        await client.query(
          `INSERT INTO daily_report_tasks (report_id, task_id, czas_minuty, uwagi)
           VALUES ($1, $2, $3, $4)`,
          [reportId, z.task_id, z.czas_minuty || 0, z.uwagi || null]
        );
        lacznyczas += parseInt(z.czas_minuty) || 0;
      }
    }

    if (materialy && materialy.length > 0) {
      for (const m of materialy) {
        await client.query(
          `INSERT INTO daily_report_materials (report_id, nazwa, ilosc, jednostka, koszt_jednostkowy)
           VALUES ($1, $2, $3, $4, $5)`,
          [reportId, m.nazwa, m.ilosc || 1, m.jednostka || 'szt', m.koszt_jednostkowy || 0]
        );
      }
    }

    await client.query(
      'UPDATE daily_reports SET czas_pracy_minuty = $1, updated_at = NOW() WHERE id = $2',
      [lacznyczas, reportId]
    );

    await client.query('COMMIT');
    res.json({ success: true, id: reportId, message: 'Raport zapisany' });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('Blad zapisu raportu dziennego', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// POST /api/raporty-dzienne/:id/wyslij — wyślij raport e-mailem
router.post('/:id/wyslij', authMiddleware, validateParams(dailyReportIdParamsSchema), async (req, res) => {
  try {
    await ensureTablesExist();
    
    const { id } = req.params;
    
    const raportRes = await pool.query(
      `SELECT r.*,
        u.imie || ' ' || u.nazwisko as pracownik_nazwa,
        u.email as pracownik_email,
        b.nazwa as oddzial_nazwa,
        b.email as oddzial_email
       FROM daily_reports r
       LEFT JOIN users u ON r.user_id = u.id
       LEFT JOIN branches b ON r.oddzial_id = b.id
       WHERE r.id = $1`,
      [id]
    );

    if (raportRes.rows.length === 0) {
      return res.status(404).json({ error: req.t('errors.raportyDaily.reportNotFound') });
    }
    
    const raport = raportRes.rows[0];
    
    if (req.user.rola === 'Brygadzista' && raport.user_id !== req.user.id) {
      return res.status(403).json({ error: req.t('errors.raportyDaily.reportAccessDenied') });
    }

    const zadania = await pool.query(
      `SELECT rt.*, t.klient_nazwa, t.adres, t.typ_uslugi, t.status as task_status
       FROM daily_report_tasks rt
       LEFT JOIN tasks t ON rt.task_id = t.id
       WHERE rt.report_id = $1
       ORDER BY rt.id`,
      [id]
    );

    const materialy = await pool.query(
      'SELECT * FROM daily_report_materials WHERE report_id = $1 ORDER BY id',
      [id]
    );

    const odbiorcy = await pool.query(
      `SELECT email, imie, nazwisko, rola FROM users
       WHERE (oddzial_id = $1 OR rola IN ('Dyrektor', 'Administrator'))
       AND rola IN ('Kierownik', 'Dyrektor', 'Administrator')
       AND aktywny = true AND email IS NOT NULL AND email != ''`,
      [raport.oddzial_id]
    );

    if (odbiorcy.rows.length === 0) {
      return res.status(400).json({ error: req.t('errors.raportyDaily.noRecipientEmails') });
    }

    const zadaniaHtml = zadania.rows.map(z => `
      <tr>
        <td style="padding:8px;border:1px solid #e5e7eb">${z.klient_nazwa || '-'}</td>
        <td style="padding:8px;border:1px solid #e5e7eb">${z.adres || '-'}</td>
        <td style="padding:8px;border:1px solid #e5e7eb">${z.typ_uslugi || '-'}</td>
        <td style="padding:8px;border:1px solid #e5e7eb">${formatMinutes(z.czas_minuty || 0)}</td>
        <td style="padding:8px;border:1px solid #e5e7eb">${z.uwagi || '-'}</td>
      </tr>
    `).join('');

    const materialyHtml = materialy.rows.length > 0 
      ? materialy.rows.map(m => `
        <tr>
          <td style="padding:8px;border:1px solid #e5e7eb">${m.nazwa}</td>
          <td style="padding:8px;border:1px solid #e5e7eb">${m.ilosc} ${m.jednostka}</td>
          <td style="padding:8px;border:1px solid #e5e7eb">${m.koszt_jednostkowy > 0 ? m.koszt_jednostkowy.toFixed(2) + ' PLN' : '-'}</td>
        </tr>
      `).join('') 
      : '<tr><td colspan="3" style="padding:8px;text-align:center;color:#9ca3af">Brak zuzytych materialow</td></tr>';

    const html = `
      <!DOCTYPE html>
      <html>
      <head><meta charset="UTF-8"><title>Raport dzienny ARBOR-OS</title></head>
      <body style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto">
        <div style="background:#111111;color:#f4f4f5;padding:20px;border-radius:8px 8px 0 0">
          <h2 style="margin:0">ARBOR-OS - Raport dzienny</h2>
          <p style="margin:8px 0 0 0;opacity:0.8">${raport.oddzial_nazwa}</p>
        </div>
        <div style="background:#fff;padding:24px;border:1px solid #e5e7eb">
          <div style="display:flex;gap:24px;margin-bottom:20px;flex-wrap:wrap">
            <div>
              <div style="font-size:12px;color:#9ca3af">Brygadzista</div>
              <div style="font-weight:bold;font-size:16px">${raport.pracownik_nazwa}</div>
            </div>
            <div>
              <div style="font-size:12px;color:#9ca3af">Data</div>
              <div style="font-weight:bold;font-size:16px">${raport.data_raportu}</div>
            </div>
            <div>
              <div style="font-size:12px;color:#9ca3af">Laczny czas pracy</div>
              <div style="font-weight:bold;font-size:16px;color:#111111">${formatMinutes(raport.czas_pracy_minuty || 0)}</div>
            </div>
          </div>
          <h3 style="color:#1F2937;border-bottom:2px solid #f3f4f6;padding-bottom:8px">Wykonane zlecenia</h3>
          <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
            <thead>
              <tr style="background:#f9fafb">
                <th style="padding:8px;border:1px solid #e5e7eb;text-align:left">Klient</th>
                <th style="padding:8px;border:1px solid #e5e7eb;text-align:left">Adres</th>
                <th style="padding:8px;border:1px solid #e5e7eb;text-align:left">Typ</th>
                <th style="padding:8px;border:1px solid #e5e7eb;text-align:left">Czas</th>
                <th style="padding:8px;border:1px solid #e5e7eb;text-align:left">Uwagi</th>
              </tr>
            </thead>
            <tbody>${zadaniaHtml || '<tr><td colspan="5" style="padding:8px;text-align:center;color:#9ca3af">Brak zlecen</td></tr>'}</tbody>
          </table>
          <h3 style="color:#1F2937;border-bottom:2px solid #f3f4f6;padding-bottom:8px">Zuyte materialy</h3>
          <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
            <thead>
              <tr style="background:#f9fafb">
                <th style="padding:8px;border:1px solid #e5e7eb;text-align:left">Material</th>
                <th style="padding:8px;border:1px solid #e5e7eb;text-align:left">Ilosc</th>
                <th style="padding:8px;border:1px solid #e5e7eb;text-align:left">Koszt</th>
              </tr>
            </thead>
            <tbody>${materialyHtml}</tbody>
          </table>
          ${raport.opis_pracy ? `<h3 style="color:#1F2937">Opis pracy</h3><p style="color:#374151;background:#f9fafb;padding:12px;border-radius:8px">${raport.opis_pracy.replace(/\n/g, '<br>')}</p>` : ''}
          ${raport.podpis_url ? `<h3 style="color:#1F2937">Podpis brygadzisty</h3><img src="${raport.podpis_url}" style="border:1px solid #e5e7eb;border-radius:8px;max-width:300px" />` : ''}
        </div>
        <div style="background:#f9fafb;padding:12px;border-radius:0 0 8px 8px;border:1px solid #e5e7eb;border-top:none;text-align:center;color:#9ca3af;font-size:12px">
          Wygenerowano automatycznie przez ARBOR-OS ${new Date().toLocaleString('pl-PL')}
        </div>
      </body>
      </html>
    `;

    const transporter = nodemailer.createTransport({
      host: env.SMTP_HOST || 'smtp.gmail.com',
      port: env.SMTP_PORT,
      secure: false,
      auth: {
        user: env.SMTP_USER,
        pass: env.SMTP_PASS,
      },
    });

    const emailOdbiorcy = odbiorcy.rows.map(o => o.email).filter(Boolean);

    await transporter.sendMail({
      from: `"ARBOR-OS" <${env.SMTP_USER}>`,
      to: emailOdbiorcy.join(', '),
      subject: `Raport dzienny - ${raport.pracownik_nazwa} - ${raport.data_raportu}`,
      html,
    });

    await pool.query(
      `UPDATE daily_reports 
       SET status = 'Wyslany', wyslany_at = NOW(), updated_at = NOW() 
       WHERE id = $1`,
      [id]
    );

    await logAudit(pool, req, {
      action: 'daily_report_sent',
      entityType: 'daily_report',
      entityId: id,
      metadata: { odbiorcow: emailOdbiorcy.length, data_raportu: raport.data_raportu },
    });
    void dispatchWebhook('daily_report.sent', {
      reportId: Number(id),
      userId: raport.user_id,
      oddzialId: raport.oddzial_id,
      dataRaportu: raport.data_raportu,
    });

    res.json({ 
      success: true, 
      message: 'Raport wyslany', 
      odbiorcy: emailOdbiorcy,
      count: emailOdbiorcy.length
    });
  } catch (err) {
    logger.error('Blad wysylania raportu dziennego', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/raporty-dzienne/:id — usuń raport (tylko roboczy)
router.delete('/:id', authMiddleware, validateParams(dailyReportIdParamsSchema), async (req, res) => {
  try {
    await ensureTablesExist();
    
    const { id } = req.params;
    
    const check = await pool.query(
      'SELECT user_id, status FROM daily_reports WHERE id = $1',
      [id]
    );
    
    if (check.rows.length === 0) {
      return res.status(404).json({ error: req.t('errors.raportyDaily.reportNotFound') });
    }
    
    const raport = check.rows[0];
    
    if (raport.status === 'Wyslany') {
      return res.status(400).json({ error: req.t('errors.raportyDaily.cannotDeleteSent') });
    }
    
    if (req.user.rola === 'Brygadzista' && raport.user_id !== req.user.id) {
      return res.status(403).json({ error: req.t('errors.auth.forbidden') });
    }
    
    await pool.query('DELETE FROM daily_reports WHERE id = $1', [id]);
    res.json({ success: true, message: 'Raport usuniety' });
  } catch (err) {
    logger.error('Blad usuwania raportu dziennego', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

module.exports = router;
