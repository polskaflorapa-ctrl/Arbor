/**
 * Seeds a realistic management demo:
 * phone lead -> inspection -> field estimate -> office planning -> crew work.
 *
 * Safe to run repeatedly. Set SEED_PRESIDENT_DEMO_REPLACE=1 to refresh rows
 * created by this script. Uses DEMO_PASSWORD for all demo users.
 */
const { Client } = require('pg');
const bcrypt = require('bcryptjs');
const { getPgClientConfig } = require('./db-connection');

const MARKER = '__ARBOR_PRESIDENT_DEMO_v1__';
const ROLE_ESTIMATOR = 'Wyceniaj\u0105cy';
const DEFAULT_PASSWORD = process.env.DEMO_PASSWORD || 'Demo123!ARBOR';

function pgTimestamp(days, hour, minute = 0) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, minute, 0, 0);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
}

function pgDate(days) {
  return pgTimestamp(days, 0).slice(0, 10);
}

function img(label, bg = 'e8f5e9', fg = '14532d') {
  return `https://placehold.co/900x600/${bg}/${fg}.png?text=${encodeURIComponent(label)}`;
}

async function tableExists(client, name) {
  const { rows } = await client.query(`SELECT to_regclass($1) AS reg`, [`public.${name}`]);
  return Boolean(rows[0]?.reg);
}

async function cleanup(client) {
  const taskIds = await client.query(`SELECT id FROM tasks WHERE notatki_wewnetrzne LIKE $1`, [`%${MARKER}%`]);
  const ids = taskIds.rows.map((r) => r.id);
  if (ids.length) {
    await client.query(`UPDATE ogledziny SET task_id = NULL WHERE task_id = ANY($1::int[])`, [ids]).catch(() => {});
    await client.query(`DELETE FROM tasks WHERE id = ANY($1::int[])`, [ids]);
  }

  await client.query(`DELETE FROM quotations WHERE kommo_lead_external_id LIKE 'ARBOR-DEMO-%'`).catch(() => {});
  await client.query(`DELETE FROM crm_leads WHERE notes LIKE $1`, [`%${MARKER}%`]).catch(() => {});
  await client.query(`DELETE FROM ogledziny WHERE COALESCE(notatki,'') LIKE $1 OR COALESCE(notatki_wyniki,'') LIKE $1`, [`%${MARKER}%`]).catch(() => {});
  await client.query(`DELETE FROM klienci WHERE notatki LIKE $1`, [`%${MARKER}%`]).catch(() => {});
  await client.query(`DELETE FROM vehicles WHERE notatki LIKE $1`, [`%${MARKER}%`]).catch(() => {});
  await client.query(`DELETE FROM equipment_items WHERE notatki LIKE $1`, [`%${MARKER}%`]).catch(() => {});
  await client.query(`DELETE FROM delegacje WHERE uwagi LIKE $1`, [`%${MARKER}%`]).catch(() => {});
}

async function ensureBranch(client, data) {
  const existing = await client.query(`SELECT id FROM branches WHERE LOWER(nazwa) = LOWER($1) ORDER BY id LIMIT 1`, [data.nazwa]);
  if (existing.rows[0]) {
    const { rows } = await client.query(
      `UPDATE branches SET adres=$2, miasto=$3, kod_pocztowy=$4, telefon=$5, email=$6, aktywny=true, updated_at=NOW()
       WHERE id=$1 RETURNING id`,
      [existing.rows[0].id, data.adres, data.miasto, data.kod_pocztowy, data.telefon, data.email]
    );
    return rows[0].id;
  }
  const { rows } = await client.query(
    `INSERT INTO branches (nazwa, adres, miasto, kod_pocztowy, telefon, email, aktywny)
     VALUES ($1,$2,$3,$4,$5,$6,true) RETURNING id`,
    [data.nazwa, data.adres, data.miasto, data.kod_pocztowy, data.telefon, data.email]
  );
  return rows[0].id;
}

async function ensureUser(client, hash, data) {
  const existing = await client.query(`SELECT id FROM users WHERE login=$1`, [data.login]);
  const values = [
    data.login,
    hash,
    data.imie,
    data.nazwisko,
    data.email,
    data.telefon,
    data.rola,
    data.oddzial_id,
    data.stawka_godzinowa || null,
    data.stanowisko || null,
  ];
  if (existing.rows[0]) {
    const { rows } = await client.query(
      `UPDATE users SET haslo_hash=$2, imie=$3, nazwisko=$4, email=$5, telefon=$6, rola=$7,
         oddzial_id=$8, stawka_godzinowa=$9, stanowisko=$10, aktywny=true, updated_at=NOW()
       WHERE login=$1 RETURNING id`,
      values
    );
    return rows[0].id;
  }
  const { rows } = await client.query(
    `INSERT INTO users (login, haslo_hash, imie, nazwisko, email, telefon, rola, oddzial_id, stawka_godzinowa, stanowisko, aktywny)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true) RETURNING id`,
    values
  );
  return rows[0].id;
}

async function ensureTeam(client, data) {
  const existing = await client.query(
    `SELECT id FROM teams WHERE LOWER(nazwa)=LOWER($1) AND oddzial_id=$2 ORDER BY id LIMIT 1`,
    [data.nazwa, data.oddzial_id]
  );
  if (existing.rows[0]) {
    const { rows } = await client.query(
      `UPDATE teams SET brygadzista_id=$2, aktywny=true, updated_at=NOW() WHERE id=$1 RETURNING id`,
      [existing.rows[0].id, data.brygadzista_id]
    );
    return rows[0].id;
  }
  const { rows } = await client.query(
    `INSERT INTO teams (nazwa, brygadzista_id, oddzial_id, aktywny) VALUES ($1,$2,$3,true) RETURNING id`,
    [data.nazwa, data.brygadzista_id, data.oddzial_id]
  );
  return rows[0].id;
}

async function addTeamMember(client, teamId, userId) {
  await client.query(
    `INSERT INTO team_members (team_id, user_id) VALUES ($1,$2) ON CONFLICT (team_id, user_id) DO NOTHING`,
    [teamId, userId]
  );
  await client.query(`UPDATE users SET ekipa_id=$1 WHERE id=$2`, [teamId, userId]);
}

async function ensureClient(client, data) {
  const existing = await client.query(`SELECT id FROM klienci WHERE telefon=$1 ORDER BY id LIMIT 1`, [data.telefon]);
  const values = [
    data.imie,
    data.nazwisko,
    data.firma,
    data.telefon,
    data.email,
    data.adres,
    data.miasto,
    data.kod_pocztowy,
    `${data.notatki}\n${MARKER}`,
    data.zrodlo || 'telefon',
    data.created_by,
  ];
  if (existing.rows[0]) {
    const { rows } = await client.query(
      `UPDATE klienci SET imie=$1, nazwisko=$2, firma=$3, telefon=$4, email=$5, adres=$6, miasto=$7,
         kod_pocztowy=$8, notatki=$9, zrodlo=$10, created_by=$11, updated_at=NOW()
       WHERE id=$12 RETURNING id`,
      [...values, existing.rows[0].id]
    );
    return rows[0].id;
  }
  const { rows } = await client.query(
    `INSERT INTO klienci (imie, nazwisko, firma, telefon, email, adres, miasto, kod_pocztowy, notatki, zrodlo, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    values
  );
  return rows[0].id;
}

async function insertInspection(client, data) {
  const { rows } = await client.query(
    `INSERT INTO ogledziny (klient_id, brygadzista_id, data_planowana, status, adres, miasto, notatki, notatki_wyniki, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [
      data.klient_id,
      data.brygadzista_id,
      data.data_planowana,
      data.status,
      data.adres,
      data.miasto,
      `${data.notatki}\n${MARKER}`,
      data.notatki_wyniki || null,
      data.created_by,
    ]
  );
  const id = rows[0].id;
  for (const event of data.events || []) {
    await client.query(
      `INSERT INTO ogledziny_field_events (ogledziny_id, user_id, event_type, lat, lng, eta_min, note, recorded_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, event.user_id, event.event_type, event.lat, event.lng, event.eta_min || null, event.note || null, event.recorded_at || pgTimestamp(0, 9)]
    );
  }
  for (const media of data.media || []) {
    await client.query(
      `INSERT INTO ogledziny_media (ogledziny_id, url, mime, kind) VALUES ($1,$2,$3,$4)`,
      [id, media.url, media.mime || 'image/png', media.kind || 'photo']
    );
  }
  return id;
}

async function insertQuotation(client, data) {
  const { rows } = await client.query(
    `INSERT INTO quotations (
       kommo_lead_external_id, wyceniajacy_id, oddzial_id, klient_nazwa, klient_telefon, klient_email,
       adres, miasto, lat, lng, kommo_sales_notes, status, visit_started_at, visit_ended_at,
       visit_start_lat, visit_start_lng, visit_end_lat, visit_end_lng, czas_wizyty_minuty,
       wartosc_sugerowana, wartosc_zaproponowana, marza_pct, koszt_wlasny_calkowity,
       data_wizyty_planowana, waznosc_do, client_acceptance_token, wyslano_klientowi_at,
       klient_akceptacja_at, created_by
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29)
     RETURNING id`,
    [
      data.external_id,
      data.wyceniajacy_id,
      data.oddzial_id,
      data.klient_nazwa,
      data.klient_telefon,
      data.klient_email || null,
      data.adres,
      data.miasto,
      data.lat,
      data.lng,
      `${data.notes}\n${MARKER}`,
      data.status,
      data.visit_started_at || null,
      data.visit_ended_at || null,
      data.lat,
      data.lng,
      data.lat,
      data.lng,
      data.czas_wizyty_minuty || null,
      data.wartosc_sugerowana,
      data.wartosc_zaproponowana,
      data.marza_pct,
      data.koszt_wlasny_calkowity || null,
      data.data_wizyty_planowana || null,
      data.waznosc_do || null,
      data.client_acceptance_token || null,
      data.wyslano_klientowi_at || null,
      data.klient_akceptacja_at || null,
      data.created_by,
    ]
  );
  const quotationId = rows[0].id;
  for (const [idx, item] of (data.items || []).entries()) {
    await client.query(
      `INSERT INTO quotation_items (
         quotation_id, kolejnosc, gatunek, wysokosc_pas, piersnica_pas, typ_pracy,
         warunki_dojazdu, przeszkody, wymagane_uprawnienia, czas_planowany_min,
         wymagany_sprzet, koszt_wlasny, cena_pozycji, metadata
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12,$13,$14::jsonb)`,
      [
        quotationId,
        idx,
        item.gatunek,
        item.wysokosc_pas,
        item.piersnica_pas || null,
        item.typ_pracy,
        item.warunki_dojazdu || null,
        JSON.stringify(item.przeszkody || []),
        JSON.stringify(item.wymagane_uprawnienia || []),
        item.czas_planowany_min,
        item.wymagany_sprzet,
        item.koszt_wlasny,
        item.cena_pozycji,
        JSON.stringify({ demo: true }),
      ]
    );
  }
  for (const photo of data.photos || []) {
    await client.query(
      `INSERT INTO annotated_photos (parent_object_type, parent_object_id, original_url, annotated_preview_url, annotations_json, lat, lng, autor_user_id, autor_typ, photo_kind, rendered_png_url)
       VALUES ('quotation',$1,$2,$3,$4::jsonb,$5,$6,$7,'estimator',$8,$9)`,
      [
        quotationId,
        photo.original_url,
        photo.annotated_preview_url || photo.original_url,
        JSON.stringify(photo.annotations_json || { arrows: ['demo zakres prac'] }),
        data.lat,
        data.lng,
        data.wyceniajacy_id,
        photo.photo_kind || 'annotated',
        photo.rendered_png_url || photo.annotated_preview_url || photo.original_url,
      ]
    );
  }
  return quotationId;
}

async function insertTask(client, data) {
  const { rows } = await client.query(
    `INSERT INTO tasks (
       klient_nazwa, klient_telefon, klient_email, adres, miasto, kod_pocztowy,
       typ_uslugi, opis, data_planowana, data_rozpoczecia, data_zakonczenia,
       priorytet, status, wartosc_planowana, wartosc_rzeczywista,
       ekipa_id, oddzial_id, brygadzista_id, kierownik_id, wyceniajacy_id,
       notatki_wewnetrzne, notatki_klienta, czas_planowany_godziny, pin_lat, pin_lng,
       ankieta_uproszczona, source_quotation_id, wartosc_netto_do_rozliczenia
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,true,$26,$27)
     RETURNING id`,
    [
      data.klient_nazwa,
      data.klient_telefon,
      data.klient_email || null,
      data.adres,
      data.miasto,
      data.kod_pocztowy || null,
      data.typ_uslugi,
      data.opis,
      data.data_planowana,
      data.data_rozpoczecia || null,
      data.data_zakonczenia || null,
      data.priorytet || 'Normalny',
      data.status,
      data.wartosc_planowana,
      data.wartosc_rzeczywista || null,
      data.ekipa_id || null,
      data.oddzial_id,
      data.brygadzista_id || null,
      data.kierownik_id || null,
      data.wyceniajacy_id || null,
      `${data.notatki_wewnetrzne}\n${MARKER}`,
      data.notatki_klienta || null,
      data.czas_planowany_godziny,
      data.pin_lat,
      data.pin_lng,
      data.source_quotation_id || null,
      data.wartosc_netto_do_rozliczenia || null,
    ]
  );
  const taskId = rows[0].id;
  for (const photo of data.photos || []) {
    await client.query(
      `INSERT INTO photos (task_id, user_id, typ, url, sciezka, data_dodania, lat, lon, opis, tagi)
       VALUES ($1,$2,$3,$4,$4,$5,$6,$7,$8,$9)`,
      [taskId, photo.user_id, photo.typ, photo.url, photo.data_dodania || pgTimestamp(0, 10), data.pin_lat, data.pin_lng, photo.opis || null, photo.tagi || []]
    );
  }
  if (data.contact) {
    await client.query(
      `INSERT INTO task_client_contacts (task_id, status, note, due_at, updated_by)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (task_id) DO UPDATE SET status=EXCLUDED.status, note=EXCLUDED.note, due_at=EXCLUDED.due_at, updated_by=EXCLUDED.updated_by, updated_at=NOW()`,
      [taskId, data.contact.status, data.contact.note, data.contact.due_at, data.contact.updated_by]
    );
  }
  if (data.workLog) {
    await client.query(
      `INSERT INTO work_logs (task_id, user_id, start_time, end_time, duration_hours, opis, status, bhp_checklista)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
      [
        taskId,
        data.workLog.user_id,
        data.workLog.start_time,
        data.workLog.end_time || null,
        data.workLog.duration_hours || null,
        data.workLog.opis,
        data.workLog.status || 'completed',
        JSON.stringify(data.workLog.bhp || []),
      ]
    );
  }
  if (data.payment) {
    await client.query(
      `INSERT INTO task_client_payments (task_id, forma_platnosc, kwota_odebrana, faktura_vat, nip, notatki, recorded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (task_id) DO UPDATE SET forma_platnosc=EXCLUDED.forma_platnosc, kwota_odebrana=EXCLUDED.kwota_odebrana, faktura_vat=EXCLUDED.faktura_vat, nip=EXCLUDED.nip, notatki=EXCLUDED.notatki, recorded_at=NOW(), recorded_by=EXCLUDED.recorded_by`,
      [taskId, data.payment.forma_platnosc, data.payment.kwota_odebrana, data.payment.faktura_vat, data.payment.nip || null, data.payment.notatki || null, data.payment.recorded_by]
    );
  }
  return taskId;
}

async function insertFleet(client, ctx) {
  const vehicleRows = [
    ['KR-DEMO-01', 'Iveco', 'Daily', 'Dostepny', ctx.krakowTeam, ctx.krakow],
    ['KR-DEMO-02', 'MAN', 'TGE', 'W trasie', ctx.dabTeam, ctx.krakow],
    ['PO-DEMO-01', 'Renault', 'Master', 'Dostepny', ctx.poznanTeam, ctx.poznan],
  ];
  for (const [nr, marka, model, status, teamId, branchId] of vehicleRows) {
    const exists = await client.query(`SELECT id FROM vehicles WHERE nr_rejestracyjny=$1`, [nr]);
    if (exists.rows[0]) {
      await client.query(`UPDATE vehicles SET marka=$2, model=$3, status=$4, ekipa_id=$5, oddzial_id=$6, notatki=$7, updated_at=NOW() WHERE id=$1`, [
        exists.rows[0].id,
        marka,
        model,
        status,
        teamId,
        branchId,
        MARKER,
      ]);
    } else {
      await client.query(
        `INSERT INTO vehicles (nr_rejestracyjny, marka, model, typ, status, ekipa_id, oddzial_id, data_przegladu, data_ubezpieczenia, przebieg, notatki)
         VALUES ($1,$2,$3,'Dostawczy',$4,$5,$6,$7,$8,$9,$10)`,
        [nr, marka, model, status, teamId, branchId, pgDate(60), pgDate(180), 85000, MARKER]
      );
    }
  }

  const equipmentRows = [
    ['Rebak demo BC1500', 'Rebak', 'RB-DEMO-01', ctx.krakowTeam, ctx.krakow, 'Dostepny'],
    ['Pilarka demo MS 500i', 'Pilarka', 'PI-DEMO-01', ctx.krakowTeam, ctx.krakow, 'Dostepny'],
    ['Podnosnik demo 20m', 'Podnosnik', 'PD-DEMO-01', ctx.dabTeam, ctx.krakow, 'W uzyciu'],
    ['Frezarka demo', 'Frezarka', 'FR-DEMO-01', ctx.poznanTeam, ctx.poznan, 'Dostepny'],
  ];
  for (const [nazwa, typ, nr, teamId, branchId, status] of equipmentRows) {
    const exists = await client.query(`SELECT id FROM equipment_items WHERE nr_seryjny=$1`, [nr]);
    if (exists.rows[0]) {
      await client.query(`UPDATE equipment_items SET nazwa=$2, typ=$3, ekipa_id=$4, oddzial_id=$5, status=$6, notatki=$7, updated_at=NOW() WHERE id=$1`, [
        exists.rows[0].id,
        nazwa,
        typ,
        teamId,
        branchId,
        status,
        MARKER,
      ]);
    } else {
      await client.query(
        `INSERT INTO equipment_items (nazwa, typ, nr_seryjny, ekipa_id, oddzial_id, data_przegladu, koszt_motogodziny, status, notatki)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [nazwa, typ, nr, teamId, branchId, pgDate(45), 120, status, MARKER]
      );
    }
  }
}

async function insertCrmLead(client, data) {
  if (!(await tableExists(client, 'crm_leads'))) return null;
  const { rows } = await client.query(
    `INSERT INTO crm_leads (title, oddzial_id, client_id, owner_user_id, stage, source, value, phone, email, notes, tags, next_action_at, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13) RETURNING id`,
    [
      data.title,
      data.oddzial_id,
      data.client_id,
      data.owner_user_id,
      data.stage,
      data.source,
      data.value,
      data.phone,
      data.email || null,
      `${data.notes}\n${MARKER}`,
      JSON.stringify(data.tags || ['demo']),
      data.next_action_at,
      data.created_by,
    ]
  );
  return rows[0].id;
}

async function run() {
  const client = new Client(getPgClientConfig());
  await client.connect();
  try {
    const existing = await client.query(`SELECT COUNT(*)::int AS c FROM tasks WHERE notatki_wewnetrzne LIKE $1`, [`%${MARKER}%`]);
    if (existing.rows[0].c > 0 && process.env.SEED_PRESIDENT_DEMO_REPLACE !== '1') {
      console.log(`President demo already exists (${existing.rows[0].c} tasks). Set SEED_PRESIDENT_DEMO_REPLACE=1 to refresh.`);
      console.log(`Demo password: ${DEFAULT_PASSWORD}`);
      return;
    }

    await client.query('BEGIN');
    if (process.env.SEED_PRESIDENT_DEMO_REPLACE === '1') await cleanup(client);

    const hash = await bcrypt.hash(DEFAULT_PASSWORD, 12);
    const krakow = await ensureBranch(client, {
      nazwa: 'Demo Krakow',
      adres: 'ul. Arborystyczna 12',
      miasto: 'Krakow',
      kod_pocztowy: '30-001',
      telefon: '+48123000001',
      email: 'krakow-demo@arbor.local',
    });
    const poznan = await ensureBranch(client, {
      nazwa: 'Demo Poznan',
      adres: 'ul. Zielona 8',
      miasto: 'Poznan',
      kod_pocztowy: '60-001',
      telefon: '+48613000001',
      email: 'poznan-demo@arbor.local',
    });

    const users = {};
    const userRows = [
      ['demo_prezes', 'Pawel', 'Prezes', 'Prezes', null, 'prezes@arbor.local', '+48500001001', 'Zarzad'],
      ['demo_dyrektor', 'Anna', 'Kowalska', 'Dyrektor', krakow, 'dyrektor@arbor.local', '+48500001002', 'Dyrektor operacyjny'],
      ['demo_kierownik_krk', 'Jan', 'Nowak', 'Kierownik', krakow, 'kierownik.krk@arbor.local', '+48500001003', 'Kierownik oddzialu Krakow'],
      ['demo_specjalista', 'Ola', 'Biuro', 'Specjalista', krakow, 'specjalista@arbor.local', '+48500001004', 'Specjalista sprzedazy'],
      ['demo_wyceniajacy_krk', 'Oleg', 'Krakowski', ROLE_ESTIMATOR, krakow, 'wycena.krk@arbor.local', '+48500001005', 'Wyceniajacy terenowy'],
      ['demo_brygadzista_krk', 'Marek', 'Zielony', 'Brygadzista', krakow, 'brygadzista.krk@arbor.local', '+48500001006', 'Brygadzista'],
      ['demo_pomocnik_krk', 'Piotr', 'Pilarz', 'Pomocnik', krakow, 'pomocnik.krk@arbor.local', '+48500001007', 'Arborysta'],
      ['demo_brygadzista_dab', 'Tomasz', 'Dab', 'Brygadzista', krakow, 'dab@arbor.local', '+48500001008', 'Brygadzista'],
      ['demo_wyceniajacy_poz', 'Yulia', 'Poznanska', ROLE_ESTIMATOR, poznan, 'wycena.poz@arbor.local', '+48500001009', 'Wyceniajacy terenowy'],
      ['demo_brygadzista_poz', 'Adam', 'Warta', 'Brygadzista', poznan, 'brygadzista.poz@arbor.local', '+48500001010', 'Brygadzista'],
    ];
    for (const [login, imie, nazwisko, rola, oddzial_id, email, telefon, stanowisko] of userRows) {
      users[login] = await ensureUser(client, hash, {
        login,
        imie,
        nazwisko,
        rola,
        oddzial_id,
        email,
        telefon,
        stanowisko,
        stawka_godzinowa: rola === 'Pomocnik' ? 35 : 55,
      });
    }

    await client.query(`UPDATE branches SET kierownik_id=$1, kierownik_fk=$1 WHERE id=$2`, [users.demo_kierownik_krk, krakow]).catch(() => {});

    const krakowTeam = await ensureTeam(client, { nazwa: 'Demo Zaloga Zielona', oddzial_id: krakow, brygadzista_id: users.demo_brygadzista_krk });
    const dabTeam = await ensureTeam(client, { nazwa: 'Demo Zaloga Dab', oddzial_id: krakow, brygadzista_id: users.demo_brygadzista_dab });
    const poznanTeam = await ensureTeam(client, { nazwa: 'Demo Poznan Alfa', oddzial_id: poznan, brygadzista_id: users.demo_brygadzista_poz });
    await addTeamMember(client, krakowTeam, users.demo_brygadzista_krk);
    await addTeamMember(client, krakowTeam, users.demo_pomocnik_krk);
    await addTeamMember(client, dabTeam, users.demo_brygadzista_dab);
    await addTeamMember(client, poznanTeam, users.demo_brygadzista_poz);

    await client.query(
      `INSERT INTO delegacje (zasob_typ, ekipa_id, oddzial_z, oddzial_do, data_od, data_do, cel, uwagi, dodal_id, status)
       VALUES ('ekipa',$1,$2,$3,$4,$5,$6,$7,$8,'Planowana')`,
      [krakowTeam, krakow, poznan, pgDate(2), pgDate(4), 'Wsparcie przy duzym zleceniu pokazowym', MARKER, users.demo_dyrektor]
    ).catch(() => {});

    await insertFleet(client, { krakow, poznan, krakowTeam, dabTeam, poznanTeam });

    const clients = {};
    const clientRows = [
      ['c1', 'Anna', 'Nowak', null, '+48510100101', 'anna.nowak@example.com', 'ul. Debowa 3', 'Krakow', '30-015', 'Klient prywatny, szybka decyzja po ogledzinach.'],
      ['c2', null, null, 'Wspolnota Zielona 12', '+48510100102', 'zarzad@zielona12.local', 'ul. Zielona 12', 'Krakow', '30-020', 'Wspolnota, wymagane zdjecia przed/po i jasny zakres.'],
      ['c3', null, null, 'Park Logistyczny Warta', '+48510100103', 'biuro@warta.local', 'ul. Magazynowa 4', 'Poznan', '60-101', 'Duzy klient B2B, planowanie ekipy i sprzetu.'],
      ['c4', null, null, 'UM Krakow - Zarzad Zieleni', '+48510100104', 'zzm@krakow.local', 'al. Lipowa 7', 'Krakow', '31-001', 'Przetarg miejski, wysoka wartosc.'],
      ['c5', 'Marta', 'Wisniewska', null, '+48510100105', 'marta@example.com', 'ul. Sadowa 6', 'Krakow', '30-140', 'Lead z telefonu, czeka na termin ogledzin.'],
    ];
    for (const [key, imie, nazwisko, firma, telefon, email, adres, miasto, kod, notatki] of clientRows) {
      clients[key] = await ensureClient(client, {
        imie,
        nazwisko,
        firma,
        telefon,
        email,
        adres,
        miasto,
        kod_pocztowy: kod,
        notatki,
        zrodlo: 'telefon',
        created_by: users.demo_specjalista,
      });
    }

    await insertCrmLead(client, {
      title: 'Telefon: nowy klient - ul. Sadowa 6',
      oddzial_id: krakow,
      client_id: clients.c5,
      owner_user_id: users.demo_specjalista,
      stage: 'Lead',
      source: 'telefon',
      value: 2800,
      phone: '+48510100105',
      notes: 'Specjalista wpisal zgloszenie, trzeba umowic ogledziny.',
      next_action_at: pgTimestamp(0, 14),
      created_by: users.demo_specjalista,
    });

    const inspectionAccepted = await insertInspection(client, {
      klient_id: clients.c1,
      brygadzista_id: users.demo_wyceniajacy_krk,
      data_planowana: pgTimestamp(-1, 11),
      status: 'Zakonczone',
      adres: 'ul. Debowa 3',
      miasto: 'Krakow',
      notatki: 'Wyceniacz byl u klienta, klient zaakceptowal zakres na miejscu.',
      notatki_wyniki: `Zakres: wycinka brzozy przy ogrodzeniu, frezowanie pnia, wywoz galezi.\nRyzyko: blisko plot i przewod ogrodowy.\n${MARKER}`,
      created_by: users.demo_specjalista,
      events: [
        { user_id: users.demo_wyceniajacy_krk, event_type: 'start', lat: 50.0614, lng: 19.9366, note: 'Start ogledzin, klient na miejscu.', recorded_at: pgTimestamp(-1, 11) },
        { user_id: users.demo_wyceniajacy_krk, event_type: 'done', lat: 50.0614, lng: 19.9366, note: 'Klient akceptuje budzet 2400 zl.', recorded_at: pgTimestamp(-1, 11, 35) },
      ],
      media: [{ url: img('Ogledziny Debowa - szkic ciecia'), kind: 'photo' }],
    });
    await insertInspection(client, {
      klient_id: clients.c5,
      brygadzista_id: users.demo_wyceniajacy_krk,
      data_planowana: pgTimestamp(0, 15),
      status: 'Zaplanowane',
      adres: 'ul. Sadowa 6',
      miasto: 'Krakow',
      notatki: 'Nowy telefon z biura. Trzeba obejrzec dwie tuje i dojazd.',
      created_by: users.demo_specjalista,
    });
    await insertInspection(client, {
      klient_id: clients.c2,
      brygadzista_id: users.demo_wyceniajacy_krk,
      data_planowana: pgTimestamp(0, 9),
      status: 'W_Trakcie',
      adres: 'ul. Zielona 12',
      miasto: 'Krakow',
      notatki: 'Wspolnota potrzebuje dokumentacji foto, klient czeka na miejscu.',
      created_by: users.demo_specjalista,
      events: [
        { user_id: users.demo_wyceniajacy_krk, event_type: 'start', lat: 50.058, lng: 19.94, note: 'Na miejscu, trwa dokumentacja zdjeciowa.', recorded_at: pgTimestamp(0, 9, 5) },
      ],
      media: [{ url: img('Ogledziny Zielona 12 - drzewo A'), kind: 'photo' }],
    });

    const q1 = await insertQuotation(client, {
      external_id: 'ARBOR-DEMO-Q-001',
      wyceniajacy_id: users.demo_wyceniajacy_krk,
      oddzial_id: krakow,
      klient_nazwa: 'Anna Nowak',
      klient_telefon: '+48510100101',
      klient_email: 'anna.nowak@example.com',
      adres: 'ul. Debowa 3',
      miasto: 'Krakow',
      lat: 50.0614,
      lng: 19.9366,
      notes: 'Oferta po ogledzinach. Klient zaakceptowal na miejscu.',
      status: 'Zaakceptowana',
      visit_started_at: pgTimestamp(-1, 11),
      visit_ended_at: pgTimestamp(-1, 11, 35),
      czas_wizyty_minuty: 35,
      wartosc_sugerowana: 2300,
      wartosc_zaproponowana: 2400,
      marza_pct: 31.5,
      koszt_wlasny_calkowity: 1640,
      data_wizyty_planowana: pgTimestamp(-1, 11),
      waznosc_do: pgTimestamp(7, 23),
      client_acceptance_token: 'demo-accepted-001',
      wyslano_klientowi_at: pgTimestamp(-1, 12),
      klient_akceptacja_at: pgTimestamp(-1, 12, 10),
      created_by: users.demo_specjalista,
      items: [
        {
          gatunek: 'brzoza',
          wysokosc_pas: '10-15',
          piersnica_pas: '30-40',
          typ_pracy: 'wycinka pelna',
          warunki_dojazdu: 'ogrod, waska brama',
          przeszkody: ['plot', 'rabata'],
          wymagane_uprawnienia: ['pilarka', 'praca na wysokosci'],
          czas_planowany_min: 150,
          wymagany_sprzet: 'Pilarka, lina, frezarka, rebak',
          koszt_wlasny: 1640,
          cena_pozycji: 2400,
        },
      ],
      photos: [{ original_url: img('Wycena Debowa - zaznaczone drzewo') }],
    });

    const q2 = await insertQuotation(client, {
      external_id: 'ARBOR-DEMO-Q-002',
      wyceniajacy_id: users.demo_wyceniajacy_krk,
      oddzial_id: krakow,
      klient_nazwa: 'Wspolnota Zielona 12',
      klient_telefon: '+48510100102',
      klient_email: 'zarzad@zielona12.local',
      adres: 'ul. Zielona 12',
      miasto: 'Krakow',
      lat: 50.058,
      lng: 19.94,
      notes: 'Wycena w toku, biuro widzi live status i zdjecia.',
      status: 'Draft',
      visit_started_at: pgTimestamp(0, 9, 5),
      czas_wizyty_minuty: 20,
      wartosc_sugerowana: 6200,
      wartosc_zaproponowana: 6500,
      marza_pct: 28,
      koszt_wlasny_calkowity: 4680,
      data_wizyty_planowana: pgTimestamp(0, 9),
      created_by: users.demo_specjalista,
      items: [
        {
          gatunek: 'dab',
          wysokosc_pas: '15-20',
          piersnica_pas: '50-60',
          typ_pracy: 'redukcja korony',
          warunki_dojazdu: 'parking wspolnoty',
          przeszkody: ['samochody', 'lampy'],
          wymagane_uprawnienia: ['alpinista'],
          czas_planowany_min: 240,
          wymagany_sprzet: 'Podnosnik 20m, rebak, pachołki',
          koszt_wlasny: 4680,
          cena_pozycji: 6500,
        },
      ],
      photos: [{ original_url: img('Wycena Zielona - szkic redukcji') }],
    });

    const tasks = [];
    tasks.push(await insertTask(client, {
      klient_nazwa: 'Marta Wisniewska',
      klient_telefon: '+48510100105',
      klient_email: 'marta@example.com',
      adres: 'ul. Sadowa 6',
      miasto: 'Krakow',
      typ_uslugi: 'Ogledziny / wycena',
      opis: 'Klient dzwoni do biura. Specjalista tworzy zgloszenie i termin ogledzin.',
      data_planowana: pgTimestamp(0, 15),
      priorytet: 'Normalny',
      status: 'Nowe',
      wartosc_planowana: 0,
      oddzial_id: krakow,
      kierownik_id: users.demo_kierownik_krk,
      wyceniajacy_id: users.demo_wyceniajacy_krk,
      notatki_wewnetrzne: 'ETAP 1: telefon z biura. Do przypisania/ogledzin.',
      notatki_klienta: 'Prosba o szybka wycene dwoch tuj i sprzatanie.',
      czas_planowany_godziny: 0.5,
      pin_lat: 50.064,
      pin_lng: 19.945,
      photos: [{ user_id: users.demo_specjalista, typ: 'Telefon', url: img('Telefon - nowy lead Sadowa'), opis: 'Notatka z telefonu od klienta.', tagi: ['telefon', 'lead'] }],
      contact: { status: 'todo', note: 'Potwierdzic SMS godzine ogledzin.', due_at: pgTimestamp(0, 13), updated_by: users.demo_specjalista },
    }));
    tasks.push(await insertTask(client, {
      klient_nazwa: 'Wspolnota Zielona 12',
      klient_telefon: '+48510100102',
      klient_email: 'zarzad@zielona12.local',
      adres: 'ul. Zielona 12',
      miasto: 'Krakow',
      typ_uslugi: 'Redukcja korony',
      opis: 'Wyceniacz jest w terenie, robi zdjecia i szkic zakresu.',
      data_planowana: pgTimestamp(0, 9),
      priorytet: 'Wysoki',
      status: 'Wycena_Terenowa',
      wartosc_planowana: 6500,
      oddzial_id: krakow,
      kierownik_id: users.demo_kierownik_krk,
      wyceniajacy_id: users.demo_wyceniajacy_krk,
      notatki_wewnetrzne: 'ETAP 2: wycena terenowa. Biuro widzi zdjecia i status live.',
      notatki_klienta: 'Wspolnota chce dokumentacje foto przed zgoda.',
      czas_planowany_godziny: 4,
      pin_lat: 50.058,
      pin_lng: 19.94,
      source_quotation_id: q2,
      photos: [
        { user_id: users.demo_wyceniajacy_krk, typ: 'Przed', url: img('Przed - Zielona 12'), opis: 'Drzewo od strony parkingu.', tagi: ['przed', 'parking'] },
        { user_id: users.demo_wyceniajacy_krk, typ: 'Szkic', url: img('Szkic - linie ciecia'), opis: 'Zakres redukcji zaznaczony na zdjeciu.', tagi: ['szkic', 'zakres'] },
      ],
      contact: { status: 'waiting', note: 'Czekamy na akceptacje zarzadu wspolnoty.', due_at: pgTimestamp(1, 10), updated_by: users.demo_specjalista },
    }));
    const acceptedTask = await insertTask(client, {
      klient_nazwa: 'Anna Nowak',
      klient_telefon: '+48510100101',
      klient_email: 'anna.nowak@example.com',
      adres: 'ul. Debowa 3',
      miasto: 'Krakow',
      typ_uslugi: 'Wycinka brzozy + frezowanie',
      opis: 'Klient zaakceptowal zakres u wyceniacza. Biuro ma tylko dopiac termin, ekipe i sprzet.',
      data_planowana: pgTimestamp(1, 8),
      priorytet: 'Wysoki',
      status: 'Do_Zatwierdzenia',
      wartosc_planowana: 2400,
      oddzial_id: krakow,
      kierownik_id: users.demo_kierownik_krk,
      wyceniajacy_id: users.demo_wyceniajacy_krk,
      notatki_wewnetrzne: 'ETAP 3: zaakceptowane przez klienta. Do zatwierdzenia w biurze.\nZakres: wycinka brzozy, frezowanie pnia, wywoz galezi.\nRyzyka: plot, rabata, waska brama.\nSprzet: pilarka, lina, frezarka, rebak.',
      notatki_klienta: 'Klient prosi o start rano.',
      czas_planowany_godziny: 3,
      pin_lat: 50.0614,
      pin_lng: 19.9366,
      source_quotation_id: q1,
      photos: [
        { user_id: users.demo_wyceniajacy_krk, typ: 'Przed', url: img('Debowa - drzewo przed'), opis: 'Widok drzewa od strony ogrodu.', tagi: ['przed'] },
        { user_id: users.demo_wyceniajacy_krk, typ: 'Szkic', url: img('Debowa - szkic ciecia'), opis: 'Kierunek obalenia i zabezpieczenie plotu.', tagi: ['szkic', 'ryzyko'] },
      ],
      contact: { status: 'informed', note: 'Klient potwierdzil akceptacje oferty.', due_at: null, updated_by: users.demo_specjalista },
    });
    tasks.push(acceptedTask);
    await client.query(`UPDATE ogledziny SET task_id=$1 WHERE id=$2`, [acceptedTask, inspectionAccepted]);
    tasks.push(await insertTask(client, {
      klient_nazwa: 'Park Logistyczny Warta',
      klient_telefon: '+48510100103',
      klient_email: 'biuro@warta.local',
      adres: 'ul. Magazynowa 4',
      miasto: 'Poznan',
      typ_uslugi: 'Wycinka i wywoz galezi',
      opis: 'Biuro zaplanowalo ekipe i sprzet. Krakowska ekipa jedzie w delegacje do Poznania.',
      data_planowana: pgTimestamp(2, 8),
      priorytet: 'Normalny',
      status: 'Zaplanowane',
      wartosc_planowana: 12800,
      ekipa_id: krakowTeam,
      brygadzista_id: users.demo_brygadzista_krk,
      oddzial_id: poznan,
      kierownik_id: users.demo_kierownik_krk,
      wyceniajacy_id: users.demo_wyceniajacy_poz,
      notatki_wewnetrzne: 'ETAP 4: zaplanowane. Wykorzystuje delegacje ekipy Krakow -> Poznan.\nSprzet: rebak, dwa busy, pachołki.',
      czas_planowany_godziny: 6,
      pin_lat: 52.406,
      pin_lng: 16.925,
      photos: [{ user_id: users.demo_wyceniajacy_poz, typ: 'Instrukcja', url: img('Poznan - instrukcja dla ekipy'), opis: 'Mapa dojazdu i miejsce ustawienia rebaka.', tagi: ['instrukcja', 'delegacja'] }],
      contact: { status: 'informed', note: 'Klient dostal termin i orientacyjny czas pracy.', due_at: null, updated_by: users.demo_specjalista },
    }));
    tasks.push(await insertTask(client, {
      klient_nazwa: 'UM Krakow - Zarzad Zieleni',
      klient_telefon: '+48510100104',
      klient_email: 'zzm@krakow.local',
      adres: 'al. Lipowa 7',
      miasto: 'Krakow',
      typ_uslugi: 'Prace pielegnacyjne',
      opis: 'Ekipa jest w trakcie. Kierownik widzi start, BHP i dokumentacje.',
      data_planowana: pgTimestamp(0, 8),
      data_rozpoczecia: pgTimestamp(0, 8, 5),
      priorytet: 'Wysoki',
      status: 'W_Realizacji',
      wartosc_planowana: 18900,
      ekipa_id: dabTeam,
      brygadzista_id: users.demo_brygadzista_dab,
      oddzial_id: krakow,
      kierownik_id: users.demo_kierownik_krk,
      wyceniajacy_id: users.demo_wyceniajacy_krk,
      notatki_wewnetrzne: 'ETAP 5: realizacja. BHP potwierdzone, zdjecia przed wykonaniem sa w zleceniu.',
      czas_planowany_godziny: 8,
      pin_lat: 50.052,
      pin_lng: 19.955,
      photos: [{ user_id: users.demo_brygadzista_dab, typ: 'Przed', url: img('Lipowa - start pracy'), opis: 'Strefa prac zabezpieczona.', tagi: ['przed', 'bhp'] }],
      workLog: {
        user_id: users.demo_brygadzista_dab,
        start_time: pgTimestamp(0, 8, 5),
        opis: 'Start pracy, strefa zabezpieczona.',
        status: 'active',
        bhp: [
          { key: 'kaski', label: 'Kaski i srodki ochrony', done: true },
          { key: 'rebak', label: 'Rebak sprawdzony', done: true },
        ],
      },
    }));
    tasks.push(await insertTask(client, {
      klient_nazwa: 'Osiedle Lesne Tarasy',
      klient_telefon: '+48510100106',
      klient_email: 'admin@lesne.local',
      adres: 'ul. Lesna 18',
      miasto: 'Krakow',
      typ_uslugi: 'Wycinka awaryjna',
      opis: 'Zlecenie zakonczone. Widac zdjecia po, platnosc i wartosc netto do rozliczen.',
      data_planowana: pgTimestamp(-2, 8),
      data_rozpoczecia: pgTimestamp(-2, 8, 10),
      data_zakonczenia: pgTimestamp(-2, 12, 25),
      priorytet: 'Wysoki',
      status: 'Zakonczone',
      wartosc_planowana: 5200,
      wartosc_rzeczywista: 5600,
      wartosc_netto_do_rozliczenia: 5600,
      ekipa_id: krakowTeam,
      brygadzista_id: users.demo_brygadzista_krk,
      oddzial_id: krakow,
      kierownik_id: users.demo_kierownik_krk,
      wyceniajacy_id: users.demo_wyceniajacy_krk,
      notatki_wewnetrzne: 'ETAP 6: zakonczone. Komplet: zdjecia przed/po, platnosc, rozliczenie.',
      czas_planowany_godziny: 4,
      pin_lat: 50.07,
      pin_lng: 19.91,
      photos: [
        { user_id: users.demo_wyceniajacy_krk, typ: 'Przed', url: img('Lesne Tarasy - przed'), opis: 'Stan przed praca.', tagi: ['przed'] },
        { user_id: users.demo_brygadzista_krk, typ: 'Po', url: img('Lesne Tarasy - po'), opis: 'Teren uporzadkowany po pracy.', tagi: ['po', 'odbior'] },
      ],
      workLog: {
        user_id: users.demo_brygadzista_krk,
        start_time: pgTimestamp(-2, 8, 10),
        end_time: pgTimestamp(-2, 12, 25),
        duration_hours: 4.25,
        opis: 'Praca zakonczona, teren posprzatany.',
        status: 'completed',
        bhp: [{ key: 'odbior', label: 'Odbior z klientem', done: true }],
      },
      payment: {
        forma_platnosc: 'Przelew',
        kwota_odebrana: 5600,
        faktura_vat: true,
        nip: '6760000000',
        notatki: 'Faktura VAT, platnosc przelewem.',
        recorded_by: users.demo_brygadzista_krk,
      },
    }));

    await client.query('COMMIT');
    console.log('President demo seed complete.');
    console.log(`Branches: Demo Krakow, Demo Poznan`);
    console.log(`Tasks: ${tasks.length}`);
    console.log(`Demo password for all demo_* users: ${DEFAULT_PASSWORD}`);
    console.log('Recommended logins: demo_prezes, demo_dyrektor, demo_specjalista, demo_wyceniajacy_krk, demo_brygadzista_krk');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.end().catch(() => {});
  }
}

run().catch((error) => {
  console.error(`[seed-president-demo] FAILED: ${error.message}`);
  process.exit(1);
});
