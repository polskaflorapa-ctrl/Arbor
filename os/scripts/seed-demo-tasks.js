/**
 * Wstawia kilka przykładowych zleceń do dev/stage (idempotentnie).
 * Konfiguracja DB: scripts/db-connection.js (DATABASE_URL lub DB_HOST / DB_PORT / DB_NAME / …).
 * Marker w notatki_wewnetrzne: __ARBOR_SEED_DEMO_TASKS_v1__
 * SEED_DEMO_REPLACE=1 — usuń wcześniejsze wiersze z tym markerem i wstaw ponownie.
 */
const { Client } = require('pg');
const { getPgClientConfig } = require('./db-connection');

const SEED_MARKER = '__ARBOR_SEED_DEMO_TASKS_v1__';

async function ensureBranchId(client) {
  const r = await client.query(
    `SELECT id FROM branches WHERE COALESCE(aktywny, true) = true ORDER BY id ASC LIMIT 1`
  );
  if (r.rows[0]) return r.rows[0].id;
  const ins = await client.query(`INSERT INTO branches (nazwa) VALUES ($1) RETURNING id`, ['Demo oddział']);
  return ins.rows[0].id;
}

function isoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const run = async () => {
  const client = new Client(getPgClientConfig());

  await client.connect();

  try {
    if (process.env.SEED_DEMO_REPLACE === '1') {
      const del = await client.query(
        `DELETE FROM tasks WHERE notatki_wewnetrzne LIKE $1`,
        [`%${SEED_MARKER}%`]
      );
      console.log(`SEED_DEMO_REPLACE: usunięto ${del.rowCount} wierszy demo.`);
    } else {
      const existing = await client.query(
        `SELECT COUNT(*)::int AS c FROM tasks WHERE notatki_wewnetrzne LIKE $1`,
        [`%${SEED_MARKER}%`]
      );
      if (existing.rows[0].c > 0) {
        console.log('Przykładowe zlecenia demo już są w bazie (pomiń lub ustaw SEED_DEMO_REPLACE=1).');
        return;
      }
    }

    const branchId = await ensureBranchId(client);

    let kierownikId = null;
    const smoke = await client.query(`SELECT id FROM users WHERE login = 'smoke_admin' LIMIT 1`);
    if (smoke.rows[0]) kierownikId = smoke.rows[0].id;
    if (!kierownikId) {
      const adm = await client.query(
        `SELECT id FROM users WHERE rola IN ('Administrator','Dyrektor') AND COALESCE(aktywny, true) = true ORDER BY id LIMIT 1`
      );
      kierownikId = adm.rows[0]?.id || null;
    }
    if (!kierownikId) {
      console.error('Brak użytkownika smoke_admin ani Administrator/Dyrektor — uruchom npm run smoke:user.');
      process.exitCode = 1;
      return;
    }

    const teamR = await client.query(
      `SELECT id FROM teams WHERE oddzial_id = $1 AND COALESCE(aktywny, true) = true ORDER BY id LIMIT 1`,
      [branchId]
    );
    const ekipaId = teamR.rows[0]?.id || null;

    const base = new Date();
    const dMinus1 = new Date(base);
    dMinus1.setDate(dMinus1.getDate() - 1);
    const dPlus1 = new Date(base);
    dPlus1.setDate(dPlus1.getDate() + 1);

    const d0 = isoDate(base);
    const dm1 = isoDate(dMinus1);
    const dp1 = isoDate(dPlus1);

    const notatki = (extra) => `${extra}\n${SEED_MARKER}`;

    const rows = [
      {
        klient_nazwa: 'Zakład Usług Leśnych Kowalski',
        klient_telefon: '+48 601 100 100',
        adres: 'ul. Leśna 12',
        miasto: 'Warszawa',
        typ_uslugi: 'Wycinka',
        priorytet: 'Wysoki',
        wartosc_planowana: 4200,
        czas_planowany_godziny: 4,
        data_planowana: d0,
        status: 'Nowe',
        notatki: notatki('Demo: nowe zlecenie, pilne oględziny.'),
      },
      {
        klient_nazwa: 'Spółdzielnia Mieszkaniowa „Sosnowy Las”',
        klient_telefon: '+48 22 200 20 20',
        adres: 'os. Sosnowe 5A',
        miasto: 'Piaseczno',
        typ_uslugi: 'Pielęgnacja',
        priorytet: 'Normalny',
        wartosc_planowana: 2800,
        czas_planowany_godziny: 2.5,
        data_planowana: dp1,
        status: 'Zaplanowane',
        notatki: notatki('Demo: zaplanowane z ekipą.'),
      },
      {
        klient_nazwa: 'Gmina Przykładowo',
        klient_telefon: '+48 58 300 30 00',
        adres: 'pl. Rynku 1',
        miasto: 'Przykładowo',
        typ_uslugi: 'Wycinka',
        priorytet: 'Normalny',
        wartosc_planowana: 15000,
        czas_planowany_godziny: 8,
        data_planowana: d0,
        status: 'W_Realizacji',
        notatki: notatki('Demo: w realizacji — duży obszar.'),
      },
      {
        klient_nazwa: 'Prywatny — Anna Nowak',
        klient_telefon: '+48 512 555 111',
        adres: 'ul. Dębowa 3',
        miasto: 'Grodzisk Mazowiecki',
        typ_uslugi: 'Wycinka',
        priorytet: 'Niski',
        wartosc_planowana: 1900,
        czas_planowany_godziny: 2,
        data_planowana: dm1,
        status: 'Zakonczone',
        notatki: notatki('Demo: zakończone (archiwum listy).'),
      },
      {
        klient_nazwa: 'Developer Test Sp. z o.o.',
        klient_telefon: '+48 600 000 007',
        adres: 'ul. Testowa 7',
        miasto: 'Warszawa',
        typ_uslugi: 'Inwentaryzacja',
        priorytet: 'Normalny',
        wartosc_planowana: 3500,
        czas_planowany_godziny: 3,
        data_planowana: dp1,
        status: 'Nowe',
        notatki: notatki('Demo: inwentaryzacja przed wycinką.'),
      },
    ];

    const insertSql = `
      INSERT INTO tasks (
        klient_nazwa, klient_telefon, adres, miasto,
        typ_uslugi, priorytet, wartosc_planowana,
        czas_planowany_godziny, data_planowana,
        notatki_wewnetrzne, status, kierownik_id,
        oddzial_id, ekipa_id, wyceniajacy_id, pin_lat, pin_lng, ankieta_uproszczona
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::date,$10,$11,$12,$13,$14,NULL,NULL,NULL,false)
    `;

    for (const r of rows) {
      await client.query(insertSql, [
        r.klient_nazwa,
        r.klient_telefon,
        r.adres,
        r.miasto,
        r.typ_uslugi,
        r.priorytet,
        r.wartosc_planowana,
        r.czas_planowany_godziny,
        r.data_planowana,
        r.notatki,
        r.status,
        kierownikId,
        branchId,
        ekipaId,
      ]);
    }

    console.log(`Wstawiono ${rows.length} przykładowych zleceń (oddział_id=${branchId}, ekipa_id=${ekipaId ?? 'NULL'}).`);
  } finally {
    await client.end();
  }
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
