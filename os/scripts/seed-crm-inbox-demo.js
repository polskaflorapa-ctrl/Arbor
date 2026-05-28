/**
 * Seeds a small CRM Unified Inbox demo.
 *
 * Safe to run repeatedly. Set SEED_CRM_INBOX_REPLACE=1 to refresh rows
 * created by this script.
 */
const { Client } = require('pg');
const { getPgClientConfig } = require('./db-connection');

const MARKER = '__ARBOR_CRM_INBOX_DEMO_v1__';

async function tableExists(client, tableName) {
  const res = await client.query(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = $1
     ) AS exists`,
    [tableName]
  );
  return Boolean(res.rows[0]?.exists);
}

async function ensureBranch(client) {
  const demoUserBranch = await client.query(
    `SELECT oddzial_id AS id FROM users
     WHERE oddzial_id IS NOT NULL
       AND COALESCE(aktywny, true) = true
       AND (
         login IN ('demo_dyrektor', 'demo_specjalista')
         OR (imie = 'Anna' AND nazwisko = 'Kowalska')
       )
     ORDER BY CASE WHEN login = 'demo_dyrektor' THEN 0 ELSE 1 END, id ASC
     LIMIT 1`
  );
  if (demoUserBranch.rows[0]?.id) return demoUserBranch.rows[0].id;

  const namedDemoBranch = await client.query(
    `SELECT id FROM branches
     WHERE nazwa ILIKE 'Demo Krakow%' OR nazwa ILIKE 'Demo Kraków%'
     ORDER BY id ASC
     LIMIT 1`
  );
  if (namedDemoBranch.rows[0]) return namedDemoBranch.rows[0].id;

  const existing = await client.query(
    `SELECT id FROM branches WHERE COALESCE(aktywny, true) = true ORDER BY id ASC LIMIT 1`
  );
  if (existing.rows[0]) return existing.rows[0].id;
  const inserted = await client.query(
    `INSERT INTO branches (nazwa, miasto) VALUES ($1, $2) RETURNING id`,
    ['Demo Krakow', 'Krakow']
  );
  return inserted.rows[0].id;
}

async function listTargetBranches(client) {
  if (process.env.SEED_CRM_INBOX_ALL_BRANCHES === '0') {
    return [await ensureBranch(client)];
  }
  const { rows } = await client.query(
    `SELECT id FROM branches WHERE COALESCE(aktywny, true) = true ORDER BY id ASC`
  );
  if (rows.length) return rows.map((row) => row.id);
  return [await ensureBranch(client)];
}

async function ensureOwner(client, branchId) {
  const existing = await client.query(
    `SELECT id FROM users
     WHERE COALESCE(aktywny, true) = true
       AND rola IN ('Dyrektor', 'Administrator', 'Kierownik', 'Specjalista', 'Wyceniajacy', 'Wyceniający')
     ORDER BY CASE WHEN login = 'demo_specjalista' THEN 0 ELSE 1 END, id ASC
     LIMIT 1`
  );
  if (existing.rows[0]) return existing.rows[0].id;

  const inserted = await client.query(
    `INSERT INTO users (login, haslo_hash, imie, nazwisko, rola, oddzial_id, aktywny)
     VALUES ($1, $2, $3, $4, $5, $6, true)
     RETURNING id`,
    ['demo_crm_owner', 'demo-password-disabled', 'Ola', 'Biuro', 'Specjalista', branchId]
  );
  return inserted.rows[0].id;
}

async function insertClient(client, data) {
  const existing = await client.query(
    `SELECT id FROM klienci WHERE telefon = $1 OR email = $2 ORDER BY id ASC LIMIT 1`,
    [data.telefon, data.email]
  );
  if (existing.rows[0]) return existing.rows[0].id;
  const inserted = await client.query(
    `INSERT INTO klienci (imie, nazwisko, firma, telefon, email, adres, miasto, notatki, zrodlo)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING id`,
    [
      data.imie || null,
      data.nazwisko || null,
      data.firma || null,
      data.telefon,
      data.email,
      data.adres || null,
      data.miasto || null,
      `${data.notatki || 'Demo CRM Inbox'}\n${MARKER}`,
      data.zrodlo || 'crm_demo',
    ]
  );
  return inserted.rows[0].id;
}

async function insertLead(client, data) {
  const inserted = await client.query(
    `INSERT INTO crm_leads (
       title, oddzial_id, client_id, owner_user_id, stage, source, value, phone, email,
       notes, tags, next_action_at, created_by, updated_by
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$13)
     RETURNING id`,
    [
      data.title,
      data.oddzial_id,
      data.client_id,
      data.owner_user_id,
      data.stage || 'Lead',
      data.source || 'demo',
      data.value || 0,
      data.phone,
      data.email,
      `${data.notes || 'Demo lead for Unified Inbox'}\n${MARKER}`,
      JSON.stringify(['demo', 'crm-inbox', ...(data.tags || [])]),
      data.next_action_at || null,
      data.created_by,
    ]
  );
  return inserted.rows[0].id;
}

async function insertMessage(client, leadId, data, createdBy) {
  await client.query(
    `INSERT INTO crm_lead_messages (
       lead_id, channel, direction, sender_name, sender_handle, recipient_handle, subject, body,
       status, external_message_id, external_thread_id, template_key, dynamic_fields, metadata,
       retry_count, last_error, delivered_at, read_at, created_by, created_at
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb,$15,$16,$17,$18,$19,$20)`,
    [
      leadId,
      data.channel,
      data.direction,
      data.sender_name || null,
      data.sender_handle || null,
      data.recipient_handle || null,
      data.subject || null,
      data.body,
      data.status,
      data.external_message_id || null,
      data.external_thread_id || `crm-demo-thread-${leadId}`,
      data.template_key || null,
      JSON.stringify(data.dynamic_fields || {}),
      JSON.stringify({ seed_marker: MARKER, demo: true, ...(data.metadata || {}) }),
      data.retry_count || 0,
      data.last_error || null,
      data.delivered_at || null,
      data.read_at || null,
      createdBy,
      data.created_at,
    ]
  );
}

function minutesAgo(minutes) {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString();
}

async function run() {
  const client = new Client(getPgClientConfig());
  await client.connect();
  try {
    if (!(await tableExists(client, 'crm_leads')) || !(await tableExists(client, 'crm_lead_messages'))) {
      throw new Error('CRM tables are missing. Run `npm run db:migrate -w arbor-os` first.');
    }

    await client.query('BEGIN');

    if (process.env.SEED_CRM_INBOX_REPLACE === '1') {
      await client.query(`DELETE FROM crm_leads WHERE notes LIKE $1`, [`%${MARKER}%`]);
      await client.query(`DELETE FROM klienci WHERE notatki LIKE $1`, [`%${MARKER}%`]).catch(() => {});
    } else {
      const existing = await client.query(`SELECT COUNT(*)::int AS c FROM crm_leads WHERE notes LIKE $1`, [`%${MARKER}%`]);
      if (existing.rows[0].c > 0) {
        await client.query('ROLLBACK');
        console.log(`CRM Inbox demo already exists (${existing.rows[0].c} leads). Set SEED_CRM_INBOX_REPLACE=1 to refresh.`);
        return;
      }
    }

    const branchIds = await listTargetBranches(client);
    let totalLeads = 0;
    let totalMessages = 0;

    for (const branchId of branchIds) {
      const ownerId = await ensureOwner(client, branchId);

      const clients = [
        {
          imie: 'Jan',
          nazwisko: 'Kowalski',
          firma: `Ogrody Kowalski ${branchId}`,
          telefon: `+48500100${String(branchId).padStart(3, '0')}`,
          email: `jan.kowalski.${branchId}@example.test`,
          adres: 'ul. Lipowa 8',
          miasto: 'Krakow',
        },
        {
          imie: 'Maria',
          nazwisko: 'Nowak',
          firma: `Wspolnota Zielona ${branchId}`,
          telefon: `+48500777${String(branchId).padStart(3, '0')}`,
          email: `zarzad.zielona.${branchId}@example.test`,
          adres: 'ul. Zielona 12',
          miasto: 'Krakow',
        },
        {
          imie: 'Adam',
          nazwisko: 'Wisniewski',
          firma: `Dom Seniora Parkowy ${branchId}`,
          telefon: `+48500666${String(branchId).padStart(3, '0')}`,
          email: `parkowy.${branchId}@example.test`,
          adres: 'ul. Parkowa 3',
          miasto: 'Krakow',
        },
      ];

      const clientIds = [];
      for (const clientData of clients) {
        clientIds.push(await insertClient(client, clientData));
      }

      const leads = [
        {
          title: `Wycena ogrodu - Lipowa 8 [oddzial ${branchId}]`,
        client_id: clientIds[0],
        owner_user_id: ownerId,
        stage: 'Lead',
        source: 'whatsapp',
        value: 4200,
        phone: clients[0].telefon,
        email: clients[0].email,
        tags: ['whatsapp'],
        messages: [
          {
            channel: 'whatsapp',
            direction: 'inbound',
            sender_name: 'Jan Kowalski',
            sender_handle: clients[0].telefon,
            body: 'Dzien dobry, prosze o szybka wycene przyciecia drzew przy ogrodzeniu.',
            status: 'received',
            created_at: minutesAgo(95),
          },
          {
            channel: 'whatsapp',
            direction: 'outbound',
            sender_name: 'ARBOR',
            sender_handle: 'ARBOR',
            recipient_handle: clients[0].telefon,
            body: 'Dzien dobry, mozemy podjechac jutro rano. Czy pasuje 9:30?',
            status: 'sent',
            delivered_at: minutesAgo(80),
            created_at: minutesAgo(82),
          },
          {
            channel: 'whatsapp',
            direction: 'inbound',
            sender_name: 'Jan Kowalski',
            sender_handle: clients[0].telefon,
            body: 'Pasuje. Prosze tez sprawdzic jeden suchy konar nad altana.',
            status: 'received',
            created_at: minutesAgo(76),
          },
        ],
      },
      {
        title: `Wspolnota Zielona 12 - oferta po ogledzinach [oddzial ${branchId}]`,
        client_id: clientIds[1],
        owner_user_id: ownerId,
        stage: 'Oferta',
        source: 'email',
        value: 8700,
        phone: clients[1].telefon,
        email: clients[1].email,
        tags: ['email', 'oferta'],
        messages: [
          {
            channel: 'email',
            direction: 'inbound',
            sender_name: 'Zarzad wspolnoty',
            sender_handle: clients[1].email,
            subject: 'Oferta po ogledzinach',
            body: 'Dzien dobry, prosimy o przeslanie oferty po dzisiejszych ogledzinach.',
            status: 'received',
            created_at: minutesAgo(180),
          },
          {
            channel: 'email',
            direction: 'outbound',
            sender_name: 'ARBOR',
            sender_handle: 'oferty@arbor.local',
            recipient_handle: clients[1].email,
            subject: 'Oferta ARBOR - Zielona 12',
            body: 'Dzien dobry, oferta jest gotowa. W zalaczniku zakres prac i termin realizacji.',
            status: 'queued',
            template_key: 'offer_followup',
            created_at: minutesAgo(35),
          },
        ],
      },
      {
        title: `Dom Seniora Parkowy - awaria SMS [oddzial ${branchId}]`,
        client_id: clientIds[2],
        owner_user_id: null,
        stage: 'Lead',
        source: 'sms',
        value: 2600,
        phone: clients[2].telefon,
        email: clients[2].email,
        tags: ['sms', 'retry'],
        messages: [
          {
            channel: 'sms',
            direction: 'outbound',
            sender_name: 'ARBOR',
            sender_handle: 'ARBOR',
            recipient_handle: clients[2].telefon,
            body: 'Dzien dobry, potwierdzamy przyjecie zgloszenia i oddzwonimy w sprawie terminu.',
            status: 'failed',
            retry_count: 2,
            last_error: 'Demo: provider SMS zwrocil timeout.',
            created_at: minutesAgo(24),
          },
          {
            channel: 'telegram',
            direction: 'inbound',
            sender_name: 'Adam Wisniewski',
            sender_handle: '@parkowy_admin',
            body: 'Czy mozemy dostac termin jeszcze w tym tygodniu?',
            status: 'received',
            created_at: minutesAgo(15),
          },
        ],
      },
      ];

      for (const lead of leads) {
        const leadId = await insertLead(client, {
          ...lead,
          oddzial_id: branchId,
          created_by: ownerId,
        });
        totalLeads += 1;
        for (const message of lead.messages) {
          await insertMessage(client, leadId, message, ownerId);
          totalMessages += 1;
        }
      }
    }

    await client.query('COMMIT');
    console.log(`CRM Inbox demo seed complete. Branches: ${branchIds.length}. Leads: ${totalLeads}. Messages: ${totalMessages}.`);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(`[seed-crm-inbox-demo] FAILED: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

run();
