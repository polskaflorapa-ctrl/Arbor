const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { readOnly, withStore } = require('../lib/store');
const { requireAuth, publicUser, signUser } = require('../lib/auth');

const router = express.Router();
const UPLOAD_ROOT = path.join(__dirname, '..', 'uploads', 'wyceny');

router.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'arbor-api-local', mode: 'file-db' });
});

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function toNum(v) {
  if (v === '' || v === undefined || v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function userName(state, id) {
  if (!id) return null;
  const u = state.users.find((x) => x.id === id);
  return u ? `${u.imie} ${u.nazwisko}` : null;
}

function enrichWycena(state, z) {
  const wyceniajacy_nazwa = userName(state, z.created_by);
  const ekipa = state.teams.find((t) => t.id === z.ekipa_id);
  const zatwierdzone_przez_nazwa = userName(state, z.zatwierdzone_przez);
  return {
    ...z,
    wyceniajacy_nazwa,
    ekipa_nazwa: ekipa?.nazwa || null,
    zatwierdzone_przez_nazwa,
  };
}

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

require('./fullStack')(router);

module.exports = router;
