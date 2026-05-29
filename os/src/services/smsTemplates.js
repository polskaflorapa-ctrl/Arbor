/**
 * SMS schedule helpers and configurable status templates.
 */

const DEFAULT_SMS_TEMPLATES = {
  potwierdzenie:
    'Dzien dobry! Potwierdzamy przyjecie zlecenia: {{service}} pod adresem {{address}}. Planowany termin: {{date}} ok. {{window}}. Status: {{status_url}}',
  zaplanowane:
    'Dzien dobry {{client_name}}! Zlecenie {{service}} zaplanowano na {{date}} w godz. {{window}}. Pytania: {{branch_phone}}. Status: {{status_url}}',
  przypomnienie:
    'Przypomnienie: {{date}}, ok. {{window}} realizujemy zlecenie {{service}} pod adresem {{address}}. Status: {{status_url}}',
  w_drodze:
    'Ekipa ARBOR jest w drodze. Zlecenie: {{service}}, {{address}}. Sledzenie: {{status_url}}',
  na_miejscu:
    'Ekipa ARBOR rozpoczela prace przy {{address}}. W razie pytan: {{branch_phone}}.',
  zakonczone:
    'Prace zakonczone. Dziekujemy za skorzystanie z uslug ARBOR. Status i historia: {{status_url}}',
  problem:
    'Informujemy, ze realizacja zlecenia przy {{address}} jest opozniona z powodu: {{reason}}. Status: {{status_url}}',
  anulowane:
    'Informujemy o koniecznosci przelozenia wizyty przy {{address}}. Skontaktujemy sie, aby ustalic nowy termin.',
  time_window_proposal:
    'Dzien dobry {{client_name}}! Proponujemy termin zlecenia {{service}}: {{proposed_date}} w godz. {{proposed_window}}. Potwierdz lub odrzuc tutaj: {{time_window_url}}',
};

function formatSmsPlanParts(z, fallbackDateStr = '-') {
  const fallback =
    fallbackDateStr != null && String(fallbackDateStr).trim() !== '' ? String(fallbackDateStr).trim() : '-';
  if (!z || z.data_planowana == null) {
    return { dateStr: fallback, windowStr: '8:00-16:00' };
  }
  const start = new Date(z.data_planowana);
  if (Number.isNaN(start.getTime())) {
    return { dateStr: fallback, windowStr: '8:00-16:00' };
  }
  const durMin = Math.max(15, Math.round(Number(z.czas_planowany_godziny || 2) * 60));
  const end = new Date(start.getTime() + durMin * 60000);
  const pad = (n) => String(n).padStart(2, '0');
  const windowStr = `${pad(start.getHours())}:${pad(start.getMinutes())}-${pad(end.getHours())}:${pad(end.getMinutes())}`;
  return {
    dateStr: start.toLocaleDateString('pl-PL'),
    windowStr,
  };
}

function statusUrl(task) {
  const token = task?.link_statusowy_token;
  if (!token) return '';
  const base = String(process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
  return base ? `${base}/track/${token}` : `/track/${token}`;
}

function templateFields(task = {}, context = {}) {
  const { dateStr, windowStr } = formatSmsPlanParts(task, context.data || '-');
  return {
    task_id: task.id || '',
    client_name: task.klient_nazwa || '',
    service: task.typ_uslugi || '',
    address: [task.adres, task.miasto].filter(Boolean).join(', '),
    city: task.miasto || '',
    date: dateStr,
    window: windowStr,
    branch_phone: task.oddzial_telefon || '',
    branch_name: task.oddzial_nazwa || '',
    status_url: statusUrl(task),
    reason: context.powod || context.reason || '',
    time_window_url: context.time_window_url || '',
    proposed_date: context.proposed_date || '',
    proposed_window: context.proposed_window || '',
  };
}

function renderTemplate(body, fields = {}) {
  return String(body || '')
    .replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => {
      const value = fields[key];
      return value == null ? '' : String(value);
    })
    .replace(/[ \t]+/g, ' ')
    .trim();
}

async function ensureSmsStatusTemplateTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sms_status_templates (
      id SERIAL PRIMARY KEY,
      oddzial_id INTEGER REFERENCES branches(id) ON DELETE CASCADE,
      template_key VARCHAR(80) NOT NULL,
      body TEXT NOT NULL,
      active BOOLEAN NOT NULL DEFAULT true,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_sms_status_templates_scope_key
      ON sms_status_templates (COALESCE(oddzial_id, 0), template_key)
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_sms_status_templates_active ON sms_status_templates(template_key, active)');
}

function knownSmsTemplateKey(key) {
  return Object.prototype.hasOwnProperty.call(DEFAULT_SMS_TEMPLATES, String(key || ''));
}

async function findSmsStatusTemplate(pool, { templateKey, oddzialId = null }) {
  await ensureSmsStatusTemplateTable(pool);
  const result = await pool.query(
    `SELECT *
       FROM sms_status_templates
      WHERE template_key = $1
        AND active = true
        AND (oddzial_id = $2 OR oddzial_id IS NULL)
      ORDER BY CASE WHEN oddzial_id = $2 THEN 0 ELSE 1 END
      LIMIT 1`,
    [templateKey, oddzialId || null]
  );
  return result.rows[0] || null;
}

async function renderSmsStatusTemplate(pool, { templateKey, task, context = {} }) {
  if (!knownSmsTemplateKey(templateKey)) return null;
  const configured = await findSmsStatusTemplate(pool, {
    templateKey,
    oddzialId: task?.oddzial_id || null,
  }).catch(() => null);
  const body = configured?.body || DEFAULT_SMS_TEMPLATES[templateKey];
  return {
    body: renderTemplate(body, templateFields(task, context)),
    source: configured ? 'configured' : 'default',
    template: configured || null,
  };
}

async function upsertSmsStatusTemplate(pool, {
  templateKey,
  oddzialId = null,
  body,
  active = true,
  userId = null,
}) {
  await ensureSmsStatusTemplateTable(pool);
  const result = await pool.query(
    `INSERT INTO sms_status_templates (
       oddzial_id, template_key, body, active, created_by, updated_by
     ) VALUES ($1,$2,$3,$4,$5,$5)
     ON CONFLICT ((COALESCE(oddzial_id, 0)), template_key)
     DO UPDATE SET
       body = EXCLUDED.body,
       active = EXCLUDED.active,
       updated_by = EXCLUDED.updated_by,
       updated_at = NOW()
     RETURNING *`,
    [oddzialId || null, templateKey, body, active !== false, userId || null]
  );
  return result.rows[0];
}

async function listSmsStatusTemplates(pool, { oddzialId = null } = {}) {
  await ensureSmsStatusTemplateTable(pool);
  const params = [];
  let where = '';
  if (oddzialId) {
    params.push(oddzialId);
    where = 'WHERE oddzial_id = $1 OR oddzial_id IS NULL';
  }
  const result = await pool.query(
    `SELECT * FROM sms_status_templates ${where}
      ORDER BY oddzial_id NULLS FIRST, template_key`,
    params
  );
  return {
    defaults: DEFAULT_SMS_TEMPLATES,
    templates: result.rows,
  };
}

module.exports = {
  DEFAULT_SMS_TEMPLATES,
  ensureSmsStatusTemplateTable,
  findSmsStatusTemplate,
  formatSmsPlanParts,
  knownSmsTemplateKey,
  listSmsStatusTemplates,
  renderSmsStatusTemplate,
  renderTemplate,
  templateFields,
  upsertSmsStatusTemplate,
};
