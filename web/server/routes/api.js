const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { readOnly, withStore } = require('../lib/store');
const { requireAuth, publicUser, signUser } = require('../lib/auth');
const { canViewCmr, enrichCmr } = require('../lib/cmrAccess');

const router = express.Router();
const UPLOAD_ROOT = path.join(__dirname, '..', 'uploads', 'wyceny');
const KOMMO_WEBHOOK_URL =
  (process.env.KOMMO_WEBHOOK_URL || process.env.KOMMO_CMR_WEBHOOK_URL || '').trim();
/** Osobny URL dla pushy CRM (zlecenie / klient). Gdy pusty — używany jest KOMMO_WEBHOOK_URL. */
const KOMMO_CRM_WEBHOOK_URL = (process.env.KOMMO_CRM_WEBHOOK_URL || '').trim();

router.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'arbor-api-local',
    mode: 'file-db',
    crm: { overview: true },
  });
});

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function toNum(v) {
  if (v === '' || v === undefined || v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseCsvStrings(v) {
  if (!v) return [];
  return String(v)
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

const KOMMO_WEBHOOK_SECRET_HEADER = (process.env.KOMMO_WEBHOOK_SECRET_HEADER || '').trim();
const KOMMO_WEBHOOK_SECRET = (process.env.KOMMO_WEBHOOK_SECRET || '').trim();
const KOMMO_PIPELINE_ID = toNum(process.env.KOMMO_PIPELINE_ID);
const KOMMO_STATUS_ID = toNum(process.env.KOMMO_STATUS_ID);
const KOMMO_RESPONSIBLE_USER_ID = toNum(process.env.KOMMO_RESPONSIBLE_USER_ID);
const KOMMO_TAGS = parseCsvStrings(process.env.KOMMO_TAGS || 'CMR,Arbor');
const KOMMO_CF_CMR_NUMBER_ID = toNum(process.env.KOMMO_CF_CMR_NUMBER_ID);
const KOMMO_CF_ORDER_ID = toNum(process.env.KOMMO_CF_ORDER_ID);
/** Oddział w Kommo = z powiązanego zlecenia (task), nie z rekordu CMR. */
const KOMMO_CF_BRANCH_ID = toNum(process.env.KOMMO_CF_BRANCH_ID);
const KOMMO_CF_PLATE_ID = toNum(process.env.KOMMO_CF_PLATE_ID);
const KOMMO_CF_DRIVER_ID = toNum(process.env.KOMMO_CF_DRIVER_ID);
const KOMMO_CF_STATUS_ID = toNum(process.env.KOMMO_CF_STATUS_ID);
const KOMMO_CF_LOAD_DATE_ID = toNum(process.env.KOMMO_CF_LOAD_DATE_ID);
const KOMMO_CF_UNLOAD_DATE_ID = toNum(process.env.KOMMO_CF_UNLOAD_DATE_ID);
const KOMMO_CF_GOODS_SUMMARY_ID = toNum(process.env.KOMMO_CF_GOODS_SUMMARY_ID);
/** ID rekordu klienta w ARBOR — pole leada w Kommo (opcjonalnie). */
const KOMMO_CF_KLIENT_RECORD_ID = toNum(process.env.KOMMO_CF_KLIENT_RECORD_ID);
/** Telefon kontaktu — dla zlecenia / klienta (opcjonalnie). */
const KOMMO_CF_PHONE_ID = toNum(process.env.KOMMO_CF_PHONE_ID);
const KOMMO_CRM_TAGS = parseCsvStrings(process.env.KOMMO_CRM_TAGS || 'Arbor,CRM');

function userName(state, id) {
  if (!id) return null;
  const u = state.users.find((x) => x.id === id);
  return u ? `${u.imie} ${u.nazwisko}` : null;
}

function enrichWycena(state, z) {
  const wyceniajacy_nazwa = userName(state, z.created_by);
  const ekipa = state.teams.find((t) => t.id === z.ekipa_id);
  const zatwierdzone_przez_nazwa = userName(state, z.zatwierdzone_przez);
  const oddzial = (state.oddzialy || []).find((o) => o.id === z.oddzial_id);
  return {
    ...z,
    wyceniajacy_nazwa,
    ekipa_nazwa: ekipa?.nazwa || null,
    zatwierdzone_przez_nazwa,
    oddzial_nazwa: oddzial?.nazwa || null,
    kierownik_nazwa: userName(state, z.kierownik_id),
  };
}

function canSeeAllZlecenia(user) {
  return user?.rola === 'Administrator' || user?.rola === 'Dyrektor';
}

function visibleZlecenia(state, user) {
  const rows = state.zlecenia || [];
  if (canSeeAllZlecenia(user)) return rows;
  if (user.rola === 'Kierownik') return rows.filter((z) => String(z.oddzial_id) === String(user.oddzial_id));
  if (['Brygadzista', 'Pomocnik', 'Pomocnik bez doświadczenia'].includes(user.rola) && user.ekipa_id) {
    return rows.filter((z) => String(z.ekipa_id) === String(user.ekipa_id));
  }
  if (user.oddzial_id != null) return rows.filter((z) => String(z.oddzial_id) === String(user.oddzial_id));
  return rows;
}

function canUserViewZlecenie(state, user, taskId) {
  const z = state.zlecenia.find((x) => x.id === taskId);
  if (!z) return false;
  if (canSeeAllZlecenia(user)) return true;
  return visibleZlecenia(state, user).some((x) => x.id === taskId);
}

const TASK_PUT_NUM = new Set([
  'ekipa_id',
  'oddzial_id',
  'kierownik_id',
  'czas_planowany_godziny',
  'wartosc_planowana',
  'dodatkowe_uslugi_liczba',
  'bony_liczba',
]);

function parseAdnotacje(body) {
  const raw = body.zdjecia_adnotowane_json;
  if (!raw || typeof raw !== 'string') return null;
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return null;
    return arr.slice(0, 3);
  } catch {
    return null;
  }
}

// ── Auth (demo) ─────────────────────────────────────────────
router.post('/auth/login', (req, res) => {
  const { login, haslo } = req.body || {};
  if (!login || !haslo) return res.status(400).json({ error: 'Login i hasło są wymagane' });
  const state = readOnly((s) => s);
  const u = state.users.find((x) => x.login === login);
  if (!u || u.haslo !== haslo) {
    return res.status(401).json({ error: 'Nieprawidłowy login lub hasło' });
  }
  const token = signUser(u);
  res.json({ token, user: publicUser(u) });
});

// ── Wyceny ──────────────────────────────────────────────────
router.get('/wyceny', requireAuth, (req, res) => {
  try {
    const { status_akceptacji, oddzial_id } = req.query;
    const rows = readOnly((st) => {
      let list = st.zlecenia.filter((z) => z.typ === 'wycena');
      if (status_akceptacji) list = list.filter((z) => z.status_akceptacji === status_akceptacji);
      if (oddzial_id) list = list.filter((z) => String(z.oddzial_id) === String(oddzial_id));
      return list
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .slice(0, 300)
        .map((z) => enrichWycena(st, z));
    });
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/wyceny', requireAuth, (req, res) => {
  try {
    const b = req.body || {};
    const zdjecia = parseAdnotacje(b);
    const row = withStore((state) => {
      const id = state.nextZlecenieId++;
      const now = new Date().toISOString();
      const z = {
        id,
        typ: 'wycena',
        status: 'Nowe',
        status_akceptacji: 'oczekuje',
        klient_nazwa: b.klient_nazwa || null,
        adres: b.adres,
        miasto: b.miasto || null,
        oddzial_id: toNum(b.oddzial_id),
        ekipa_id: toNum(b.ekipa_id),
        typ_uslugi: b.typ_uslugi || null,
        data_wykonania: b.data_wykonania || null,
        godzina_rozpoczecia: b.godzina_rozpoczecia || null,
        czas_planowany_godziny: toNum(b.czas_planowany_godziny),
        wartosc_planowana: toNum(b.wartosc_planowana),
        notatki_wewnetrzne: b.notatki_wewnetrzne || null,
        wycena_uwagi: b.wycena_uwagi || null,
        zdjecia_adnotowane: zdjecia,
        created_by: req.user.id,
        wyceniajacy_id: null,
        zatwierdzone_przez: null,
        zatwierdzone_at: null,
        created_at: now,
      };
      state.zlecenia.push(z);
      return enrichWycena(state, z);
    });
    res.status(201).json(row);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/wyceny/:id/zatwierdz', requireAuth, (req, res) => {
  try {
    const id = toNum(req.params.id);
    const b = req.body || {};
    const row = withStore((state) => {
      const z = state.zlecenia.find((x) => x.id === id && x.typ === 'wycena' && x.status_akceptacji === 'oczekuje');
      if (!z) return null;
      z.status_akceptacji = 'zatwierdzono';
      z.zatwierdzone_przez = req.user.id;
      z.zatwierdzone_at = new Date().toISOString();
      z.status = 'Zaplanowane';
      z.typ = 'zlecenie';
      z.wyceniajacy_id = z.wyceniajacy_id ?? z.created_by;
      if (toNum(b.ekipa_id)) z.ekipa_id = toNum(b.ekipa_id);
      if (b.data_wykonania) z.data_wykonania = b.data_wykonania;
      if (b.godzina_rozpoczecia) z.godzina_rozpoczecia = b.godzina_rozpoczecia;
      if (toNum(b.wartosc_planowana) != null) z.wartosc_planowana = toNum(b.wartosc_planowana);
      if (b.uwagi) z.wycena_uwagi = b.uwagi;
      return enrichWycena(state, z);
    });
    if (!row) return res.status(404).json({ error: 'Wycena nie znaleziona lub już rozpatrzona' });
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/wyceny/:id/odrzuc', requireAuth, (req, res) => {
  try {
    const id = toNum(req.params.id);
    const powod = (req.body && req.body.powod) || '';
    const row = withStore((state) => {
      const z = state.zlecenia.find((x) => x.id === id && x.typ === 'wycena');
      if (!z) return null;
      z.status_akceptacji = 'odrzucono';
      z.zatwierdzone_przez = req.user.id;
      z.zatwierdzone_at = new Date().toISOString();
      const add = `[Odrzucono] ${powod}`;
      z.wycena_uwagi = (z.wycena_uwagi ? `${z.wycena_uwagi}\n` : '') + add;
      return enrichWycena(state, z);
    });
    if (!row) return res.status(404).json({ error: 'Nie znaleziono' });
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const disk = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(UPLOAD_ROOT, String(req.params.id));
    ensureDir(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}_${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`);
  },
});
const up = multer({ storage: disk, limits: { fileSize: 250 * 1024 * 1024 } });

router.post('/wyceny/:id/wideo', requireAuth, up.single('wideo'), (req, res) => {
  try {
    const zlecenieId = toNum(req.params.id);
    if (!zlecenieId || !req.file) {
      return res.status(400).json({ error: 'Brak pliku (pole: wideo) lub id' });
    }
    const rel = path.relative(path.join(__dirname, '..'), req.file.path).split(path.sep).join('/');
    withStore((state) => {
      const zid = state.zalaczniki.length ? Math.max(...state.zalaczniki.map((z) => z.id)) + 1 : 1;
      state.zalaczniki.push({
        id: zid,
        zlecenie_id: zlecenieId,
        typ: 'video',
        nazwa_pliku: req.file.originalname,
        sciezka_relatywna: rel,
        rozmiar_bajtow: req.file.size,
        created_at: new Date().toISOString(),
      });
    });
    res.status(201).json({ ok: true, sciezka_relatywna: rel, rozmiar: req.file.size });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/wyceny/:id/zalaczniki', requireAuth, (req, res) => {
  try {
    const id = toNum(req.params.id);
    const list = readOnly((state) =>
      state.zalaczniki.filter((z) => z.zlecenie_id === id).sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    );
    res.json({ zalaczniki: list });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Wynagrodzenie wyceniających ─────────────────────────────
function toInt(v) {
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : null;
}

function canEditUserRules(req, targetUserId) {
  const r = req.user?.rola;
  if (['Dyrektor', 'Administrator', 'Kierownik'].includes(r)) return true;
  if (r === 'Wyceniający' && req.user.id === targetUserId) return true;
  return false;
}

router.get('/wynagrodzenie-wyceniajacy/reguly/:userId', requireAuth, (req, res) => {
  const uid = toInt(req.params.userId);
  if (!uid) return res.status(400).json({ error: 'Nieprawidłowe userId' });
  if (!canEditUserRules(req, uid)) return res.status(403).json({ error: 'Brak uprawnień' });
  const u = readOnly((state) => state.users.find((x) => x.id === uid));
  if (!u) return res.status(404).json({ error: 'Użytkownik nie znaleziony' });
  res.json({
    id: u.id,
    wynagrodzenie_stawka_dzienna_pln: u.wynagrodzenie_stawka_dzienna_pln ?? 0,
    wynagrodzenie_procent_realizacji: u.wynagrodzenie_procent_realizacji ?? 0,
    wynagrodzenie_dodatki_pln: u.wynagrodzenie_dodatki_pln ?? 0,
    wynagrodzenie_dodatki_opis: u.wynagrodzenie_dodatki_opis ?? '',
  });
});

router.put('/wynagrodzenie-wyceniajacy/reguly/:userId', requireAuth, (req, res) => {
  const uid = toInt(req.params.userId);
  if (!uid) return res.status(400).json({ error: 'Nieprawidłowe userId' });
  if (!canEditUserRules(req, uid)) return res.status(403).json({ error: 'Brak uprawnień' });
  const b = req.body || {};
  const row = withStore((state) => {
    const u = state.users.find((x) => x.id === uid);
    if (!u) return null;
    if (b.wynagrodzenie_stawka_dzienna_pln != null) u.wynagrodzenie_stawka_dzienna_pln = Number(b.wynagrodzenie_stawka_dzienna_pln);
    if (b.wynagrodzenie_procent_realizacji != null) u.wynagrodzenie_procent_realizacji = Number(b.wynagrodzenie_procent_realizacji);
    if (b.wynagrodzenie_dodatki_pln != null) u.wynagrodzenie_dodatki_pln = Number(b.wynagrodzenie_dodatki_pln);
    if (b.wynagrodzenie_dodatki_opis !== undefined) u.wynagrodzenie_dodatki_opis = b.wynagrodzenie_dodatki_opis;
    return {
      id: u.id,
      wynagrodzenie_stawka_dzienna_pln: u.wynagrodzenie_stawka_dzienna_pln,
      wynagrodzenie_procent_realizacji: u.wynagrodzenie_procent_realizacji,
      wynagrodzenie_dodatki_pln: u.wynagrodzenie_dodatki_pln,
      wynagrodzenie_dodatki_opis: u.wynagrodzenie_dodatki_opis,
    };
  });
  if (!row) return res.status(404).json({ error: 'Użytkownik nie znaleziony' });
  res.json(row);
});

router.get('/wynagrodzenie-wyceniajacy/podsumowanie', requireAuth, (req, res) => {
  const uid = toInt(req.query.user_id);
  const rok = toInt(req.query.rok) || new Date().getFullYear();
  const miesiac = toInt(req.query.miesiac) || new Date().getMonth() + 1;
  const dniRobocze = toInt(req.query.dni_robocze);
  const dni = dniRobocze == null ? 22 : dniRobocze;

  if (!uid) return res.status(400).json({ error: 'Brak user_id' });
  if (!canEditUserRules(req, uid)) return res.status(403).json({ error: 'Brak uprawnień' });

  const data = readOnly((state) => {
    const u = state.users.find((x) => x.id === uid);
    if (!u) return null;
    const start = new Date(rok, miesiac - 1, 1);
    const end = new Date(rok, miesiac, 0);
    const isoStart = start.toISOString().slice(0, 10);
    const isoEnd = end.toISOString().slice(0, 10);

    let suma = 0;
    for (const z of state.zlecenia) {
      if (z.typ === 'wycena') continue;
      if (!['Zakonczone', 'Zakończone'].includes(z.status)) continue;
      if (Number(z.wyceniajacy_id) !== uid) continue;
      const d = (z.data_wykonania || '').slice(0, 10);
      if (!d || d < isoStart || d > isoEnd) continue;
      suma += parseFloat(z.wartosc_planowana) || 0;
    }
    suma = Math.round(suma * 100) / 100;

    const stawka = parseFloat(u.wynagrodzenie_stawka_dzienna_pln) || 0;
    const proc = parseFloat(u.wynagrodzenie_procent_realizacji) || 0;
    const dod = parseFloat(u.wynagrodzenie_dodatki_pln) || 0;
    const czescDzienna = Math.round(stawka * dni * 100) / 100;
    const czescProcentowa = Math.round(suma * (proc / 100) * 100) / 100;
    const razem = Math.round((czescDzienna + czescProcentowa + dod) * 100) / 100;

    return {
      user: { id: u.id, imie: u.imie, nazwisko: u.nazwisko, rola: u.rola },
      okres: { rok, miesiac, dni_robocze: dni },
      suma_zrealizowanych_pln: suma,
      reguly: {
        wynagrodzenie_stawka_dzienna_pln: stawka,
        wynagrodzenie_procent_realizacji: proc,
        wynagrodzenie_dodatki_pln: dod,
        wynagrodzenie_dodatki_opis: u.wynagrodzenie_dodatki_opis,
      },
      wyliczenie: {
        czesc_dzienna: czescDzienna,
        czesc_procentowa: czescProcentowa,
        dodatki: dod,
        razem,
      },
    };
  });

  if (!data) return res.status(404).json({ error: 'Użytkownik nie znaleziony' });
  res.json(data);
});

// ── Minimalne stuby pod resztę panelu (ten sam plik danych) ──
function stripUser(u) {
  const { haslo, ...rest } = u;
  return rest;
}

router.get('/uzytkownicy', requireAuth, (req, res) => {
  const rolaQ = req.query.rola;
  const list = readOnly((state) => {
    let rows = state.users.map(stripUser);
    if (rolaQ) rows = rows.filter((x) => x.rola === rolaQ);
    return rows;
  });
  res.json(list);
});

router.get('/tasks/wszystkie', requireAuth, (req, res) => {
  const list = readOnly((state) => state.zlecenia.map((z) => enrichWycena(state, z)));
  res.json(list);
});

router.get('/tasks', requireAuth, (req, res) => {
  const list = readOnly((state) => visibleZlecenia(state, req.user).map((z) => enrichWycena(state, z)));
  res.json(list);
});

router.get('/tasks/:id(\\d+)', requireAuth, (req, res) => {
  const id = toNum(req.params.id);
  if (!id) return res.status(400).json({ error: 'Nieprawidłowe id' });
  const row = readOnly((state) => {
    if (!canUserViewZlecenie(state, req.user, id)) return null;
    const z = state.zlecenia.find((x) => x.id === id);
    return z ? enrichWycena(state, z) : null;
  });
  if (!row) return res.status(404).json({ error: 'Nie znaleziono' });
  res.json(row);
});

router.put('/tasks/:id(\\d+)', requireAuth, (req, res) => {
  const id = toNum(req.params.id);
  const b = req.body || {};
  if (!id) return res.status(400).json({ error: 'Nieprawidłowe id' });
  const row = withStore((state) => {
    if (!canUserViewZlecenie(state, req.user, id)) return null;
    const z = state.zlecenia.find((x) => x.id === id);
    if (!z) return null;
    const mergeKeys = Object.keys(b).filter((k) => k !== 'id' && !String(k).endsWith('_nazwa'));
    for (const k of mergeKeys) {
      if (b[k] === undefined) continue;
      if (TASK_PUT_NUM.has(k)) {
        if (k === 'dodatkowe_uslugi_liczba' || k === 'bony_liczba') {
          const n = parseInt(String(b[k]), 10);
          z[k] = Number.isFinite(n) && n >= 0 ? n : 0;
        } else {
          const n = toNum(b[k]);
          z[k] = n ?? b[k];
        }
      } else {
        z[k] = b[k];
      }
    }
    if (b.data_planowana || b.data_wykonania) {
      if (b.data_planowana) z.data_planowana = b.data_planowana;
      if (b.data_wykonania) z.data_wykonania = b.data_wykonania;
    }
    return enrichWycena(state, z);
  });
  if (!row) return res.status(404).json({ error: 'Nie znaleziono lub brak dostępu' });
  res.json(row);
});

router.get('/tasks/stats', requireAuth, (_req, res) => {
  const stats = readOnly((state) => {
    const z = state.zlecenia.filter((x) => x.typ !== 'wycena');
    const nowe = z.filter((x) => x.status === 'Nowe').length;
    const w_realizacji = z.filter((x) => x.status === 'W_Realizacji' || x.status === 'W realizacji').length;
    const zakonczone = z.filter((x) => x.status === 'Zakonczone' || x.status === 'Zakończone').length;
    return { nowe, w_realizacji, zakonczone };
  });
  res.json(stats);
});

function buildKommoTaskPayload(row, actor = null) {
  const client = toCompactText(row.klient_nazwa);
  const leadName = ['Zlecenie', `#${row.id}`, client].filter(Boolean).join(' · ');
  const addr = [toCompactText(row.adres), toCompactText(row.miasto)].filter(Boolean).join(', ');
  const customFields = [
    customField(KOMMO_CF_ORDER_ID, row.id),
    customField(KOMMO_CF_BRANCH_ID, row.oddzial_id ?? null),
    customField(KOMMO_CF_STATUS_ID, toCompactText(row.status)),
    customField(KOMMO_CF_LOAD_DATE_ID, toIsoDateStart(row.data_planowana)),
    customField(KOMMO_CF_PHONE_ID, toCompactText(row.klient_telefon)),
    customField(KOMMO_CF_GOODS_SUMMARY_ID, toCompactText(row.typ_uslugi)),
  ].filter(Boolean);
  const tags = KOMMO_CRM_TAGS.map((name) => ({ name }));
  return {
    source: 'arbor-web-local',
    event: 'task.sync',
    sent_at: new Date().toISOString(),
    integration: { provider: 'kommo', version: '1' },
    actor: actor || null,
    kommo: {
      lead: {
        name: leadName || `Zlecenie ${row.id}`,
        external_id: `task:${row.id}`,
        pipeline_id: KOMMO_PIPELINE_ID ?? undefined,
        status_id: KOMMO_STATUS_ID ?? undefined,
        responsible_user_id: KOMMO_RESPONSIBLE_USER_ID ?? undefined,
        custom_fields_values: customFields.length ? customFields : undefined,
        _embedded: tags.length ? { tags } : undefined,
      },
    },
    task: {
      id: row.id,
      status: row.status,
      typ_uslugi: toCompactText(row.typ_uslugi),
      priorytet: toCompactText(row.priorytet),
      klient_nazwa: client,
      klient_telefon: toCompactText(row.klient_telefon),
      klient_email: toCompactText(row.klient_email),
      adres: addr || null,
      oddzial_id: row.oddzial_id ?? null,
      data_planowana: toCompactText(row.data_planowana),
      wartosc_planowana: row.wartosc_planowana ?? null,
      notatki_wewnetrzne: toCompactText(row.notatki_wewnetrzne),
      sync_meta: {
        last_sync_at: row.kommo_last_sync_at || null,
        last_sync_status: row.kommo_last_sync_status || null,
      },
    },
  };
}

function buildKommoKlientPayload(row, actor = null) {
  const namePerson = [toCompactText(row.imie), toCompactText(row.nazwisko)].filter(Boolean).join(' ');
  const leadName = row.firma
    ? `${toCompactText(row.firma)} · ${namePerson || 'Klient'}`
    : namePerson || `Klient #${row.id}`;
  const customFields = [
    customField(KOMMO_CF_KLIENT_RECORD_ID, row.id),
    customField(KOMMO_CF_PHONE_ID, toCompactText(row.telefon)),
    customField(KOMMO_CF_STATUS_ID, toCompactText(row.zrodlo)),
  ].filter(Boolean);
  const tags = KOMMO_CRM_TAGS.map((name) => ({ name }));
  const addr = [toCompactText(row.adres), toCompactText(row.miasto)].filter(Boolean).join(', ');
  return {
    source: 'arbor-web-local',
    event: 'klient.sync',
    sent_at: new Date().toISOString(),
    integration: { provider: 'kommo', version: '1' },
    actor: actor || null,
    kommo: {
      lead: {
        name: leadName,
        external_id: `klient:${row.id}`,
        pipeline_id: KOMMO_PIPELINE_ID ?? undefined,
        status_id: KOMMO_STATUS_ID ?? undefined,
        responsible_user_id: KOMMO_RESPONSIBLE_USER_ID ?? undefined,
        custom_fields_values: customFields.length ? customFields : undefined,
        _embedded: tags.length ? { tags } : undefined,
      },
    },
    klient: {
      id: row.id,
      imie: toCompactText(row.imie),
      nazwisko: toCompactText(row.nazwisko),
      firma: toCompactText(row.firma),
      telefon: toCompactText(row.telefon),
      email: toCompactText(row.email),
      adres: addr || null,
      zrodlo: toCompactText(row.zrodlo),
      notatki: toCompactText(row.notatki),
      sync_meta: {
        last_sync_at: row.kommo_last_sync_at || null,
        last_sync_status: row.kommo_last_sync_status || null,
      },
    },
  };
}

function resolveKommoWebhookUrl(kind /* 'crm' | 'cmr' */) {
  if (kind === 'crm' && KOMMO_CRM_WEBHOOK_URL) return KOMMO_CRM_WEBHOOK_URL;
  return KOMMO_WEBHOOK_URL;
}

function kommoWebhookConfigured(kind) {
  return Boolean(resolveKommoWebhookUrl(kind));
}

async function postKommoWebhook(payload, kind = 'cmr') {
  const url = resolveKommoWebhookUrl(kind);
  const headers = { 'content-type': 'application/json' };
  if (KOMMO_WEBHOOK_SECRET_HEADER && KOMMO_WEBHOOK_SECRET) {
    headers[KOMMO_WEBHOOK_SECRET_HEADER] = KOMMO_WEBHOOK_SECRET;
  }
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  const bodyText = await response.text();
  return { response, bodyText };
}

router.get('/tasks/:id(\\d+)/kommo-payload', requireAuth, (req, res) => {
  const id = toNum(req.params.id);
  const row = readOnly((state) => {
    if (!canUserViewZlecenie(state, req.user, id)) return null;
    const z = state.zlecenia.find((x) => x.id === id);
    return z ? enrichWycena(state, z) : null;
  });
  if (!row) return res.status(404).json({ error: 'Nie znaleziono zlecenia' });
  const payload = buildKommoTaskPayload(row, {
    id: req.user?.id ?? null,
    login: req.user?.login ?? null,
    rola: req.user?.rola ?? null,
  });
  return res.json(payload);
});

router.post('/tasks/:id(\\d+)/kommo-push', requireAuth, async (req, res) => {
  const id = toNum(req.params.id);
  const row = readOnly((state) => {
    if (!canUserViewZlecenie(state, req.user, id)) return null;
    const z = state.zlecenia.find((x) => x.id === id);
    return z ? enrichWycena(state, z) : null;
  });
  if (!row) return res.status(404).json({ error: 'Nie znaleziono zlecenia' });
  if (!kommoWebhookConfigured('crm')) {
    return res.status(400).json({
      error:
        'Brak konfiguracji webhooka Kommo dla CRM. Ustaw KOMMO_CRM_WEBHOOK_URL lub KOMMO_WEBHOOK_URL.',
    });
  }
  const payload = buildKommoTaskPayload(row, {
    id: req.user?.id ?? null,
    login: req.user?.login ?? null,
    rola: req.user?.rola ?? null,
  });
  const markSync = (next) =>
    withStore((state) => {
      const z = state.zlecenia.find((x) => x.id === id);
      if (!z) return null;
      z.kommo_last_sync_at = new Date().toISOString();
      z.kommo_last_sync_status = next.status || null;
      z.kommo_last_sync_http = next.http ?? null;
      z.kommo_last_sync_error = next.error || null;
      return z;
    });
  try {
    const { response, bodyText } = await postKommoWebhook(payload, 'crm');
    if (!response.ok) {
      markSync({
        status: 'error',
        http: response.status,
        error: `HTTP ${response.status}: ${bodyText.slice(0, 500)}`,
      });
      return res.status(502).json({
        ok: false,
        status: 'error',
        http_status: response.status,
        body: bodyText.slice(0, 500),
      });
    }
    markSync({ status: 'ok', http: response.status, error: null });
    return res.json({ ok: true, status: 'ok', http_status: response.status });
  } catch (err) {
    markSync({ status: 'error', http: null, error: err.message || 'network error' });
    return res.status(502).json({
      ok: false,
      status: 'error',
      error: err.message || 'Nie udało się wysłać danych do Kommo',
    });
  }
});

router.get('/notifications', requireAuth, (req, res) => {
  const uid = req.user.id;
  const data = readOnly((state) => {
    const list = (state.notifications || []).filter(
      (n) => n.to_user_id === uid || n.to_user_id == null
    );
    const unread = list.filter((n) => n.status === 'Nowe').length;
    return { notifications: list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)), unread_count: unread };
  });
  res.json(data);
});

function resolveDoKogo(state, doKogo) {
  if (!doKogo) return [];
  const role = String(doKogo).trim();
  const matchRole = (u) => {
    if (u.aktywny === false) return false;
    if (u.rola === role) return true;
    if (role === 'Dyrektor' && u.rola === 'Administrator') return true;
    return false;
  };
  return state.users.filter(matchRole).map((u) => u.id);
}

router.post('/notifications', requireAuth, (req, res) => {
  const b = req.body || {};
  const ids = [];
  withStore((state) => {
    if (!state.notifications) state.notifications = [];
    if (!state.nextNotificationId) state.nextNotificationId = 1;
    const now = new Date().toISOString();
    const typ = b.typ || 'info';
    const tresc = b.tresc || '';
    const taskId = toNum(b.task_id);
    const recipients = [];
    if (b.to_user_id) recipients.push(toNum(b.to_user_id));
    if (b.do_kogo) recipients.push(...resolveDoKogo(state, b.do_kogo));
    const uniq = [...new Set(recipients.filter(Boolean))];
    const targets = uniq.length ? uniq : [1];
    for (const toUid of targets) {
      const id = state.nextNotificationId++;
      const row = {
        id,
        typ,
        tresc,
        task_id: taskId,
        status: 'Nowe',
        od_user_id: req.user.id,
        to_user_id: toUid,
        created_at: now,
      };
      state.notifications.push(row);
      ids.push(row);
    }
  });
  res.status(201).json(ids.length === 1 ? ids[0] : ids);
});

router.put('/notifications/:id/odczytaj', requireAuth, (req, res) => {
  const id = toNum(req.params.id);
  const uid = req.user.id;
  const row = withStore((state) => {
    const n = (state.notifications || []).find((x) => x.id === id);
    if (!n || (n.to_user_id !== uid && n.to_user_id != null)) return null;
    n.status = 'Odczytane';
    return n;
  });
  if (!row) return res.status(404).json({ error: 'Nie znaleziono' });
  res.json(row);
});

router.put('/notifications/odczytaj-wszystkie', requireAuth, (req, res) => {
  const uid = req.user.id;
  withStore((state) => {
    for (const n of state.notifications || []) {
      if (n.to_user_id === uid || n.to_user_id == null) n.status = 'Odczytane';
    }
  });
  res.json({ ok: true });
});

router.delete('/notifications/:id', requireAuth, (req, res) => {
  const id = toNum(req.params.id);
  const uid = req.user.id;
  withStore((state) => {
    const arr = state.notifications || [];
    const idx = arr.findIndex((n) => n.id === id);
    if (idx === -1) return;
    const n = arr[idx];
    if (n.to_user_id != null && n.to_user_id !== uid) return;
    arr.splice(idx, 1);
  });
  res.json({ ok: true });
});

router.get('/ekipy', requireAuth, (_req, res) => {
  const ekipy = readOnly((state) => state.teams || []);
  res.json(ekipy);
});

router.get('/oddzialy', requireAuth, (_req, res) => {
  const oddzialy = readOnly((state) => state.oddzialy || []);
  res.json(oddzialy);
});

router.get('/oddzialy/cele', requireAuth, (req, res) => {
  const rok = toInt(req.query.rok);
  const miesiac = toInt(req.query.miesiac);
  const cele = readOnly((state) => {
    let rows = state.oddzialCeleMiesieczne || [];
    if (rok) rows = rows.filter((x) => Number(x.rok) === rok);
    if (miesiac) rows = rows.filter((x) => Number(x.miesiac) === miesiac);
    return rows;
  });
  res.json(cele);
});

router.post('/oddzialy/cele', requireAuth, (req, res) => {
  const b = req.body || {};
  const oddzialId = toInt(b.oddzial_id);
  const rok = toInt(b.rok);
  const miesiac = toInt(b.miesiac);
  if (!oddzialId || !rok || !miesiac || miesiac < 1 || miesiac > 12) {
    return res.status(400).json({ error: 'Nieprawidłowe dane celu oddziału' });
  }

  const row = withStore((state) => {
    if (!state.oddzialCeleMiesieczne) state.oddzialCeleMiesieczne = [];
    if (!state.nextOddzialCeleMiesieczneId) state.nextOddzialCeleMiesieczneId = 1;

    const plan_zlecen = toNum(b.plan_zlecen) ?? 0;
    const plan_obrotu = toNum(b.plan_obrotu) ?? 0;
    const plan_marzy = toNum(b.plan_marzy) ?? 0;
    const now = new Date().toISOString();

    const existing = state.oddzialCeleMiesieczne.find(
      (x) => Number(x.oddzial_id) === oddzialId && Number(x.rok) === rok && Number(x.miesiac) === miesiac
    );
    if (existing) {
      existing.plan_zlecen = plan_zlecen;
      existing.plan_obrotu = plan_obrotu;
      existing.plan_marzy = plan_marzy;
      existing.updated_at = now;
      existing.updated_by = req.user.id;
      return existing;
    }

    const created = {
      id: state.nextOddzialCeleMiesieczneId++,
      oddzial_id: oddzialId,
      rok,
      miesiac,
      plan_zlecen,
      plan_obrotu,
      plan_marzy,
      created_at: now,
      created_by: req.user.id,
      updated_at: now,
      updated_by: req.user.id,
    };
    state.oddzialCeleMiesieczne.push(created);
    return created;
  });

  res.status(201).json(row);
});

router.get('/oddzialy/sprzedaz', requireAuth, (req, res) => {
  const rok = toInt(req.query.rok);
  const miesiac = toInt(req.query.miesiac);
  const rows = readOnly((state) => {
    let list = state.oddzialSprzedazMiesieczna || [];
    if (rok) list = list.filter((x) => Number(x.rok) === rok);
    if (miesiac) list = list.filter((x) => Number(x.miesiac) === miesiac);
    return list;
  });
  res.json(rows);
});

router.post('/oddzialy/sprzedaz', requireAuth, (req, res) => {
  const b = req.body || {};
  const oddzialId = toInt(b.oddzial_id);
  const rok = toInt(b.rok);
  const miesiac = toInt(b.miesiac);
  if (!oddzialId || !rok || !miesiac || miesiac < 1 || miesiac > 12) {
    return res.status(400).json({ error: 'Nieprawidłowe dane sprzedaży oddziału' });
  }

  const row = withStore((state) => {
    if (!state.oddzialSprzedazMiesieczna) state.oddzialSprzedazMiesieczna = [];
    if (!state.nextOddzialSprzedazMiesiecznaId) state.nextOddzialSprzedazMiesiecznaId = 1;

    const calls_total = toNum(b.calls_total) ?? 0;
    const calls_answered = toNum(b.calls_answered) ?? 0;
    const calls_missed = toNum(b.calls_missed) ?? 0;
    const leads_new = toNum(b.leads_new) ?? 0;
    const meetings_booked = toNum(b.meetings_booked) ?? 0;
    const now = new Date().toISOString();

    const existing = state.oddzialSprzedazMiesieczna.find(
      (x) => Number(x.oddzial_id) === oddzialId && Number(x.rok) === rok && Number(x.miesiac) === miesiac
    );
    if (existing) {
      existing.calls_total = calls_total;
      existing.calls_answered = calls_answered;
      existing.calls_missed = calls_missed;
      existing.leads_new = leads_new;
      existing.meetings_booked = meetings_booked;
      existing.updated_at = now;
      existing.updated_by = req.user.id;
      return existing;
    }

    const created = {
      id: state.nextOddzialSprzedazMiesiecznaId++,
      oddzial_id: oddzialId,
      rok,
      miesiac,
      calls_total,
      calls_answered,
      calls_missed,
      leads_new,
      meetings_booked,
      created_at: now,
      created_by: req.user.id,
      updated_at: now,
      updated_by: req.user.id,
    };
    state.oddzialSprzedazMiesieczna.push(created);
    return created;
  });

  res.status(201).json(row);
});

function taskStageLabel(status) {
  const s = String(status || '').trim();
  if (s === 'Nowe') return 'Lead';
  if (s === 'Zaplanowane') return 'Oferta';
  if (s === 'W_Realizacji') return 'W realizacji';
  if (s === 'Zakonczone' || s === 'Zakończone') return 'Wygrane';
  if (s === 'Anulowane') return 'Przegrane';
  return 'Inne';
}

const CRM_LEAD_STAGES = ['Lead', 'Oferta', 'W realizacji', 'Wygrane', 'Przegrane'];

function normalizeCrmStage(stage) {
  const value = String(stage || '').trim();
  return CRM_LEAD_STAGES.includes(value) ? value : 'Lead';
}

function mapCrmLead(row, state) {
  const client = (state.klienci || []).find((k) => Number(k.id) === Number(row.client_id));
  const owner = (state.users || []).find((u) => Number(u.id) === Number(row.owner_user_id));
  return {
    ...row,
    stage: normalizeCrmStage(row.stage),
    owner_name: owner ? `${owner.imie || ''} ${owner.nazwisko || ''}`.trim() || owner.login || `#${owner.id}` : null,
    client_name: client?.nazwa || null,
  };
}

/** Statyczna ścieżka przed `/crm/leads/:id*`, żeby nic nie „zjadło” segmentu `overview`. */
router.get('/crm/overview', requireAuth, (req, res) => {
  const oddzialId = toInt(req.query.oddzial_id);
  const now = new Date();
  const d30 = new Date(now);
  d30.setDate(d30.getDate() - 30);

  const data = readOnly((state) => {
    const clientsAll = (state.klienci || []).filter((k) => !oddzialId || Number(k.oddzial_id) === oddzialId);
    const tasksAll = (state.zlecenia || [])
      .filter((z) => z.typ !== 'wycena')
      .filter((z) => !oddzialId || Number(z.oddzial_id) === oddzialId);
    const leadsAll = (state.crmLeads || [])
      .filter((l) => !oddzialId || Number(l.oddzial_id) === oddzialId)
      .map((l) => mapCrmLead(l, state));
    const callsAll = (state.callLogs || []).filter((c) => !oddzialId || Number(c.oddzial_id) === oddzialId);
    const callbacksAll = (state.callbackTasks || []).filter((c) => !oddzialId || Number(c.oddzial_id) === oddzialId);

    const clientsNew30 = clientsAll.filter((k) => new Date(k.created_at || 0) >= d30).length;
    const calls30 = callsAll.filter((c) => new Date(c.created_at || 0) >= d30).length;
    const won30 = tasksAll.filter((t) => ['Zakonczone', 'Zakończone'].includes(t.status) && new Date(t.updated_at || t.created_at || 0) >= d30).length;

    const pipelineMap = new Map();
    if (leadsAll.length > 0) {
      for (const lead of leadsAll) {
        const stageName = normalizeCrmStage(lead.stage);
        const prev = pipelineMap.get(stageName) || { stage: stageName, count: 0, value: 0 };
        prev.count += 1;
        prev.value += Number(lead.value || 0);
        pipelineMap.set(stageName, prev);
      }
    } else {
      for (const task of tasksAll) {
        const stageName = taskStageLabel(task.status);
        const prev = pipelineMap.get(stageName) || { stage: stageName, count: 0, value: 0 };
        prev.count += 1;
        prev.value += Number(task.wartosc_planowana || 0);
        pipelineMap.set(stageName, prev);
      }
    }
    const pipeline = ['Lead', 'Oferta', 'W realizacji', 'Wygrane', 'Przegrane', 'Inne']
      .map((stage) => pipelineMap.get(stage) || { stage, count: 0, value: 0 })
      .filter((x) => x.count > 0 || x.stage !== 'Inne');

    const sourceMap = new Map();
    for (const client of clientsAll) {
      const src = String(client.zrodlo || 'inne');
      sourceMap.set(src, (sourceMap.get(src) || 0) + 1);
    }
    const sources = Array.from(sourceMap.entries())
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count);

    const callbacksOpen = callbacksAll.filter((c) => !['done', 'cancelled'].includes(String(c.status || '').toLowerCase()));
    const callbacksOverdue = callbacksOpen.filter((c) => c.due_at && new Date(c.due_at) < now).length;
    const callbacksUpcoming = callbacksOpen
      .sort((a, b) => new Date(a.due_at || a.created_at || 0) - new Date(b.due_at || b.created_at || 0))
      .slice(0, 12);

    return {
      kpis: {
        clients_total: clientsAll.length,
        clients_new_30d: clientsNew30,
        tasks_total: tasksAll.length,
        tasks_won_30d: won30,
        calls_30d: calls30,
        callbacks_open: callbacksOpen.length,
        callbacks_overdue: callbacksOverdue,
      },
      pipeline,
      sources,
      callbacks: callbacksUpcoming,
    };
  });

  res.json(data);
});

router.get('/crm/leads', requireAuth, (req, res) => {
  const oddzialId = toInt(req.query.oddzial_id);
  const ownerId = toInt(req.query.owner_user_id);
  const q = String(req.query.q || '').trim().toLowerCase();
  const stage = String(req.query.stage || '').trim();

  const rows = readOnly((state) => {
    let list = (state.crmLeads || []).map((lead) => mapCrmLead(lead, state));
    if (oddzialId) list = list.filter((x) => Number(x.oddzial_id) === oddzialId);
    if (ownerId) list = list.filter((x) => Number(x.owner_user_id) === ownerId);
    if (stage) list = list.filter((x) => String(x.stage) === stage);
    if (q) {
      list = list.filter((x) =>
        [x.title, x.client_name, x.phone, x.email, x.source, x.notes].some((v) => String(v || '').toLowerCase().includes(q))
      );
    }
    return list.sort((a, b) => {
      const aTime = new Date(a.updated_at || a.created_at || 0).getTime();
      const bTime = new Date(b.updated_at || b.created_at || 0).getTime();
      return bTime - aTime;
    });
  });

  res.json(rows);
});

router.post('/crm/leads', requireAuth, (req, res) => {
  const b = req.body || {};
  const title = String(b.title || '').trim();
  const oddzialId = toInt(b.oddzial_id);
  if (!title || !oddzialId) {
    return res.status(400).json({ error: 'title i oddzial_id są wymagane' });
  }

  const row = withStore((state) => {
    if (!Array.isArray(state.crmLeads)) state.crmLeads = [];
    if (!state.nextCrmLeadId) state.nextCrmLeadId = 1;

    const now = new Date().toISOString();
    const created = {
      id: state.nextCrmLeadId++,
      title,
      oddzial_id: oddzialId,
      client_id: toInt(b.client_id) || null,
      owner_user_id: toInt(b.owner_user_id) || null,
      stage: normalizeCrmStage(b.stage),
      source: String(b.source || '').trim() || 'inne',
      value: toNum(b.value) ?? 0,
      phone: String(b.phone || '').trim() || null,
      email: String(b.email || '').trim() || null,
      notes: String(b.notes || '').trim() || null,
      tags: Array.isArray(b.tags) ? b.tags.slice(0, 16).map((x) => String(x || '').trim()).filter(Boolean) : [],
      next_action_at: b.next_action_at || null,
      created_by: req.user.id,
      created_at: now,
      updated_by: req.user.id,
      updated_at: now,
    };
    state.crmLeads.push(created);
    return mapCrmLead(created, state);
  });

  res.status(201).json(row);
});

router.patch('/crm/leads/:id', requireAuth, (req, res) => {
  const id = toInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'Nieprawidłowe id leada' });
  const b = req.body || {};

  const row = withStore((state) => {
    const lead = (state.crmLeads || []).find((x) => Number(x.id) === id);
    if (!lead) return null;

    if (b.title !== undefined) {
      const title = String(b.title || '').trim();
      if (!title) return '__bad_title__';
      lead.title = title;
    }
    if (b.stage !== undefined) lead.stage = normalizeCrmStage(b.stage);
    if (b.oddzial_id !== undefined) lead.oddzial_id = toInt(b.oddzial_id) || lead.oddzial_id;
    if (b.client_id !== undefined) lead.client_id = toInt(b.client_id) || null;
    if (b.owner_user_id !== undefined) lead.owner_user_id = toInt(b.owner_user_id) || null;
    if (b.source !== undefined) lead.source = String(b.source || '').trim() || 'inne';
    if (b.value !== undefined) lead.value = toNum(b.value) ?? 0;
    if (b.phone !== undefined) lead.phone = String(b.phone || '').trim() || null;
    if (b.email !== undefined) lead.email = String(b.email || '').trim() || null;
    if (b.notes !== undefined) lead.notes = String(b.notes || '').trim() || null;
    if (b.next_action_at !== undefined) lead.next_action_at = b.next_action_at || null;
    if (b.tags !== undefined) {
      lead.tags = Array.isArray(b.tags) ? b.tags.slice(0, 16).map((x) => String(x || '').trim()).filter(Boolean) : [];
    }
    lead.updated_at = new Date().toISOString();
    lead.updated_by = req.user.id;
    return mapCrmLead(lead, state);
  });

  if (row === '__bad_title__') return res.status(400).json({ error: 'title nie może być pusty' });
  if (!row) return res.status(404).json({ error: 'Lead nie znaleziony' });
  res.json(row);
});

router.delete('/crm/leads/:id', requireAuth, (req, res) => {
  const id = toInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'Nieprawidłowe id leada' });

  const deleted = withStore((state) => {
    if (!Array.isArray(state.crmLeads)) return false;
    const idx = state.crmLeads.findIndex((x) => Number(x.id) === id);
    if (idx < 0) return false;
    state.crmLeads.splice(idx, 1);
    if (Array.isArray(state.crmLeadActivities)) {
      state.crmLeadActivities = state.crmLeadActivities.filter((a) => Number(a.lead_id) !== id);
    }
    return true;
  });

  if (!deleted) return res.status(404).json({ error: 'Lead nie znaleziony' });
  res.json({ ok: true });
});

const CRM_ACTIVITY_TYPES = ['note', 'call', 'task'];

function normalizeCrmActivityType(t) {
  const v = String(t || '').trim();
  return CRM_ACTIVITY_TYPES.includes(v) ? v : 'note';
}

function mapCrmLeadActivity(a, state) {
  const author = (state.users || []).find((u) => Number(u.id) === Number(a.created_by));
  return {
    ...a,
    author_name: author ? `${author.imie || ''} ${author.nazwisko || ''}`.trim() || author.login : null,
  };
}

/** Historia: notatki, telefony, zadania/follow-up przypięte do leada w pipeline CRM. */
router.get('/crm/leads/:id/activities', requireAuth, (req, res) => {
  const leadId = toInt(req.params.id);
  if (!leadId) return res.status(400).json({ error: 'Nieprawidłowe id leada' });
  const rows = readOnly((state) => {
    const lead = (state.crmLeads || []).find((x) => Number(x.id) === leadId);
    if (!lead) return null;
    const list = (state.crmLeadActivities || [])
      .filter((a) => Number(a.lead_id) === leadId)
      .map((a) => mapCrmLeadActivity(a, state));
    return list.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  });
  if (rows === null) return res.status(404).json({ error: 'Lead nie znaleziony' });
  res.json(rows);
});

router.post('/crm/leads/:id/activities', requireAuth, (req, res) => {
  const leadId = toInt(req.params.id);
  if (!leadId) return res.status(400).json({ error: 'Nieprawidłowe id leada' });
  const b = req.body || {};
  const type = normalizeCrmActivityType(b.type);
  const text = String(b.text || b.tresc || '').trim();
  if (!text) {
    return res.status(400).json({ error: 'Pole text (tresc) jest wymagane' });
  }
  if (type === 'call' && b.call_duration_sec != null) {
    const d = toNum(b.call_duration_sec);
    if (d != null && d < 0) return res.status(400).json({ error: 'Nieprawidłowy call_duration_sec' });
  }

  const row = withStore((state) => {
    const lead = (state.crmLeads || []).find((x) => Number(x.id) === leadId);
    if (!lead) return null;
    if (!Array.isArray(state.crmLeadActivities)) state.crmLeadActivities = [];
    if (!state.nextCrmLeadActivityId) state.nextCrmLeadActivityId = 1;
    const now = new Date().toISOString();
    const act = {
      id: state.nextCrmLeadActivityId++,
      lead_id: leadId,
      type,
      text,
      due_at: type === 'task' ? (b.due_at ? String(b.due_at) : null) : null,
      call_duration_sec: type === 'call' && b.call_duration_sec != null ? toNum(b.call_duration_sec) : null,
      completed_at: null,
      created_by: req.user.id,
      created_at: now,
    };
    state.crmLeadActivities.push(act);
    lead.updated_at = now;
    lead.updated_by = req.user.id;
    return mapCrmLeadActivity(act, state);
  });

  if (!row) return res.status(404).json({ error: 'Lead nie znaleziony' });
  res.status(201).json(row);
});

router.patch('/crm/leads/:leadId/activities/:activityId', requireAuth, (req, res) => {
  const leadId = toInt(req.params.leadId);
  const activityId = toInt(req.params.activityId);
  if (!leadId || !activityId) return res.status(400).json({ error: 'Nieprawidłowe id' });
  const completed = req.body && (req.body.completed === true || req.body.done === true);

  const row = withStore((state) => {
    const lead = (state.crmLeads || []).find((x) => Number(x.id) === leadId);
    if (!lead) return null;
    const act = (state.crmLeadActivities || []).find(
      (a) => Number(a.id) === activityId && Number(a.lead_id) === leadId
    );
    if (!act) return '__nf__';
    if (completed && act.type === 'task' && !act.completed_at) {
      act.completed_at = new Date().toISOString();
    }
    lead.updated_at = new Date().toISOString();
    lead.updated_by = req.user.id;
    return mapCrmLeadActivity(act, state);
  });

  if (row === '__nf__') return res.status(404).json({ error: 'Aktywność nie znaleziona' });
  if (!row) return res.status(404).json({ error: 'Lead nie znaleziony' });
  res.json(row);
});

router.get('/telephony/calls', requireAuth, (req, res) => {
  const rok = toInt(req.query.rok);
  const miesiac = toInt(req.query.miesiac);
  const oddzialId = toInt(req.query.oddzial_id);
  const rows = readOnly((state) => {
    let list = state.callLogs || [];
    if (oddzialId) list = list.filter((x) => Number(x.oddzial_id) === oddzialId);
    if (rok || miesiac) {
      list = list.filter((x) => {
        const dt = new Date(x.created_at || x.call_time || Date.now());
        if (rok && dt.getFullYear() !== rok) return false;
        if (miesiac && dt.getMonth() + 1 !== miesiac) return false;
        return true;
      });
    }
    return list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  });
  res.json(rows);
});

router.post('/telephony/calls', requireAuth, (req, res) => {
  const b = req.body || {};
  const oddzialId = toInt(b.oddzial_id);
  const status = String(b.status || '').trim() || 'missed';
  const callType = String(b.call_type || '').trim() || 'outbound';
  const phone = String(b.phone || '').trim();
  if (!oddzialId || !phone) {
    return res.status(400).json({ error: 'oddzial_id i phone są wymagane' });
  }
  const row = withStore((state) => {
    if (!state.callLogs) state.callLogs = [];
    if (!state.nextCallLogId) state.nextCallLogId = 1;
    const taskId = toInt(b.task_id);
    const created = {
      id: state.nextCallLogId++,
      oddzial_id: oddzialId,
      phone,
      call_type: callType,
      status,
      duration_sec: toNum(b.duration_sec) ?? 0,
      task_id: taskId || null,
      lead_name: b.lead_name || null,
      notes: b.notes || null,
      created_by: req.user.id,
      created_at: new Date().toISOString(),
    };
    state.callLogs.push(created);
    return created;
  });
  res.status(201).json(row);
});

router.get('/telephony/callbacks', requireAuth, (req, res) => {
  const oddzialId = toInt(req.query.oddzial_id);
  const status = String(req.query.status || '').trim();
  const rows = readOnly((state) => {
    let list = state.callbackTasks || [];
    if (oddzialId) list = list.filter((x) => Number(x.oddzial_id) === oddzialId);
    if (status) list = list.filter((x) => String(x.status) === status);
    return list.sort((a, b) => new Date(a.due_at || a.created_at) - new Date(b.due_at || b.created_at));
  });
  res.json(rows);
});

router.post('/telephony/callbacks', requireAuth, (req, res) => {
  const b = req.body || {};
  const oddzialId = toInt(b.oddzial_id);
  const phone = String(b.phone || '').trim();
  if (!oddzialId || !phone) {
    return res.status(400).json({ error: 'oddzial_id i phone są wymagane' });
  }
  const row = withStore((state) => {
    if (!state.callbackTasks) state.callbackTasks = [];
    if (!state.nextCallbackTaskId) state.nextCallbackTaskId = 1;
    const zlecTaskId = toInt(b.task_id);
    const created = {
      id: state.nextCallbackTaskId++,
      oddzial_id: oddzialId,
      phone,
      task_id: zlecTaskId || null,
      lead_name: b.lead_name || null,
      priority: String(b.priority || 'normal'),
      due_at: b.due_at || null,
      status: 'open',
      notes: b.notes || null,
      assigned_user_id: toInt(b.assigned_user_id) || null,
      created_by: req.user.id,
      created_at: new Date().toISOString(),
      closed_at: null,
    };
    state.callbackTasks.push(created);
    return created;
  });
  res.status(201).json(row);
});

router.patch('/telephony/callbacks/:id/status', requireAuth, (req, res) => {
  const id = toInt(req.params.id);
  const status = String(req.body?.status || '').trim();
  if (!id || !status) return res.status(400).json({ error: 'id i status są wymagane' });
  const row = withStore((state) => {
    const task = (state.callbackTasks || []).find((x) => Number(x.id) === id);
    if (!task) return null;
    task.status = status;
    task.updated_by = req.user.id;
    task.updated_at = new Date().toISOString();
    if (status === 'done' || status === 'cancelled') task.closed_at = new Date().toISOString();
    return task;
  });
  if (!row) return res.status(404).json({ error: 'Callback nie znaleziony' });
  res.json(row);
});

router.get('/ogledziny', requireAuth, (req, res) => {
  const { status } = req.query;
  const list = readOnly((state) => {
    let o = state.ogledziny || [];
    if (status) o = o.filter((x) => x.status === status);
    return o;
  });
  res.json(list);
});

router.get('/ogledziny/:id', requireAuth, (req, res) => {
  const id = toNum(req.params.id);
  const row = readOnly((state) => {
    const o = (state.ogledziny || []).find((x) => x.id === id);
    if (!o) return null;
    return {
      ...o,
      created_by_nazwa: userName(state, o.created_by),
    };
  });
  if (!row) return res.status(404).json({ error: 'Nie znaleziono' });
  res.json(row);
});

router.put('/ogledziny/:id/status', requireAuth, (req, res) => {
  const id = toNum(req.params.id);
  const { status, notatki_wyniki } = req.body || {};
  const row = withStore((state) => {
    const o = (state.ogledziny || []).find((x) => x.id === id);
    if (!o) return null;
    if (status) o.status = status;
    if (notatki_wyniki != null) o.notatki_wyniki = notatki_wyniki;
    return { ...o, created_by_nazwa: userName(state, o.created_by) };
  });
  if (!row) return res.status(404).json({ error: 'Nie znaleziono' });
  res.json(row);
});

router.delete('/ogledziny/:id', requireAuth, (req, res) => {
  const id = toNum(req.params.id);
  withStore((state) => {
    state.ogledziny = (state.ogledziny || []).filter((x) => x.id !== id);
  });
  res.json({ ok: true });
});

router.post('/ogledziny', requireAuth, (req, res) => {
  const b = req.body || {};
  const row = withStore((state) => {
    if (!state.ogledziny) state.ogledziny = [];
    const id = state.nextOgledzinyId++;
    const o = {
      id,
      klient_id: Number(b.klient_id),
      brygadzista_id: b.brygadzista_id ? Number(b.brygadzista_id) : null,
      data_planowana: b.data_planowana || null,
      adres: b.adres || '',
      miasto: b.miasto || '',
      notatki: b.notatki || '',
      status: 'Zaplanowane',
      created_by: req.user.id,
      created_at: new Date().toISOString(),
    };
    state.ogledziny.push(o);
    return o;
  });
  res.status(201).json(row);
});

router.get('/klienci', requireAuth, (_req, res) => {
  const klienci = readOnly((state) => state.klienci || []);
  res.json(klienci);
});

router.get('/klienci/:id(\\d+)/kommo-payload', requireAuth, (req, res) => {
  const id = toNum(req.params.id);
  const row = readOnly((state) => (state.klienci || []).find((k) => k.id === id));
  if (!row) return res.status(404).json({ error: 'Nie znaleziono klienta' });
  const payload = buildKommoKlientPayload(row, {
    id: req.user?.id ?? null,
    login: req.user?.login ?? null,
    rola: req.user?.rola ?? null,
  });
  return res.json(payload);
});

router.post('/klienci/:id(\\d+)/kommo-push', requireAuth, async (req, res) => {
  const id = toNum(req.params.id);
  const row = readOnly((state) => (state.klienci || []).find((k) => k.id === id));
  if (!row) return res.status(404).json({ error: 'Nie znaleziono klienta' });
  if (!kommoWebhookConfigured('crm')) {
    return res.status(400).json({
      error:
        'Brak konfiguracji webhooka Kommo dla CRM. Ustaw KOMMO_CRM_WEBHOOK_URL lub KOMMO_WEBHOOK_URL.',
    });
  }
  const payload = buildKommoKlientPayload(row, {
    id: req.user?.id ?? null,
    login: req.user?.login ?? null,
    rola: req.user?.rola ?? null,
  });
  const markSync = (next) =>
    withStore((state) => {
      const k = (state.klienci || []).find((x) => x.id === id);
      if (!k) return null;
      k.kommo_last_sync_at = new Date().toISOString();
      k.kommo_last_sync_status = next.status || null;
      k.kommo_last_sync_http = next.http ?? null;
      k.kommo_last_sync_error = next.error || null;
      return k;
    });
  try {
    const { response, bodyText } = await postKommoWebhook(payload, 'crm');
    if (!response.ok) {
      markSync({
        status: 'error',
        http: response.status,
        error: `HTTP ${response.status}: ${bodyText.slice(0, 500)}`,
      });
      return res.status(502).json({
        ok: false,
        status: 'error',
        http_status: response.status,
        body: bodyText.slice(0, 500),
      });
    }
    markSync({ status: 'ok', http: response.status, error: null });
    return res.json({ ok: true, status: 'ok', http_status: response.status });
  } catch (err) {
    markSync({ status: 'error', http: null, error: err.message || 'network error' });
    return res.status(502).json({
      ok: false,
      status: 'error',
      error: err.message || 'Nie udało się wysłać danych do Kommo',
    });
  }
});

// ── CMR (listy przewozowe) ───────────────────────────────────────────────────
router.get('/cmr', requireAuth, (req, res) => {
  try {
    const taskFilter = toNum(req.query.task_id);
    const list = readOnly((state) => {
      const rows = state.cmrLists || [];
      return rows
        .filter((c) => canViewCmr(state, req.user, c))
        .filter((c) => taskFilter == null || c.task_id === taskFilter)
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .map((c) => enrichCmr(state, c));
    });
    res.json(list);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/cmr/:id', requireAuth, (req, res) => {
  const id = toNum(req.params.id);
  const row = readOnly((state) => {
    const c = (state.cmrLists || []).find((x) => x.id === id);
    if (!c || !canViewCmr(state, req.user, c)) return null;
    return enrichCmr(state, c);
  });
  if (!row) return res.status(404).json({ error: 'Nie znaleziono' });
  res.json(row);
});

router.post('/cmr', requireAuth, (req, res) => {
  const b = req.body || {};
  try {
    const row = withStore((state) => {
      if (!state.cmrLists) state.cmrLists = [];
      const task_id = b.task_id != null ? Number(b.task_id) : null;
      if (task_id) {
        if (!canUserViewZlecenie(state, req.user, task_id)) return { _err: 403 };
      }
      const id = state.nextCmrId++;
      const year = new Date().getFullYear();
      const numer = `CMR/PL/${year}/${String(id).padStart(6, '0')}`;
      const c = {
        id,
        numer,
        oddzial_id: null,
        task_id: task_id || null,
        vehicle_id: toNum(b.vehicle_id),
        status: (b.status && String(b.status).trim()) || 'Roboczy',
        nadawca_nazwa: b.nadawca_nazwa ?? null,
        nadawca_adres: b.nadawca_adres ?? null,
        nadawca_kraj: b.nadawca_kraj || 'PL',
        odbiorca_nazwa: b.odbiorca_nazwa ?? null,
        odbiorca_adres: b.odbiorca_adres ?? null,
        odbiorca_kraj: b.odbiorca_kraj || 'PL',
        miejsce_zaladunku: b.miejsce_zaladunku ?? null,
        miejsce_rozladunku: b.miejsce_rozladunku ?? null,
        data_zaladunku: b.data_zaladunku || null,
        data_rozladunku: b.data_rozladunku || null,
        przewoznik_nazwa: b.przewoznik_nazwa ?? null,
        przewoznik_adres: b.przewoznik_adres ?? null,
        przewoznik_kraj: b.przewoznik_kraj ?? null,
        kolejni_przewoznicy: b.kolejni_przewoznicy ?? null,
        nr_rejestracyjny: b.nr_rejestracyjny ?? null,
        nr_naczepy: b.nr_naczepy ?? null,
        kierowca: b.kierowca ?? null,
        instrukcje_nadawcy: b.instrukcje_nadawcy ?? null,
        uwagi_do_celnych: b.uwagi_do_celnych ?? null,
        umowy_szczegolne: b.umowy_szczegolne ?? null,
        zalaczniki: b.zalaczniki ?? null,
        towary: Array.isArray(b.towary) ? b.towary : [],
        platnosci: b.platnosci && typeof b.platnosci === 'object' ? b.platnosci : {},
        kommo_last_sync_at: null,
        kommo_last_sync_status: null,
        kommo_last_sync_http: null,
        kommo_last_sync_error: null,
        created_by: req.user.id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      state.cmrLists.push(c);
      return { ok: true, c };
    });
    if (row._err === 403) return res.status(403).json({ error: 'Brak dostępu' });
    res.status(201).json(enrichCmr(readOnly((s) => s), row.c));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/cmr/:id', requireAuth, (req, res) => {
  const id = toNum(req.params.id);
  const b = req.body || {};
  const row = withStore((state) => {
    const c = (state.cmrLists || []).find((x) => x.id === id);
    if (!c || !canViewCmr(state, req.user, c)) return null;
    const keys = [
      'task_id',
      'vehicle_id',
      'status',
      'nadawca_nazwa',
      'nadawca_adres',
      'nadawca_kraj',
      'odbiorca_nazwa',
      'odbiorca_adres',
      'odbiorca_kraj',
      'miejsce_zaladunku',
      'miejsce_rozladunku',
      'data_zaladunku',
      'data_rozladunku',
      'przewoznik_nazwa',
      'przewoznik_adres',
      'przewoznik_kraj',
      'kolejni_przewoznicy',
      'nr_rejestracyjny',
      'nr_naczepy',
      'kierowca',
      'instrukcje_nadawcy',
      'uwagi_do_celnych',
      'umowy_szczegolne',
      'zalaczniki',
    ];
    for (const k of keys) {
      if (Object.prototype.hasOwnProperty.call(b, k)) {
        if (k === 'task_id' || k === 'vehicle_id') c[k] = toNum(b[k]);
        else c[k] = b[k];
      }
    }
    c.oddzial_id = null;
    if (Object.prototype.hasOwnProperty.call(b, 'towary')) c.towary = Array.isArray(b.towary) ? b.towary : [];
    if (Object.prototype.hasOwnProperty.call(b, 'platnosci') && b.platnosci && typeof b.platnosci === 'object') {
      c.platnosci = b.platnosci;
    }
    c.updated_at = new Date().toISOString();
    return c;
  });
  if (!row) return res.status(404).json({ error: 'Nie znaleziono' });
  res.json(enrichCmr(readOnly((s) => s), row));
});

function toCompactText(value) {
  if (value == null) return null;
  const s = String(value).trim();
  return s ? s : null;
}

function toIsoDateStart(dateLike) {
  const d = toCompactText(dateLike);
  if (!d) return null;
  const v = `${d}T00:00:00.000Z`;
  const t = Date.parse(v);
  return Number.isFinite(t) ? Math.floor(t / 1000) : null;
}

function customField(fieldId, value) {
  if (!fieldId || value === null || value === undefined || value === '') return null;
  return {
    field_id: fieldId,
    values: [{ value }],
  };
}

function buildKommoCmrPayload(row, actor = null) {
  const towary = Array.isArray(row?.towary) ? row.towary : [];
  const towaryCompact = towary
    .map((x) => ({
      nazwa: toCompactText(x?.nazwa) || toCompactText(x?.znak),
      ilosc: toCompactText(x?.ilosc),
      opakowanie: toCompactText(x?.opakowanie),
      masa_kg: toCompactText(x?.masa_kg),
      objetosc_m3: toCompactText(x?.objetosc_m3),
    }))
    .filter((x) => x.nazwa || x.ilosc || x.opakowanie || x.masa_kg || x.objetosc_m3);
  const goodsSummary = towaryCompact
    .map((x) => {
      const bits = [x.nazwa, x.ilosc ? `x${x.ilosc}` : null, x.masa_kg ? `${x.masa_kg}kg` : null].filter(Boolean);
      return bits.join(' ');
    })
    .filter(Boolean)
    .join('; ');
  const nrRejestracyjny = toCompactText(row.nr_rejestracyjny || row.pojazd_nr_rejestracyjny);
  const client = toCompactText(row.task_klient_nazwa);
  const leadName = ['CMR', toCompactText(row.numer), client].filter(Boolean).join(' · ');
  const customFields = [
    customField(KOMMO_CF_CMR_NUMBER_ID, toCompactText(row.numer)),
    customField(KOMMO_CF_ORDER_ID, row.task_id ?? null),
    customField(KOMMO_CF_BRANCH_ID, row.task_oddzial_id ?? null),
    customField(KOMMO_CF_PLATE_ID, nrRejestracyjny),
    customField(KOMMO_CF_DRIVER_ID, toCompactText(row.kierowca)),
    customField(KOMMO_CF_STATUS_ID, toCompactText(row.status)),
    customField(KOMMO_CF_LOAD_DATE_ID, toIsoDateStart(row.data_zaladunku)),
    customField(KOMMO_CF_UNLOAD_DATE_ID, toIsoDateStart(row.data_rozladunku)),
    customField(KOMMO_CF_GOODS_SUMMARY_ID, goodsSummary || null),
  ].filter(Boolean);
  const tags = KOMMO_TAGS.map((name) => ({ name }));

  return {
    source: 'arbor-web-local',
    event: 'cmr.sync',
    sent_at: new Date().toISOString(),
    integration: {
      provider: 'kommo',
      version: '1',
    },
    actor: actor || null,
    kommo: {
      lead: {
        name: leadName || `CMR ${row.id}`,
        external_id: `cmr:${row.id}`,
        pipeline_id: KOMMO_PIPELINE_ID ?? undefined,
        status_id: KOMMO_STATUS_ID ?? undefined,
        responsible_user_id: KOMMO_RESPONSIBLE_USER_ID ?? undefined,
        custom_fields_values: customFields.length ? customFields : undefined,
        _embedded: tags.length ? { tags } : undefined,
      },
    },
    cmr: {
      id: row.id,
      numer: row.numer,
      status: row.status,
      task_id: row.task_id ?? null,
      task_oddzial_id: row.task_oddzial_id ?? null,
      client,
      nadawca: {
        nazwa: toCompactText(row.nadawca_nazwa),
        adres: toCompactText(row.nadawca_adres),
        kraj: toCompactText(row.nadawca_kraj),
      },
      odbiorca: {
        nazwa: toCompactText(row.odbiorca_nazwa),
        adres: toCompactText(row.odbiorca_adres),
        kraj: toCompactText(row.odbiorca_kraj),
      },
      transport: {
        miejsce_zaladunku: toCompactText(row.miejsce_zaladunku),
        miejsce_rozladunku: toCompactText(row.miejsce_rozladunku),
        data_zaladunku: toCompactText(row.data_zaladunku),
        data_rozladunku: toCompactText(row.data_rozladunku),
        przewoznik_nazwa: toCompactText(row.przewoznik_nazwa),
        przewoznik_adres: toCompactText(row.przewoznik_adres),
        kierowca: toCompactText(row.kierowca),
        nr_rejestracyjny: nrRejestracyjny,
        nr_naczepy: toCompactText(row.nr_naczepy),
      },
      towary: towaryCompact,
      goods_summary: goodsSummary || null,
      uwagi: {
        instrukcje_nadawcy: toCompactText(row.instrukcje_nadawcy),
        uwagi_do_celnych: toCompactText(row.uwagi_do_celnych),
        umowy_szczegolne: toCompactText(row.umowy_szczegolne),
        zalaczniki: toCompactText(row.zalaczniki),
      },
      sync_meta: {
        last_sync_at: row.kommo_last_sync_at || null,
        last_sync_status: row.kommo_last_sync_status || null,
      },
    },
  };
}

router.get('/cmr/:id/kommo-payload', requireAuth, (req, res) => {
  const id = toNum(req.params.id);
  const row = readOnly((state) => {
    const c = (state.cmrLists || []).find((x) => x.id === id);
    if (!c || !canViewCmr(state, req.user, c)) return null;
    return enrichCmr(state, c);
  });
  if (!row) return res.status(404).json({ error: 'Nie znaleziono CMR' });

  const payload = buildKommoCmrPayload(row, {
    id: req.user?.id ?? null,
    login: req.user?.login ?? null,
    rola: req.user?.rola ?? null,
  });
  return res.json(payload);
});

router.post('/cmr/:id/kommo-push', requireAuth, async (req, res) => {
  const id = toNum(req.params.id);
  const row = readOnly((state) => {
    const c = (state.cmrLists || []).find((x) => x.id === id);
    if (!c || !canViewCmr(state, req.user, c)) return null;
    return enrichCmr(state, c);
  });
  if (!row) return res.status(404).json({ error: 'Nie znaleziono CMR' });
  if (!KOMMO_WEBHOOK_URL) {
    return res.status(400).json({
      error: 'Brak konfiguracji Kommo. Ustaw zmienną środowiskową KOMMO_WEBHOOK_URL.',
    });
  }

  const payload = buildKommoCmrPayload(row, {
    id: req.user?.id ?? null,
    login: req.user?.login ?? null,
    rola: req.user?.rola ?? null,
  });

  const markSync = (next) =>
    withStore((state) => {
      const c = (state.cmrLists || []).find((x) => x.id === id);
      if (!c) return null;
      c.kommo_last_sync_at = new Date().toISOString();
      c.kommo_last_sync_status = next.status || null;
      c.kommo_last_sync_http = next.http ?? null;
      c.kommo_last_sync_error = next.error || null;
      c.updated_at = new Date().toISOString();
      return c;
    });

  try {
    const { response, bodyText } = await postKommoWebhook(payload, 'cmr');
    if (!response.ok) {
      markSync({
        status: 'error',
        http: response.status,
        error: `HTTP ${response.status}: ${bodyText.slice(0, 500)}`,
      });
      return res.status(502).json({
        ok: false,
        status: 'error',
        http_status: response.status,
        body: bodyText.slice(0, 500),
      });
    }
    markSync({ status: 'ok', http: response.status, error: null });
    return res.json({ ok: true, status: 'ok', http_status: response.status });
  } catch (err) {
    markSync({ status: 'error', http: null, error: err.message || 'network error' });
    return res.status(502).json({
      ok: false,
      status: 'error',
      error: err.message || 'Nie udało się wysłać danych do Kommo',
    });
  }
});

require('./fullStack')(router);

module.exports = router;
