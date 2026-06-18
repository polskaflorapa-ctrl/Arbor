const express = require('express');
const { z } = require('zod');
const pool = require('../config/database');
const logger = require('../config/logger');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { validateBody, validateParams, validateQuery } = require('../middleware/validate');

const router = express.Router();
const DEMO_REQUEST_SELECT = 'id, name, email, company, phone, message, source, status, sales_note, client_id, crm_lead_id, converted_at, created_at';

const demoRequestSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(180),
  company: z.string().trim().min(2).max(160),
  phone: z.string().trim().max(60).optional().default(''),
  message: z.string().trim().max(1200).optional().default(''),
  source: z.string().trim().max(80).optional().default('landing-page'),
});

const demoRequestListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

const demoRequestIdParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const demoRequestUpdateSchema = z.object({
  status: z.enum(['new', 'contacted', 'qualified', 'closed']).optional(),
  sales_note: z.string().trim().max(2000).optional(),
}).refine((payload) => payload.status != null || payload.sales_note != null, {
  message: 'Podaj status lub notatke',
});

async function ensureDemoRequestsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS demo_requests (
      id          SERIAL PRIMARY KEY,
      name        TEXT NOT NULL,
      email       TEXT NOT NULL,
      company     TEXT NOT NULL,
      phone       TEXT NOT NULL DEFAULT '',
      message     TEXT NOT NULL DEFAULT '',
      source      TEXT NOT NULL DEFAULT 'landing-page',
      user_agent  TEXT NOT NULL DEFAULT '',
      ip_hash     TEXT NOT NULL DEFAULT '',
      status      TEXT NOT NULL DEFAULT 'new',
      sales_note  TEXT NOT NULL DEFAULT '',
      client_id   INTEGER,
      crm_lead_id INTEGER,
      converted_at TIMESTAMPTZ,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query("ALTER TABLE demo_requests ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'new'");
  await pool.query("ALTER TABLE demo_requests ADD COLUMN IF NOT EXISTS sales_note TEXT NOT NULL DEFAULT ''");
  await pool.query('ALTER TABLE demo_requests ADD COLUMN IF NOT EXISTS client_id INTEGER');
  await pool.query('ALTER TABLE demo_requests ADD COLUMN IF NOT EXISTS crm_lead_id INTEGER');
  await pool.query('ALTER TABLE demo_requests ADD COLUMN IF NOT EXISTS converted_at TIMESTAMPTZ');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_demo_requests_created_at ON demo_requests(created_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_demo_requests_status ON demo_requests(status)');
}

function getIpHash(req) {
  const value = String(req.ip || req.headers['x-forwarded-for'] || '').slice(0, 160);
  if (!value) return '';
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash) + value.charCodeAt(index);
    hash |= 0;
  }
  return String(hash);
}

async function notifyWebhook(payload) {
  const webhookUrl = process.env.DEMO_REQUEST_WEBHOOK_URL;
  if (!webhookUrl || typeof fetch !== 'function') return { sent: false };

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Webhook returned ${response.status}`);
  }

  return { sent: true };
}

function boolEnv(value) {
  return ['1', 'true', 'on', 'yes'].includes(String(value || '').trim().toLowerCase());
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function buildTelegramMessage(payload) {
  const lines = [
    '<b>Nowe zgloszenie demo Arbor OS</b>',
    `<b>Firma:</b> ${escapeHtml(payload.company)}`,
    `<b>Kontakt:</b> ${escapeHtml(payload.name)} (${escapeHtml(payload.email)})`,
  ];

  if (payload.phone) lines.push(`<b>Telefon:</b> ${escapeHtml(payload.phone)}`);
  if (payload.message) lines.push('', `<b>Procesy:</b> ${escapeHtml(payload.message)}`);
  lines.push('', `<b>Zrodlo:</b> ${escapeHtml(payload.source || 'landing-page')}`);
  return lines.join('\n');
}

async function notifyTelegram(payload) {
  if (!boolEnv(process.env.DEMO_REQUEST_TELEGRAM_ENABLED)) return { sent: false };
  if (typeof fetch !== 'function') return { sent: false };

  const token = process.env.DEMO_REQUEST_TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.DEMO_REQUEST_TELEGRAM_CHAT_ID || process.env.TELEGRAM_CHAT_ID;
  const parseMode = process.env.DEMO_REQUEST_TELEGRAM_PARSE_MODE || process.env.TELEGRAM_PARSE_MODE || 'HTML';
  if (!token || !chatId) return { sent: false };

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: buildTelegramMessage(payload),
      parse_mode: parseMode,
      disable_web_page_preview: true,
    }),
  });

  if (!response.ok) {
    throw new Error(`Telegram returned ${response.status}`);
  }

  return { sent: true };
}

function splitContactName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) {
    return { imie: parts[0] || 'Kontakt', nazwisko: '' };
  }

  return {
    imie: parts[0],
    nazwisko: parts.slice(1).join(' '),
  };
}

function normalizePhoneDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function buildClientNote(item) {
  const lines = [
    'Klient utworzony ze zgloszenia demo na landing page.',
    item.message ? `Procesy: ${item.message}` : null,
    item.sales_note ? `Notatka sprzedazowa: ${item.sales_note}` : null,
  ].filter(Boolean);

  return lines.join('\n\n');
}

function buildDemoLeadTitle(item) {
  const company = String(item.company || '').trim();
  const name = String(item.name || '').trim();
  return `Demo: ${company || name || `zgloszenie #${item.id}`}`.slice(0, 180);
}

function buildDemoLeadNotes(item) {
  const lines = [
    `Zgloszenie demo #${item.id} z landing page.`,
    item.message ? `Procesy: ${item.message}` : null,
    item.sales_note ? `Notatka sprzedazowa: ${item.sales_note}` : null,
    `Kontakt: ${[item.name, item.email, item.phone].filter(Boolean).join(' | ')}`,
  ].filter(Boolean);

  return lines.join('\n\n');
}

function nextDemoFollowUpAt() {
  const date = new Date();
  date.setHours(date.getHours() + 2);
  return date.toISOString();
}

async function resolveDemoLeadOddzialId(user) {
  const userOddzialId = Number(user?.oddzial_id);
  if (Number.isFinite(userOddzialId) && userOddzialId > 0) return Math.trunc(userOddzialId);

  const branchResult = await pool.query('SELECT id FROM branches ORDER BY id ASC LIMIT 1');
  const branchId = Number(branchResult.rows?.[0]?.id);
  return Number.isFinite(branchId) && branchId > 0 ? Math.trunc(branchId) : null;
}

async function ensureDemoCrmLead(item, clientId, user) {
  if (!clientId) return null;

  try {
    const existing = await pool.query(
      `SELECT id
       FROM crm_leads
       WHERE client_id = $1
         AND source = 'landing-demo'
         AND stage NOT IN ('Wygrane', 'Przegrane', 'Techniczny')
       ORDER BY COALESCE(next_action_at, NOW() + INTERVAL '30 days') ASC, updated_at DESC NULLS LAST, id DESC
       LIMIT 1`,
      [clientId]
    );

    if (existing.rows?.[0]?.id) {
      return { id: existing.rows[0].id, reused: true };
    }

    const oddzialId = await resolveDemoLeadOddzialId(user);
    if (!oddzialId) return null;

    const now = new Date().toISOString();
    const leadResult = await pool.query(
      `INSERT INTO crm_leads (
        title, oddzial_id, client_id, owner_user_id, stage, source, value, phone, email, notes, tags, next_action_at,
        close_reason, close_bucket, closed_at, closed_by, created_by, created_at, updated_by, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15,$16,$17,$18,$19,$20)
      RETURNING id`,
      [
        buildDemoLeadTitle(item),
        oddzialId,
        clientId,
        user?.id || null,
        'Lead',
        'landing-demo',
        0,
        item.phone || null,
        item.email || null,
        buildDemoLeadNotes(item),
        JSON.stringify(['landing-demo', 'demo']),
        nextDemoFollowUpAt(),
        null,
        null,
        null,
        null,
        user?.id || null,
        now,
        user?.id || null,
        now,
      ]
    );

    return { id: leadResult.rows?.[0]?.id || null, reused: false };
  } catch (error) {
    logger.warn('demoRequests.crmLead.ensure', { message: error.message, demoRequestId: item.id, clientId });
    return null;
  }
}

router.get(
  '/',
  authMiddleware,
  requireRole('Prezes', 'Dyrektor', 'Administrator'),
  validateQuery(demoRequestListQuerySchema),
  async (req, res, next) => {
    try {
      const query = req.query;
      await ensureDemoRequestsTable();

      const [countResult, listResult] = await Promise.all([
        pool.query('SELECT COUNT(*)::int AS total FROM demo_requests'),
        pool.query(
          `SELECT ${DEMO_REQUEST_SELECT}
           FROM demo_requests
           ORDER BY created_at DESC
           LIMIT $1 OFFSET $2`,
          [query.limit, query.offset]
        ),
      ]);

      res.json({
        items: listResult.rows,
        total: Number(countResult.rows?.[0]?.total || 0),
        limit: query.limit,
        offset: query.offset,
      });
    } catch (error) {
      next(error);
    }
  }
);

router.patch(
  '/:id',
  authMiddleware,
  requireRole('Prezes', 'Dyrektor', 'Administrator'),
  validateParams(demoRequestIdParamsSchema),
  validateBody(demoRequestUpdateSchema),
  async (req, res, next) => {
    try {
      const params = req.params;
      await ensureDemoRequestsTable();

      const current = await pool.query('SELECT id FROM demo_requests WHERE id = $1', [params.id]);
      if (current.rowCount === 0) {
        return res.status(404).json({ error: 'Nie znaleziono zgloszenia demo.', requestId: req.requestId });
      }

      const result = await pool.query(
        `UPDATE demo_requests
         SET status = COALESCE($2, status),
             sales_note = COALESCE($3, sales_note)
         WHERE id = $1
         RETURNING ${DEMO_REQUEST_SELECT}`,
        [params.id, req.body.status ?? null, req.body.sales_note ?? null]
      );

      return res.json({ ok: true, item: result.rows[0], requestId: req.requestId });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  '/:id/convert-client',
  authMiddleware,
  requireRole('Prezes', 'Dyrektor', 'Administrator'),
  validateParams(demoRequestIdParamsSchema),
  async (req, res, next) => {
    try {
      const params = req.params;
      await ensureDemoRequestsTable();

      const current = await pool.query(
        `SELECT ${DEMO_REQUEST_SELECT} FROM demo_requests WHERE id = $1`,
        [params.id]
      );
      const item = current.rows[0];
      if (!item) {
        return res.status(404).json({ error: 'Nie znaleziono zgloszenia demo.', requestId: req.requestId });
      }

      if (item.client_id) {
        const crmLead = item.crm_lead_id ? { id: item.crm_lead_id, reused: true } : await ensureDemoCrmLead(item, item.client_id, req.user);
        const responseItem = crmLead?.id && crmLead.id !== item.crm_lead_id
          ? (await pool.query(
            `UPDATE demo_requests SET crm_lead_id = $2 WHERE id = $1 RETURNING ${DEMO_REQUEST_SELECT}`,
            [params.id, crmLead.id]
          )).rows[0]
          : item;
        return res.json({
          ok: true,
          alreadyConverted: true,
          client_id: item.client_id,
          crm_lead_id: crmLead?.id || null,
          reusedCrmLead: crmLead?.reused || false,
          item: responseItem,
          requestId: req.requestId,
        });
      }

      const { imie, nazwisko } = splitContactName(item.name);
      const email = String(item.email || '').trim();
      const phoneDigits = normalizePhoneDigits(item.phone);
      const existingClient = await pool.query(
        `SELECT id
         FROM klienci
         WHERE ($1 <> '' AND LOWER(email) = LOWER($1))
            OR ($2 <> '' AND regexp_replace(COALESCE(telefon, ''), '\\D', '', 'g') = $2)
         ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
         LIMIT 1`,
        [email, phoneDigits]
      );

      if (existingClient.rows?.[0]?.id) {
        const clientId = existingClient.rows[0].id;
        await pool.query(
          `UPDATE klienci
           SET tags = (
                 SELECT COALESCE(jsonb_agg(DISTINCT tag_value), '[]'::jsonb)
                 FROM jsonb_array_elements_text(COALESCE(tags, '[]'::jsonb) || $2::jsonb) AS tag_value
               ),
               custom_fields = COALESCE(custom_fields, '{}'::jsonb) || $3::jsonb,
               updated_at = NOW()
           WHERE id = $1`,
          [
            clientId,
            JSON.stringify(['landing-demo', 'demo']),
            JSON.stringify({
              demo_request_id: item.id,
              demo_source: item.source || 'landing-page',
              last_demo_request_at: item.created_at || new Date().toISOString(),
            }),
          ]
        );
        const crmLead = await ensureDemoCrmLead(item, clientId, req.user);
        const updated = await pool.query(
          `UPDATE demo_requests
           SET client_id = $2,
               crm_lead_id = $3,
               converted_at = NOW(),
               status = CASE WHEN status = 'closed' THEN status ELSE 'qualified' END
           WHERE id = $1
           RETURNING ${DEMO_REQUEST_SELECT}`,
          [params.id, clientId, crmLead?.id || null]
        );
        const crmLeadId = updated.rows[0]?.crm_lead_id || null;

        return res.json({
          ok: true,
          reusedClient: true,
          client_id: clientId,
          crm_lead_id: crmLeadId,
          reusedCrmLead: crmLead?.reused || false,
          item: updated.rows[0],
          requestId: req.requestId,
        });
      }

      const clientResult = await pool.query(
        `INSERT INTO klienci (imie, nazwisko, firma, telefon, email, notatki, zrodlo, segment, tags, custom_fields, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11)
         RETURNING id`,
        [
          imie,
          nazwisko,
          item.company,
          item.phone || '',
          item.email,
          buildClientNote(item),
          'landing-demo',
          'lead-demo',
          JSON.stringify(['landing-demo', 'demo']),
          JSON.stringify({ demo_request_id: item.id, demo_source: item.source || 'landing-page' }),
          req.user?.id || null,
        ]
      );

      const clientId = clientResult.rows[0].id;
      const crmLead = await ensureDemoCrmLead(item, clientId, req.user);
      const updated = await pool.query(
        `UPDATE demo_requests
         SET client_id = $2,
             crm_lead_id = $3,
             converted_at = NOW(),
             status = CASE WHEN status = 'closed' THEN status ELSE 'qualified' END
         WHERE id = $1
         RETURNING ${DEMO_REQUEST_SELECT}`,
        [params.id, clientId, crmLead?.id || null]
      );

      return res.status(201).json({
        ok: true,
        client_id: clientId,
        crm_lead_id: crmLead?.id || null,
        reusedCrmLead: crmLead?.reused || false,
        item: updated.rows[0],
        requestId: req.requestId,
      });
    } catch (error) {
      next(error);
    }
  }
);

router.post('/', validateBody(demoRequestSchema), async (req, res) => {
  const payload = {
    ...req.body,
    userAgent: String(req.headers['user-agent'] || '').slice(0, 500),
    ipHash: getIpHash(req),
    requestId: req.requestId,
    createdAt: new Date().toISOString(),
  };

  let stored = false;
  let duplicate = false;
  let duplicateId = null;
  let webhookSent = false;
  let telegramSent = false;

  try {
    await ensureDemoRequestsTable();
    const duplicateResult = await pool.query(
      `SELECT id
       FROM demo_requests
       WHERE LOWER(email) = LOWER($1)
         AND LOWER(company) = LOWER($2)
         AND created_at >= NOW() - INTERVAL '24 hours'
       ORDER BY created_at DESC
       LIMIT 1`,
      [payload.email, payload.company]
    );

    if (duplicateResult.rows?.[0]?.id) {
      stored = true;
      duplicate = true;
      duplicateId = duplicateResult.rows[0].id;
    } else {
      await pool.query(
        `INSERT INTO demo_requests (name, email, company, phone, message, source, user_agent, ip_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          payload.name,
          payload.email,
          payload.company,
          payload.phone || '',
          payload.message || '',
          payload.source || 'landing-page',
          payload.userAgent,
          payload.ipHash,
        ]
      );
      stored = true;
    }
  } catch (error) {
    logger.warn('Nie zapisano zgloszenia demo w bazie', {
      requestId: req.requestId,
      message: error.message,
    });

    if (process.env.DEMO_REQUEST_REQUIRE_DATABASE === '1') {
      return res.status(503).json({
        error: 'Formularz demo jest chwilowo niedostepny.',
        requestId: req.requestId,
      });
    }
  }

  if (!duplicate) {
    try {
      const webhookResult = await notifyWebhook(payload);
      webhookSent = webhookResult.sent;
    } catch (error) {
      logger.warn('Nie wyslano webhooka zgloszenia demo', {
        requestId: req.requestId,
        message: error.message,
      });
    }

    try {
      const telegramResult = await notifyTelegram(payload);
      telegramSent = telegramResult.sent;
    } catch (error) {
      logger.warn('Nie wyslano Telegrama zgloszenia demo', {
        requestId: req.requestId,
        message: error.message,
      });
    }
  }

  if (!stored && !webhookSent && !telegramSent) {
    return res.status(503).json({
      error: 'Formularz demo jest chwilowo niedostepny.',
      requestId: req.requestId,
    });
  }

  return res.status(201).json({
    ok: true,
    stored,
    duplicate,
    duplicateId,
    webhookSent,
    telegramSent,
    requestId: req.requestId,
    message: 'Zgloszenie demo zostalo przyjete.',
  });
});

module.exports = router;
