/**
 * Publiczny, tokenowy status zlecenia dla klienta.
 * GET /track/:token
 *
 * Bez JWT. Endpoint celowo zwraca tylko zakres danych bezpieczny dla klienta:
 * status, termin, adres uslugi, oddzialowy kontakt, ogolna historia i mapa.
 */
const express = require('express');
const pool = require('../config/database');
const logger = require('../config/logger');
const { validateParams } = require('../middleware/validate');
const { z } = require('zod');

const router = express.Router();

async function ensurePublicStatusTables() {
  await pool.query('ALTER TABLE tasks ADD COLUMN IF NOT EXISTS link_statusowy_token VARCHAR(64)');
  await pool.query(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_link_statusowy_token ON tasks(link_statusowy_token) WHERE link_statusowy_token IS NOT NULL'
  );
  await pool.query(`
    CREATE TABLE IF NOT EXISTS task_public_status_events (
      id SERIAL PRIMARY KEY,
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      from_status VARCHAR(64),
      to_status VARCHAR(64) NOT NULL,
      source VARCHAR(40) NOT NULL DEFAULT 'system',
      note TEXT,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(
    'CREATE INDEX IF NOT EXISTS idx_task_public_status_events_task_created ON task_public_status_events(task_id, created_at)'
  );
}

const trackParamsSchema = z.object({
  token: z.string().trim().min(20).max(96).regex(/^[a-zA-Z0-9_-]+$/),
});

const STATUS_META = {
  Nowe: { label: 'Zgloszenie przyjete', color: '#64748b' },
  Wycena_Terenowa: { label: 'Oględziny / wycena', color: '#0284c7' },
  Do_Zatwierdzenia: { label: 'Uzgadniamy szczegoly', color: '#d97706' },
  Zaplanowane: { label: 'Zaplanowane', color: '#16a34a' },
  W_Realizacji: { label: 'Realizacja w toku', color: '#2563eb' },
  Zakonczone: { label: 'Zakonczone', color: '#15803d' },
  Anulowane: { label: 'Anulowane', color: '#dc2626' },
};

const PUBLIC_STEPS = [
  { status: 'Nowe', label: 'Przyjete' },
  { status: 'Wycena_Terenowa', label: 'Wycena' },
  { status: 'Zaplanowane', label: 'Termin' },
  { status: 'W_Realizacji', label: 'Prace' },
  { status: 'Zakonczone', label: 'Gotowe' },
];

function escHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('pl-PL', { day: 'numeric', month: 'long', year: 'numeric' });
}

function formatDateTime(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString('pl-PL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function statusLabel(status) {
  return STATUS_META[status]?.label || String(status || 'Status');
}

function publicTimeline(task, events) {
  const rows = Array.isArray(events) && events.length
    ? events.map((event) => ({
      status: event.to_status,
      label: statusLabel(event.to_status),
      at: event.created_at,
      note: event.note || null,
    }))
    : [{ status: task.status, label: statusLabel(task.status), at: task.updated_at || task.created_at, note: null }];

  return rows
    .filter((row) => row.status)
    .map((row) => ({
      status: row.status,
      label: row.label,
      at: row.at || null,
      note: row.note || null,
    }));
}

function publicPayload(task, events) {
  const address = [task.adres, task.miasto].filter(Boolean).join(', ') || null;
  const hasPin = task.pin_lat != null && task.pin_lng != null;
  return {
    task: {
      id: task.id,
      status: task.status,
      status_label: statusLabel(task.status),
      service: task.typ_uslugi || null,
      planned_date: task.data_planowana || null,
      planned_date_label: formatDate(task.data_planowana),
      address,
      branch: {
        name: task.oddzial_nazwa || null,
        phone: task.oddzial_telefon || null,
      },
      team_visible: ['Zaplanowane', 'W_Realizacji'].includes(task.status) ? (task.ekipa_nazwa || null) : null,
      map: hasPin ? {
        lat: Number(task.pin_lat),
        lng: Number(task.pin_lng),
        url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${task.pin_lat},${task.pin_lng}`)}`,
      } : null,
    },
    timeline: publicTimeline(task, events),
  };
}

function renderPage(payload) {
  const task = payload.task;
  const meta = STATUS_META[task.status] || STATUS_META.Nowe;
  const currentIndex = PUBLIC_STEPS.findIndex((step) => step.status === task.status);
  const effectiveIndex = task.status === 'Do_Zatwierdzenia' ? 1 : currentIndex;
  const stepsHtml = task.status === 'Anulowane' ? '' : PUBLIC_STEPS.map((step, index) => {
    const done = index < effectiveIndex || task.status === 'Zakonczone';
    const active = step.status === task.status || (task.status === 'Do_Zatwierdzenia' && step.status === 'Wycena_Terenowa');
    return `<div class="step ${done ? 'done' : ''} ${active ? 'active' : ''}"><span></span><small>${escHtml(step.label)}</small></div>`;
  }).join('');
  const timelineHtml = payload.timeline.map((row) => (
    `<li><strong>${escHtml(row.label)}</strong>${row.at ? `<time>${escHtml(formatDateTime(row.at))}</time>` : ''}${row.note ? `<p>${escHtml(row.note)}</p>` : ''}</li>`
  )).join('');
  const mapHtml = task.map
    ? `<a class="map" href="${escHtml(task.map.url)}" target="_blank" rel="noreferrer">Otworz mape dojazdu</a>`
    : '';
  const phoneHtml = task.branch.phone
    ? `<a class="tel" href="tel:${escHtml(task.branch.phone)}">Zadzwon: ${escHtml(task.branch.phone)}</a>`
    : '';

  return `<!doctype html>
<html lang="pl">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Status zlecenia ARBOR</title>
<style>
*{box-sizing:border-box}body{margin:0;font-family:Inter,system-ui,-apple-system,Segoe UI,sans-serif;background:#eef2f6;color:#172033;padding:20px 14px 34px}.shell{max-width:560px;margin:0 auto;background:#fff;border:1px solid #d9e1ea;border-radius:14px;overflow:hidden;box-shadow:0 16px 44px rgba(23,32,51,.12)}header{background:#173525;color:#fff;padding:22px 24px}header h1{font-size:19px;margin:0 0 4px}header p{margin:0;color:#b9d5c4;font-size:13px}.body{padding:22px 24px}.badge{display:inline-flex;background:${escHtml(meta.color)};color:#fff;border-radius:999px;padding:9px 14px;font-weight:800;font-size:14px;margin-bottom:18px}.field{margin:0 0 14px}.field span{display:block;color:#64748b;font-size:11px;text-transform:uppercase;letter-spacing:.08em;margin-bottom:3px}.field strong{font-size:17px}.steps{display:flex;gap:6px;margin:22px 0}.step{flex:1;text-align:center;color:#94a3b8;font-size:11px}.step span{display:block;width:18px;height:18px;border:2px solid #cbd5e1;border-radius:50%;margin:0 auto 6px;background:#fff}.step.done span{background:#16a34a;border-color:#16a34a}.step.done{color:#15803d}.step.active span{background:#2563eb;border-color:#2563eb;box-shadow:0 0 0 4px #dbeafe}.step.active{color:#1d4ed8;font-weight:800}.actions{display:grid;gap:10px;margin:18px 0}.tel,.map{display:block;text-decoration:none;text-align:center;border-radius:9px;padding:12px 14px;font-weight:800}.tel{background:#173525;color:#fff}.map{background:#edf7ef;color:#173525;border:1px solid #b9d5c4}.timeline{border-top:1px solid #e2e8f0;margin-top:20px;padding-top:18px}.timeline h2{font-size:15px;margin:0 0 10px}.timeline ul{list-style:none;margin:0;padding:0}.timeline li{padding:10px 0;border-bottom:1px solid #edf2f7}.timeline strong{display:block}.timeline time{display:block;color:#64748b;font-size:12px;margin-top:2px}.timeline p{margin:5px 0 0;color:#475569;font-size:13px}.foot{text-align:center;color:#64748b;font-size:12px;margin:16px auto 0;max-width:520px}
</style>
</head>
<body>
<main class="shell">
  <header><h1>ARBOR - status zlecenia #${escHtml(task.id)}</h1><p>${escHtml(task.branch.name || 'Centrum obslugi')}</p></header>
  <section class="body">
    <div class="badge">${escHtml(task.status_label)}</div>
    <p class="field"><span>Usluga</span><strong>${escHtml(task.service || 'Usluga terenowa')}</strong></p>
    <p class="field"><span>Adres</span>${escHtml(task.address || 'Adres zostanie potwierdzony')}</p>
    ${task.planned_date_label ? `<p class="field"><span>Planowany termin</span>${escHtml(task.planned_date_label)}</p>` : ''}
    ${task.team_visible ? `<p class="field"><span>Ekipa</span>${escHtml(task.team_visible)}</p>` : ''}
    ${stepsHtml ? `<div class="steps">${stepsHtml}</div>` : ''}
    <div class="actions">${mapHtml}${phoneHtml}</div>
    <div class="timeline"><h2>Historia statusow</h2><ul>${timelineHtml}</ul></div>
  </section>
</main>
<p class="foot">Link zawiera prywatny token. Nie udostepnia danych finansowych ani wewnetrznych notatek.</p>
</body>
</html>`;
}

router.get('/:token', validateParams(trackParamsSchema), async (req, res) => {
  try {
    await ensurePublicStatusTables();
    const taskResult = await pool.query(
      `SELECT t.id, t.status, t.typ_uslugi, t.adres, t.miasto, t.data_planowana,
              t.created_at, t.updated_at, t.pin_lat, t.pin_lng,
              o.telefon AS oddzial_telefon, o.nazwa AS oddzial_nazwa,
              e.nazwa AS ekipa_nazwa
         FROM tasks t
         LEFT JOIN branches o ON t.oddzial_id = o.id
         LEFT JOIN teams e ON t.ekipa_id = e.id
        WHERE t.link_statusowy_token = $1
        LIMIT 1`,
      [req.params.token]
    );

    if (!taskResult.rows.length) {
      return res.status(404).type('html').send('<!doctype html><html lang="pl"><body><h1>ARBOR</h1><p>Link statusu jest nieprawidlowy albo wygasl.</p></body></html>');
    }

    const task = taskResult.rows[0];
    const eventsResult = await pool.query(
      `SELECT to_status, note, created_at
         FROM task_public_status_events
        WHERE task_id = $1
        ORDER BY created_at ASC, id ASC`,
      [task.id]
    );
    const payload = publicPayload(task, eventsResult.rows);

    if (String(req.get('accept') || '').includes('application/json')) {
      return res.json(payload);
    }
    return res.type('html').send(renderPage(payload));
  } catch (error) {
    logger.error('track.status', { message: error.message });
    return res.status(500).type('html').send('<p>Blad serwera. Sprobuj ponownie za chwile.</p>');
  }
});

module.exports = router;
