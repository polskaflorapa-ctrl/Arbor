/**
 * Publiczna strona śledzenia statusu zlecenia dla klienta.
 * Dostępna bez JWT — link wysyłany w SMS-ie.
 * GET /track/:token
 */
const express = require('express');
const pool = require('../config/database');
const logger = require('../config/logger');
const { validateParams } = require('../middleware/validate');
const { z } = require('zod');

const router = express.Router();

// Ensure link_statusowy_token column exists
let _tokenColEnsured = false;
async function ensureTokenColumn() {
  if (_tokenColEnsured) return;
  _tokenColEnsured = true;
  await pool.query(
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS link_statusowy_token VARCHAR(64)`
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_tasks_link_statusowy_token ON tasks(link_statusowy_token) WHERE link_statusowy_token IS NOT NULL`
  );
}

const trackParamsSchema = z.object({
  token: z.string().trim().min(1).max(120),
});

function escHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const STATUS_META = {
  Nowe:               { label: 'Zgłoszenie przyjęte',       color: '#64748b', icon: '📋' },
  Do_Zatwierdzenia:   { label: 'Oczekuje na potwierdzenie', color: '#d97706', icon: '⏳' },
  Zaplanowane:        { label: 'Zaplanowane',               color: '#16a34a', icon: '📅' },
  W_Realizacji:       { label: 'Realizacja w toku',         color: '#2563eb', icon: '🔧' },
  Zakonczone:         { label: 'Zakończone',                color: '#15803d', icon: '✅' },
  Anulowane:          { label: 'Anulowane',                 color: '#dc2626', icon: '❌' },
};

function formatDate(val) {
  if (!val) return null;
  const d = new Date(val);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString('pl-PL', { day: 'numeric', month: 'long', year: 'numeric' });
}

function renderPage({ task, ekipaName, oddzialTelefon, oddzialNazwa }) {
  const meta = STATUS_META[task.status] || { label: task.status, color: '#64748b', icon: '📋' };
  const dateStr = formatDate(task.data_planowana);
  const isClosed = task.status === 'Zakonczone' || task.status === 'Anulowane';

  const timeWindowHtml = task.okno_od && task.okno_do
    ? `<p class="detail"><span class="lbl">Godziny:</span> ${escHtml(task.okno_od)}–${escHtml(task.okno_do)}</p>`
    : task.godzina_planowana
      ? `<p class="detail"><span class="lbl">Godz.:</span> ok. ${escHtml(String(task.godzina_planowana).slice(0, 5))}</p>`
      : '';

  const teamHtml = ekipaName && ['W_Realizacji', 'Zaplanowane'].includes(task.status)
    ? `<p class="detail"><span class="lbl">Ekipa:</span> ${escHtml(ekipaName)}</p>`
    : '';

  const contactHtml = oddzialTelefon
    ? `<a class="tel-btn" href="tel:${escHtml(oddzialTelefon)}">📞&nbsp;Zadzwoń: ${escHtml(oddzialTelefon)}</a>`
    : '';

  const progressSteps = [
    { key: 'Nowe',             label: 'Przyjęte' },
    { key: 'Zaplanowane',      label: 'Zaplanowane' },
    { key: 'W_Realizacji',     label: 'W realizacji' },
    { key: 'Zakonczone',       label: 'Zakończone' },
  ];
  const ORDER = ['Nowe', 'Do_Zatwierdzenia', 'Zaplanowane', 'W_Realizacji', 'Zakonczone'];
  const currentIdx = ORDER.indexOf(task.status);
  const progressHtml = isClosed && task.status !== 'Zakonczone' ? '' : progressSteps.map((s) => {
    const stepIdx = ORDER.indexOf(s.key);
    const done  = stepIdx < currentIdx || task.status === 'Zakonczone';
    const active = s.key === task.status || (task.status === 'Do_Zatwierdzenia' && s.key === 'Zaplanowane' && stepIdx === 2);
    const cls = done ? 'step done' : active ? 'step active' : 'step';
    return `<div class="${cls}"><div class="dot"></div><span>${escHtml(s.label)}</span></div>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="pl">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Status zlecenia — ARBOR</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,-apple-system,sans-serif;background:#f1f5f9;min-height:100vh;padding:20px 16px 40px}
.card{background:#fff;border-radius:16px;box-shadow:0 2px 16px rgba(0,0,0,.08);max-width:480px;margin:0 auto;overflow:hidden}
.header{background:#1a2e44;color:#fff;padding:20px 24px}
.header h1{font-size:17px;font-weight:600;letter-spacing:.3px}
.header p{font-size:13px;color:#94a3b8;margin-top:4px}
.status-badge{display:inline-flex;align-items:center;gap:8px;padding:10px 16px;border-radius:24px;color:#fff;font-weight:600;font-size:15px;margin:20px 24px 0}
.body{padding:20px 24px 24px}
.detail{margin-bottom:10px;font-size:15px;color:#334155}
.lbl{font-size:12px;text-transform:uppercase;letter-spacing:.6px;color:#94a3b8;display:block;margin-bottom:2px}
.detail strong{font-size:17px;color:#0f172a}
.divider{height:1px;background:#f1f5f9;margin:16px 0}
/* Progress */
.progress{display:flex;justify-content:space-between;align-items:flex-start;margin:20px 0 0;gap:4px}
.step{flex:1;display:flex;flex-direction:column;align-items:center;gap:6px;font-size:11px;color:#94a3b8;text-align:center}
.dot{width:20px;height:20px;border-radius:50%;border:2px solid #cbd5e1;background:#fff;flex-shrink:0}
.step.done .dot{background:#16a34a;border-color:#16a34a}
.step.done{color:#16a34a}
.step.active .dot{background:#2563eb;border-color:#2563eb;box-shadow:0 0 0 3px #bfdbfe}
.step.active{color:#2563eb;font-weight:600}
/* Tel button */
.tel-btn{display:block;background:#1a2e44;color:#fff;text-align:center;padding:13px;border-radius:10px;font-size:15px;font-weight:600;text-decoration:none;margin-top:20px}
.tel-btn:hover{background:#243b55}
.footer{text-align:center;margin-top:20px;font-size:12px;color:#94a3b8}
</style>
</head>
<body>
<div class="card">
  <div class="header">
    <h1>ARBOR — status zlecenia #${escHtml(String(task.id))}</h1>
    <p>${escHtml(oddzialNazwa || 'Firma ARBOR')}</p>
  </div>
  <div style="background:${escHtml(meta.color)};display:inline-flex;align-items:center;gap:8px;padding:10px 20px;color:#fff;font-weight:600;font-size:15px;margin:20px 24px 0;border-radius:24px">
    <span>${meta.icon}</span><span>${escHtml(meta.label)}</span>
  </div>
  <div class="body">
    <p class="detail"><span class="lbl">Usługa</span><strong>${escHtml(task.typ_uslugi || '—')}</strong></p>
    <p class="detail"><span class="lbl">Adres</span>${escHtml([task.adres, task.miasto].filter(Boolean).join(', ') || '—')}</p>
    ${dateStr ? `<p class="detail"><span class="lbl">Planowany termin</span>${escHtml(dateStr)}</p>` : ''}
    ${timeWindowHtml}
    ${teamHtml}
    ${progressHtml ? `<div class="divider"></div><div class="progress">${progressHtml}</div>` : ''}
    ${contactHtml}
  </div>
</div>
<p class="footer">Masz pytania? Zadzwoń do nas ${oddzialTelefon ? '(' + escHtml(oddzialTelefon) + ')' : ''}.<br/>Dziękujemy za skorzystanie z usług ARBOR.</p>
</body>
</html>`;
}

router.get('/:token', validateParams(trackParamsSchema), async (req, res) => {
  try {
    await ensureTokenColumn();
    const { token } = req.params;
    const isNumeric = /^\d+$/.test(token);

    // Look up by token first, then by numeric id as fallback
    let rows;
    if (isNumeric) {
      ({ rows } = await pool.query(
        `SELECT t.id, t.status, t.typ_uslugi, t.adres, t.miasto,
                t.data_planowana, t.klient_nazwa,
                t.godzina_planowana, t.link_statusowy_token,
                o.telefon AS oddzial_telefon, o.nazwa AS oddzial_nazwa,
                e.nazwa AS ekipa_nazwa
         FROM tasks t
         LEFT JOIN oddzialy o ON t.oddzial_id = o.id
         LEFT JOIN teams e ON t.ekipa_id = e.id
         WHERE t.link_statusowy_token = $1 OR t.id = $2
         ORDER BY (t.link_statusowy_token = $1) DESC
         LIMIT 1`,
        [token, parseInt(token, 10)]
      ));
    } else {
      ({ rows } = await pool.query(
        `SELECT t.id, t.status, t.typ_uslugi, t.adres, t.miasto,
                t.data_planowana, t.klient_nazwa,
                t.godzina_planowana, t.link_statusowy_token,
                o.telefon AS oddzial_telefon, o.nazwa AS oddzial_nazwa,
                e.nazwa AS ekipa_nazwa
         FROM tasks t
         LEFT JOIN oddzialy o ON t.oddzial_id = o.id
         LEFT JOIN teams e ON t.ekipa_id = e.id
         WHERE t.link_statusowy_token = $1
         LIMIT 1`,
        [token]
      ));
    }

    if (!rows.length) {
      return res.status(404).type('html').send(`<!DOCTYPE html>
<html lang="pl"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Nie znaleziono — ARBOR</title>
<style>body{font-family:system-ui;padding:40px 16px;text-align:center;background:#f1f5f9;color:#334155}h1{color:#1a2e44}p{margin-top:12px;color:#64748b}</style>
</head><body><h1>ARBOR</h1><p>Nie znaleziono zlecenia.<br/>Sprawdź link w SMS lub skontaktuj się z nami.</p></body></html>`);
    }

    const task = rows[0];
    const html = renderPage({
      task,
      ekipaName: task.ekipa_nazwa,
      oddzialTelefon: task.oddzial_telefon,
      oddzialNazwa: task.oddzial_nazwa,
    });
    res.type('html').send(html);
  } catch (e) {
    logger.error('track GET', { message: e.message });
    res.status(500).type('html').send('<p>Błąd serwera. Spróbuj ponownie za chwilę.</p>');
  }
});

module.exports = router;
