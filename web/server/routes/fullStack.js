const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { readOnly, withStore } = require('../lib/store');
const { requireAuth } = require('../lib/auth');
const { canViewCmr, enrichCmr } = require('../lib/cmrAccess');
const { buildCmrPdfBuffer } = require('../lib/cmrPdf');
const { TASK_STATUS, isTaskDone, isValidTaskStatus, normalizeTaskStatus } = require('../lib/taskWorkflow');

const UP_ZDJ = path.join(__dirname, '..', 'uploads', 'zlecenia');
const UP_DOK = path.join(__dirname, '..', 'uploads', 'zlecenia');
const UP_FLEET = path.join(__dirname, '..', 'uploads', 'flota');

function ensureDir(d) {
  fs.mkdirSync(d, { recursive: true });
}

function safeUnlink(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (_e) {
    // ignore local file delete errors in demo backend
  }
}

function safeUploadName(value) {
  return String(value || 'plik')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 140) || 'plik';
}

function toNum(v) {
  if (v === '' || v === undefined || v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeFleetText(value) {
  if (typeof value !== 'string') return value;
  return value
    .replaceAll('DostÄ™pny', 'Dostepny')
    .replaceAll('PiĹ‚arka', 'Pilarka')
    .replaceAll('SamochĂłd', 'Samochod')
    .replaceAll('W uĹĽyciu', 'W uzyciu')
    .replaceAll('ZwrĂłcone', 'Zwrocone');
}

function normalizeFleetRow(row) {
  if (!row || typeof row !== 'object') return row;
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, normalizeFleetText(value)]),
  );
}

function userName(state, id) {
  if (!id) return null;
  const u = state.users.find((x) => x.id === id);
  return u ? `${u.imie} ${u.nazwisko}` : null;
}

function enrichRow(state, z) {
  if (!z) return null;
  const wyceniajacy_nazwa = userName(state, z.created_by);
  const ekipa = state.teams.find((t) => t.id === z.ekipa_id);
  const zatwierdzone_przez_nazwa = userName(state, z.zatwierdzone_przez);
  const dp = z.data_planowana || z.data_wykonania || null;
  return {
    ...z,
    wyceniajacy_nazwa,
    ekipa_nazwa: ekipa?.nazwa || null,
    zatwierdzone_przez_nazwa,
    data_planowana: dp,
  };
}

function zleceniaRows(state) {
  return state.zlecenia.filter((z) => z.typ === 'zlecenie' || z.typ == null);
}

function canSeeAll(user) {
  return ['Prezes', 'Dyrektor'].includes(user.rola);
}

function isSalesDirector(user) {
  return [
    'Dyrektor Sprzedazy',
    'Dyrektor Sprzedaży',
    'Dyrektor dzialu sprzedaz',
    'Dyrektor działu sprzedaż',
  ].includes(user?.rola);
}

function canSeeAllBranches(user) {
  return canSeeAll(user) || isSalesDirector(user);
}

function canSeeAllTasks(user) {
  return canSeeAll(user) || isSalesDirector(user);
}

function canManageTasks(user) {
  return canSeeAll(user) || user?.rola === 'Kierownik';
}

function canManageTeams(user) {
  return canSeeAll(user) || user?.rola === 'Kierownik';
}

function canManageOddzial(user, oddzialId) {
  if (canSeeAll(user)) return true;
  return user?.rola === 'Kierownik' && String(user.oddzial_id) === String(oddzialId);
}

function rejectSalesDirectorTaskWrite(req, res, next) {
  if (req.method !== 'GET' && isSalesDirector(req.user)) {
    return res.status(403).json({ error: 'Dyrektor sprzedazy ma w zleceniach tryb tylko do odczytu' });
  }
  return next();
}

function canAccessOddzial(user, oddzialId) {
  return canSeeAllBranches(user) || String(user?.oddzial_id) === String(oddzialId);
}

function canTransferSpecialist(user, target) {
  if (canSeeAll(user)) return true;
  return isSalesDirector(user) && target?.rola === 'Specjalista';
}

const SALES_DIRECTOR_ROLES = new Set([
  'Dyrektor Sprzedazy',
  'Dyrektor Sprzedaży',
  'Dyrektor dzialu sprzedaz',
  'Dyrektor działu sprzedaż',
]);
const HIGH_PRIVILEGE_ROLES = new Set([
  'Prezes',
  'Dyrektor',
  'Administrator',
  'Kierownik',
  ...SALES_DIRECTOR_ROLES,
]);

function visibleUsers(state, user) {
  const rows = state.users || [];
  if (canSeeAll(user)) return rows;
  if (isSalesDirector(user)) {
    return rows.filter((u) => u.rola === 'Specjalista' || Number(u.id) === Number(user.id));
  }
  if (user.oddzial_id != null) {
    return rows.filter((u) => String(u.oddzial_id) === String(user.oddzial_id));
  }
  return rows.filter((u) => Number(u.id) === Number(user.id));
}

function canViewUser(state, user, userId) {
  return visibleUsers(state, user).some((u) => Number(u.id) === Number(userId));
}

function canCreateUserWithRole(actor, rola) {
  if (canSeeAll(actor)) return true;
  if (actor?.rola === 'Kierownik') return !HIGH_PRIVILEGE_ROLES.has(rola);
  return false;
}

function canManageTargetUser(actor, target) {
  if (canSeeAll(actor)) return true;
  if (actor?.rola === 'Kierownik') {
    return String(actor.oddzial_id) === String(target?.oddzial_id) && !HIGH_PRIVILEGE_ROLES.has(target?.rola);
  }
  return false;
}

function canManageIntegrations(user) {
  return ['Prezes', 'Dyrektor', 'Kierownik'].includes(user?.rola);
}

function canRetryChannel(user, channel) {
  if (!user?.rola) return false;
  if (['Prezes', 'Dyrektor'].includes(user.rola)) return true;
  if (user.rola === 'Kierownik') return channel === 'email' || channel === 'push';
  return false;
}

const DENYLIST_ROLLBACK_MAX_AGE_DAYS = 14;

function visibleTasks(state, user) {
  const rows = zleceniaRows(state);
  if (canSeeAllTasks(user)) return rows;
  if (user.rola === 'Kierownik') return rows.filter((z) => String(z.oddzial_id) === String(user.oddzial_id));
  if (['Brygadzista', 'Pomocnik', 'Pomocnik bez doświadczenia'].includes(user.rola)) {
    if (!user.ekipa_id) return [];
    return rows.filter((z) => String(z.ekipa_id) === String(user.ekipa_id));
  }
  if (user.oddzial_id != null) return rows.filter((z) => String(z.oddzial_id) === String(user.oddzial_id));
  return [];
}

function mojeTasks(state, user) {
  const rows = zleceniaRows(state);
  if (user.ekipa_id) return rows.filter((z) => String(z.ekipa_id) === String(user.ekipa_id));
  if (user.rola === 'Kierownik') return rows.filter((z) => String(z.oddzial_id) === String(user.oddzial_id));
  return visibleTasks(state, user);
}

function canViewTask(state, user, taskId) {
  const z = state.zlecenia.find((x) => x.id === taskId);
  if (!z) return false;
  if (z.typ === 'wycena') {
    return canSeeAll(user) || String(z.oddzial_id) === String(user.oddzial_id);
  }
  const vis = visibleTasks(state, user).some((x) => x.id === taskId);
  return vis || canSeeAllTasks(user);
}

function oddzialNazwa(state, id) {
  const o = state.oddzialy.find((x) => x.id === id);
  return o ? o.nazwa : null;
}

function delegationYmd(value) {
  return String(value || '').slice(0, 10);
}

function delegationDay(value) {
  return delegationYmd(value) || new Date().toISOString().slice(0, 10);
}

const CLOSED_DELEGATION_STATUSES = new Set(['Anulowana', 'Zakonczona', 'Zakończona']);

function isActiveDelegation(d, day = delegationDay()) {
  if (!d || CLOSED_DELEGATION_STATUSES.has(String(d.status || ''))) return false;
  const from = delegationYmd(d.data_od);
  const to = delegationYmd(d.data_do);
  return (!from || from <= day) && (!to || to >= day);
}

function delegationUserId(d) {
  return toNum(d?.user_id ?? d?.wyceniajacy_id);
}

function isEstimatorRole(role) {
  const raw = String(role || '').toLowerCase();
  return raw.includes('wyceniaj') || raw.includes('wyceniajä');
}

function teamDelegationForBranch(state, teamId, branchId, day = delegationDay()) {
  if (!teamId || !branchId) return null;
  return (state.delegacje || []).find((d) =>
    toNum(d.ekipa_id) === Number(teamId) &&
    toNum(d.oddzial_do) === Number(branchId) &&
    isActiveDelegation(d, day)
  ) || null;
}

function teamBranchError(state, teamId, branchId, day = delegationDay()) {
  if (!teamId || !branchId) return null;
  const team = (state.teams || []).find((t) => Number(t.id) === Number(teamId));
  if (!team) return `Ekipa #${teamId} nie istnieje.`;
  if (Number(team.oddzial_id) === Number(branchId) || teamDelegationForBranch(state, teamId, branchId, day)) {
    return null;
  }
  const from = oddzialNazwa(state, team.oddzial_id) || 'inny oddzial';
  const to = oddzialNazwa(state, branchId) || `oddzial #${branchId}`;
  return `${team.nazwa || `Ekipa #${teamId}`} nalezy do ${from}. Do ${to} mozna ja przypisac tylko przez aktywna delegacje.`;
}

function enrichDelegacja(state, d) {
  const team = (state.teams || []).find((t) => Number(t.id) === Number(d.ekipa_id));
  const userId = delegationUserId(d);
  const user = (state.users || []).find((u) => Number(u.id) === Number(userId));
  const typ = userId ? 'wyceniajacy' : 'ekipa';
  const userNameValue = user ? `${user.imie || ''} ${user.nazwisko || ''}`.trim() : null;
  return {
    ...d,
    zasob_typ: d.zasob_typ || typ,
    user_id: userId,
    wyceniajacy_id: userId,
    ekipa_nazwa: team?.nazwa || null,
    user_nazwa: userNameValue,
    zasob_nazwa: typ === 'wyceniajacy' ? userNameValue : (team?.nazwa || null),
    oddzial_z_nazwy: oddzialNazwa(state, d.oddzial_z),
    oddzial_do_nazwy: oddzialNazwa(state, d.oddzial_do),
  };
}

function stripHaslo(u) {
  if (!u) return null;
  const { haslo, ...rest } = u;
  return rest;
}

function ensureWorkflowCollections(state) {
  if (!state.taskChecklist) state.taskChecklist = {};
  if (!state.taskReminders) state.taskReminders = {};
  if (!state.taskWorkflowEvents) state.taskWorkflowEvents = {};
  if (!state.nextTaskChecklistId) state.nextTaskChecklistId = 1;
  if (!state.nextTaskReminderId) state.nextTaskReminderId = 1;
  if (!state.nextTaskWorkflowEventId) state.nextTaskWorkflowEventId = 1;
}

function ensureIntegrationsCollections(state) {
  if (!state.taskIntegrations) state.taskIntegrations = {};
  if (!state.integrationLogs) state.integrationLogs = [];
  if (!state.nextIntegrationLogId) state.nextIntegrationLogId = 1;
  if (!state.notifications) state.notifications = [];
  if (!state.nextNotificationId) state.nextNotificationId = 1;
  if (!state.integrationRetryAudit) state.integrationRetryAudit = [];
  if (!state.nextIntegrationRetryAuditId) state.nextIntegrationRetryAuditId = 1;
  if (!state.integrationRetryBuckets) state.integrationRetryBuckets = {};
  if (!state.integrationRetryDenylist) state.integrationRetryDenylist = { users: [], channels: [] };
  if (!state.integrationDenylistHistory) state.integrationDenylistHistory = [];
  if (!state.nextIntegrationDenylistHistoryId) state.nextIntegrationDenylistHistoryId = 1;
}

function checkRetryRateLimit(state, userId) {
  ensureIntegrationsCollections(state);
  const key = String(userId);
  const now = Date.now();
  const windowMs = 60 * 1000;
  const limit = 20;
  const bucket = state.integrationRetryBuckets[key] || { count: 0, reset_at: now + windowMs };
  if (now > bucket.reset_at) {
    bucket.count = 0;
    bucket.reset_at = now + windowMs;
  }
  if (bucket.count >= limit) {
    state.integrationRetryBuckets[key] = bucket;
    return { ok: false, retry_after_ms: bucket.reset_at - now };
  }
  bucket.count += 1;
  state.integrationRetryBuckets[key] = bucket;
  return { ok: true };
}

function isRetryDenied(state, userId, channel) {
  ensureIntegrationsCollections(state);
  const denyUsers = Array.isArray(state.integrationRetryDenylist?.users) ? state.integrationRetryDenylist.users : [];
  const denyChannels = Array.isArray(state.integrationRetryDenylist?.channels) ? state.integrationRetryDenylist.channels : [];
  return denyUsers.includes(userId) || denyChannels.includes(channel);
}

function pushIntegrationEvent(state, taskId, actorUserId, channel, title, payload) {
  ensureIntegrationsCollections(state);
  const cfg = (state.taskIntegrations[String(taskId)] || {
    sms: true,
    email: true,
    push: true,
    auto_on_status: true,
    auto_on_reminder: true,
  });
  if (!cfg[channel]) return null;
  const log = {
    id: state.nextIntegrationLogId++,
    task_id: taskId,
    channel,
    title,
    payload: payload || {},
    status: 'sent_demo',
    created_at: new Date().toISOString(),
    created_by: actorUserId,
    created_by_name: userName(state, actorUserId),
  };
  state.integrationLogs.push(log);
  const targets = state.users.filter((u) => u.aktywny !== false && ['Prezes', 'Dyrektor', 'Kierownik'].includes(u.rola));
  for (const u of targets) {
    state.notifications.push({
      id: state.nextNotificationId++,
      typ: 'integracja',
      tresc: `[${channel.toUpperCase()}] ${title} (zlecenie #${taskId})`,
      task_id: taskId,
      status: 'Nowe',
      od_user_id: actorUserId,
      to_user_id: u.id,
      created_at: new Date().toISOString(),
    });
  }
  return log;
}

const MIN_PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n',
  'utf8'
);

const diskZdj = multer.diskStorage({
  destination: (req, _file, cb) => {
    const dir = path.join(UP_ZDJ, String(req.params.id));
    ensureDir(dir);
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    cb(null, `${Date.now()}_${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`);
  },
});
const upZdj = multer({ storage: diskZdj, limits: { fileSize: 25 * 1024 * 1024 } });
const upWideo = multer({ storage: diskZdj, limits: { fileSize: 250 * 1024 * 1024 } });
const diskDok = multer.diskStorage({
  destination: (req, _file, cb) => {
    const dir = path.join(UP_DOK, String(req.params.id), 'docs');
    ensureDir(dir);
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    cb(null, `${Date.now()}_${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`);
  },
});
const upDok = multer({ storage: diskDok, limits: { fileSize: 100 * 1024 * 1024 } });

const diskFleet = multer.diskStorage({
  destination: (req, _file, cb) => {
    const dir = path.join(
      UP_FLEET,
      safeUploadName(req.params.typ || 'naprawy'),
      safeUploadName(req.params.id || req.params.naprawaId || '0')
    );
    ensureDir(dir);
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '') || '.bin';
    const base = safeUploadName(path.basename(file.originalname || 'plik', ext));
    cb(null, `${Date.now()}_${base}${ext}`);
  },
});

const upFleetFile = multer({
  storage: diskFleet,
  limits: { fileSize: 40 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const mime = String(file.mimetype || '');
    if (mime.startsWith('image/') || mime === 'application/pdf') return cb(null, true);
    return cb(new Error('Dozwolone sa zdjecia albo PDF'));
  },
});

module.exports = function registerFullStack(router) {
  router.get('/auth/me', requireAuth, (req, res) => {
    const row = readOnly((s) => s.users.find((u) => u.id === req.user.id));
    if (!row) return res.status(404).json({ error: 'Nie znaleziono' });
    res.json(stripHaslo(row));
  });

  router.post('/ai/chat', requireAuth, (req, res) => {
    const msgs = req.body?.messages || [];
    const last = [...msgs].reverse().find((m) => m.role === 'user');
    const t = (last && last.content) || '';
    res.json({
      reply: `Demo (lokalny serwer, bez zewnętrznego LLM): „${String(t).slice(0, 200)}”.`,
    });
  });

  router.post('/ai/analyze-photo', requireAuth, (_req, res) => {
    res.json({
      parsed: {
        typ_uslugi: 'Wycinka',
        uwagi: 'Demo — uzupełnij formularz ręcznie.',
      },
    });
  });

  router.get('/ai/dispatch-brief', requireAuth, (req, res) => {
    const tasks = readOnly((s) => visibleTasks(s, req.user).map((z) => enrichRow(s, z))).slice(0, 8);
    const blocked = tasks.filter((z) => !z.klient_telefon || !z.adres || !z.wartosc_planowana).length;
    const warnings = tasks.filter((z) => !z.pin_lat || !z.pin_lng).length;
    const totalValue = tasks.reduce((sum, z) => sum + Number(z.wartosc_planowana || z.kwota || 0), 0);

    res.json({
      source: 'rules',
      date: String(req.query.date || new Date().toISOString().slice(0, 10)),
      summary: blocked
        ? `Lokalny demo-brief: popraw ${blocked} zlecen przed solverem.`
        : 'Lokalny demo-brief: dane wygladaja gotowo do solvera.',
      metrics: {
        tasks_total: tasks.length,
        ready_for_dispatch: Math.max(0, tasks.length - blocked),
        blocked,
        warnings,
        overdue: 0,
        unassigned: tasks.filter((z) => !z.ekipa_id).length,
        missing_gps: warnings,
        low_margin: 0,
        teams_available: 2,
        total_value: totalValue,
        avg_quality: blocked ? 74 : 92,
      },
      recommendations: [
        {
          priority: blocked ? 'high' : 'low',
          title: blocked ? 'Napraw braki przed solverem' : 'Uruchom podglad planu',
          rationale: blocked
            ? 'Czesc zlecen w lokalnym demo nie ma kompletu danych operacyjnych.'
            : 'Nie widac krytycznych brakow w lokalnym demo.',
          suggested_action: blocked
            ? 'Uzupelnij telefon, adres albo wartosc przy ryzykownych pozycjach.'
            : 'Sprawdz trasy i ograniczenia czasowe ekip.',
          risk: blocked ? 'high' : 'low',
        },
      ],
      top_tasks: tasks.slice(0, 5).map((z) => ({
        task_id: z.id,
        task_numer: z.numer || `#${z.id}`,
        client: z.klient_nazwa || z.klient || null,
        status: z.status || 'Nowe',
        quality_score: (!z.klient_telefon || !z.adres || !z.wartosc_planowana) ? 58 : 88,
        issues: [
          !z.klient_telefon && { key: 'client_phone', severity: 'critical', label: 'Brak telefonu', action: 'Dodaj numer telefonu klienta.' },
          !z.adres && { key: 'address', severity: 'critical', label: 'Brak adresu', action: 'Uzupelnij adres wykonania.' },
          !z.wartosc_planowana && { key: 'price', severity: 'critical', label: 'Brak ceny', action: 'Uzupelnij wartosc planowana.' },
          (!z.pin_lat || !z.pin_lng) && { key: 'gps', severity: 'warning', label: 'Brak pinezki GPS', action: 'Dodaj pinezke lokalizacji.' },
        ].filter(Boolean),
      })),
    });
  });

  router.get('/tasks/moje', requireAuth, (req, res) => {
    const list = readOnly((s) => mojeTasks(s, req.user).map((z) => enrichRow(s, z)));
    res.json(list);
  });

  router.get('/tasks', requireAuth, (req, res) => {
    const list = readOnly((s) => visibleTasks(s, req.user).map((z) => enrichRow(s, z)));
    res.json(list);
  });

  router.use('/tasks/:id', requireAuth, rejectSalesDirectorTaskWrite);

  router.get('/tasks/:id', requireAuth, (req, res) => {
    const id = toNum(req.params.id);
    const row = readOnly((s) => {
      if (!canViewTask(s, req.user, id)) return null;
      const z = s.zlecenia.find((x) => x.id === id);
      return z ? enrichRow(s, z) : null;
    });
    if (!row) return res.status(404).json({ error: 'Nie znaleziono' });
    res.json(row);
  });

  router.post('/tasks', requireAuth, (req, res) => {
    const b = req.body || {};
    if (!canManageTasks(req.user)) return res.status(403).json({ error: 'Brak uprawnien do tworzenia zlecen' });
    const row = withStore((s) => {
      const id = s.nextZlecenieId++;
      const now = new Date().toISOString();
      const oid = toNum(b.oddzial_id) ?? req.user.oddzial_id;
      const teamId = toNum(b.ekipa_id);
      const branchError = teamBranchError(s, teamId, oid, delegationDay(b.data_wykonania || b.data_planowana));
      if (branchError) return { error: branchError, status: 409 };
      const initialStatus = isValidTaskStatus(b.status) ? normalizeTaskStatus(b.status) : TASK_STATUS.NOWE;
      const z = {
        id,
        typ: 'zlecenie',
        status: initialStatus,
        klient_nazwa: b.klient_nazwa || null,
        klient_telefon: b.klient_telefon || null,
        klient_email: b.klient_email || null,
        adres: b.adres || '',
        miasto: b.miasto || '',
        oddzial_id: oid,
        ekipa_id: teamId,
        typ_uslugi: b.typ_uslugi || 'Wycinka',
        priorytet: b.priorytet || 'Normalny',
        data_planowana: b.data_planowana || b.data_wykonania || null,
        data_wykonania: b.data_wykonania || b.data_planowana || null,
        godzina_rozpoczecia: b.godzina_rozpoczecia || null,
        czas_planowany_godziny: toNum(b.czas_planowany_godziny),
        wartosc_planowana: toNum(b.wartosc_planowana),
        notatki_wewnetrzne: b.notatki_wewnetrzne || null,
        notatki: b.notatki || null,
        opis_pracy: b.opis_pracy || null,
        kierownik_id: toNum(b.kierownik_id),
        wywoz: !!b.wywoz,
        usuwanie_pni: !!b.usuwanie_pni,
        czas_realizacji_godz: b.czas_realizacji_godz || null,
        rebak: !!b.rebak,
        pila_wysiegniku: !!b.pila_wysiegniku,
        nozyce_dlugie: !!b.nozyce_dlugie,
        kosiarka: !!b.kosiarka,
        podkaszarka: !!b.podkaszarka,
        lopata: !!b.lopata,
        mulczer: !!b.mulczer,
        ilosc_osob: b.ilosc_osob || null,
        arborysta: !!b.arborysta,
        wynik: b.wynik || null,
        budzet: b.budzet || null,
        rabat: b.rabat || null,
        kwota_minimalna: b.kwota_minimalna || null,
        zrebki: b.zrebki || null,
        drzewno: b.drzewno || null,
        dodatkowe_uslugi_liczba: Math.max(0, parseInt(String(b.dodatkowe_uslugi_liczba ?? 0), 10) || 0),
        bony_liczba: Math.max(0, parseInt(String(b.bony_liczba ?? 0), 10) || 0),
        created_by: req.user.id,
        created_at: now,
      };
      s.zlecenia.push(z);
      return { data: enrichRow(s, z) };
    });
    if (row?.error) return res.status(row.status || 400).json({ error: row.error });
    res.status(201).json(row.data);
  });

  router.put('/tasks/:id', requireAuth, (req, res) => {
    const id = toNum(req.params.id);
    const b = req.body || {};
    if (!canManageTasks(req.user)) return res.status(403).json({ error: 'Brak uprawnien do edycji zlecen' });
    const row = withStore((s) => {
      const z = s.zlecenia.find((x) => x.id === id);
      if (!z || !canViewTask(s, req.user, id)) return null;
      const targetBranchId = b.oddzial_id !== undefined ? toNum(b.oddzial_id) : z.oddzial_id;
      const targetTeamId = b.ekipa_id !== undefined ? toNum(b.ekipa_id) : z.ekipa_id;
      const branchError = teamBranchError(
        s,
        targetTeamId,
        targetBranchId,
        delegationDay(b.data_wykonania || b.data_planowana || z.data_wykonania || z.data_planowana)
      );
      if (branchError) return { error: branchError, status: 409 };
      const mergeKeys = Object.keys(b).filter((k) => k !== 'id');
      for (const k of mergeKeys) {
        if (b[k] === undefined) continue;
        if (['ekipa_id', 'oddzial_id', 'kierownik_id', 'czas_planowany_godziny', 'wartosc_planowana', 'dodatkowe_uslugi_liczba', 'bony_liczba'].includes(k)) {
          if (k === 'dodatkowe_uslugi_liczba' || k === 'bony_liczba') {
            z[k] = Math.max(0, parseInt(String(b[k] ?? 0), 10) || 0);
          } else {
            z[k] = toNum(b[k]) ?? b[k];
          }
        } else {
          z[k] = b[k];
        }
      }
      if (b.data_planowana || b.data_wykonania) {
        z.data_planowana = b.data_planowana || z.data_planowana;
        z.data_wykonania = b.data_wykonania || z.data_wykonania;
      }
      return { data: enrichRow(s, z) };
    });
    if (!row) return res.status(404).json({ error: 'Nie znaleziono' });
    if (row?.error) return res.status(row.status || 400).json({ error: row.error });
    res.json(row.data);
  });

  router.delete('/tasks/:id', requireAuth, (req, res) => {
    const id = toNum(req.params.id);
    if (!['Prezes', 'Dyrektor'].includes(req.user.rola)) {
      return res.status(403).json({ error: 'Brak uprawnień' });
    }
    withStore((s) => {
      s.zlecenia = s.zlecenia.filter((x) => x.id !== id);
    });
    res.json({ ok: true });
  });

  router.put('/tasks/:id/status', requireAuth, (req, res) => {
    const id = toNum(req.params.id);
    const { status } = req.body || {};
    if (!isValidTaskStatus(status)) return res.status(400).json({ error: 'Nieprawidlowy status zlecenia' });
    const nextStatus = normalizeTaskStatus(status);
    const row = withStore((s) => {
      const z = s.zlecenia.find((x) => x.id === id);
      if (!z || !canViewTask(s, req.user, id)) return null;
      const prevStatus = z.status;
      z.status = nextStatus;
      ensureWorkflowCollections(s);
      const key = String(id);
      if (!s.taskWorkflowEvents[key]) s.taskWorkflowEvents[key] = [];
      s.taskWorkflowEvents[key].push({
        id: s.nextTaskWorkflowEventId++,
        type: 'status_change',
        from: prevStatus,
        to: z.status,
        by: req.user.id,
        by_name: userName(s, req.user.id),
        created_at: new Date().toISOString(),
      });
      const cfg = (s.taskIntegrations && s.taskIntegrations[key]) || null;
      if (!cfg || cfg.auto_on_status !== false) {
        pushIntegrationEvent(
          s,
          id,
          req.user.id,
          'sms',
          `Zmiana statusu: ${prevStatus || '-'} -> ${z.status || '-'}`,
          { from: prevStatus, to: z.status }
        );
        pushIntegrationEvent(
          s,
          id,
          req.user.id,
          'email',
          `Status zlecenia #${id}: ${z.status || '-'}`,
          { from: prevStatus, to: z.status }
        );
      }
      return enrichRow(s, z);
    });
    if (!row) return res.status(404).json({ error: 'Nie znaleziono' });
    res.json(row);
  });

  router.put('/tasks/:id/przypisz', requireAuth, (req, res) => {
    const id = toNum(req.params.id);
    const ekipaId = toNum(req.body?.ekipa_id);
    if (!canManageTasks(req.user)) return res.status(403).json({ error: 'Brak uprawnien do przypisania ekipy' });
    const row = withStore((s) => {
      const z = s.zlecenia.find((x) => x.id === id);
      if (!z || !canViewTask(s, req.user, id)) return null;
      const branchError = teamBranchError(s, ekipaId, z.oddzial_id, delegationDay(z.data_wykonania || z.data_planowana));
      if (branchError) return { error: branchError, status: 409 };
      z.ekipa_id = ekipaId;
      if (normalizeTaskStatus(z.status) === TASK_STATUS.DO_ZATWIERDZENIA) z.status = TASK_STATUS.ZAPLANOWANE;
      return { data: enrichRow(s, z) };
    });
    if (row?._forbidden) return res.status(403).json({ error: 'Brak dostepu do oddzialu' });
    if (!row) return res.status(404).json({ error: 'Nie znaleziono' });
    if (row?.error) return res.status(row.status || 400).json({ error: row.error });
    res.json(row.data);
  });

  router.get('/tasks/:id/logi', requireAuth, (req, res) => {
    const id = toNum(req.params.id);
    const ok = readOnly((s) => canViewTask(s, req.user, id));
    if (!ok) return res.status(404).json({ error: 'Nie znaleziono' });
    const list = readOnly((s) => (s.taskLogs && s.taskLogs[String(id)]) || []);
    res.json(list);
  });

  router.get('/tasks/:id/workflow', requireAuth, (req, res) => {
    const id = toNum(req.params.id);
    if (!readOnly((s) => canViewTask(s, req.user, id))) return res.status(404).json({ error: 'Nie znaleziono' });
    const payload = readOnly((s) => {
      ensureWorkflowCollections(s);
      const k = String(id);
      const checklist = (s.taskChecklist[k] || []).slice().sort((a, b) => Number(a.done) - Number(b.done));
      const reminders = (s.taskReminders[k] || []).slice().sort((a, b) => new Date(a.due_at || 0).getTime() - new Date(b.due_at || 0).getTime());
      const events = (s.taskWorkflowEvents[k] || []).slice().sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      const overdueCount = reminders.filter((r) => !r.done && r.due_at && new Date(r.due_at).getTime() < Date.now()).length;
      return {
        checklist,
        reminders,
        events,
        sla: {
          checklist_done: checklist.filter((x) => x.done).length,
          checklist_total: checklist.length,
          reminders_overdue: overdueCount,
        },
      };
    });
    res.json(payload);
  });

  router.get('/tasks/:id/integrations', requireAuth, (req, res) => {
    const id = toNum(req.params.id);
    if (!readOnly((s) => canViewTask(s, req.user, id))) return res.status(404).json({ error: 'Nie znaleziono' });
    const data = readOnly((s) => {
      ensureIntegrationsCollections(s);
      const settings = s.taskIntegrations[String(id)] || {
        sms: true,
        email: true,
        push: true,
        auto_on_status: true,
        auto_on_reminder: true,
      };
      const logs = (s.integrationLogs || [])
        .filter((x) => x.task_id === id)
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      return { settings, logs };
    });
    res.json(data);
  });

  router.patch('/tasks/:id/integrations/settings', requireAuth, (req, res) => {
    const id = toNum(req.params.id);
    const row = withStore((s) => {
      const z = s.zlecenia.find((x) => x.id === id);
      if (!z || !canViewTask(s, req.user, id)) return null;
      ensureIntegrationsCollections(s);
      const key = String(id);
      const current = s.taskIntegrations[key] || {
        sms: true,
        email: true,
        push: true,
        auto_on_status: true,
        auto_on_reminder: true,
      };
      const next = { ...current };
      for (const k of ['sms', 'email', 'push', 'auto_on_status', 'auto_on_reminder']) {
        if (req.body?.[k] != null) next[k] = !!req.body[k];
      }
      s.taskIntegrations[key] = next;
      return next;
    });
    if (!row) return res.status(404).json({ error: 'Nie znaleziono' });
    res.json(row);
  });

  router.post('/tasks/:id/integrations/send-test', requireAuth, (req, res) => {
    const id = toNum(req.params.id);
    const channel = String(req.body?.channel || '').trim();
    const title = String(req.body?.title || 'Test integracji').trim();
    if (!['sms', 'email', 'push'].includes(channel)) return res.status(400).json({ error: 'Nieprawidlowy channel' });
    const row = withStore((s) => {
      const z = s.zlecenia.find((x) => x.id === id);
      if (!z || !canViewTask(s, req.user, id)) return null;
      return pushIntegrationEvent(s, id, req.user.id, channel, title, { test: true });
    });
    if (!row) return res.status(404).json({ error: 'Nie znaleziono' });
    res.status(201).json(row);
  });

  router.get('/integrations/stats', requireAuth, (_req, res) => {
    const stats = readOnly((s) => {
      ensureIntegrationsCollections(s);
      const logs = s.integrationLogs || [];
      const byChannel = { sms: 0, email: 0, push: 0 };
      let sent_demo = 0;
      for (const l of logs) {
        if (byChannel[l.channel] != null) byChannel[l.channel] += 1;
        if (l.status === 'sent_demo') sent_demo += 1;
      }
      const retryAudit = s.integrationRetryAudit || [];
      const retryByUser = {};
      for (const a of retryAudit) {
        const key = a.actor_user_name || String(a.actor_user_id);
        retryByUser[key] = (retryByUser[key] || 0) + 1;
      }
      return {
        total: logs.length,
        sent_demo,
        byChannel,
        retry_audit_total: retryAudit.length,
        retry_by_user: retryByUser,
        denylist: s.integrationRetryDenylist || { users: [], channels: [] },
      };
    });
    res.json(stats);
  });

  router.get('/integrations/security', requireAuth, (req, res) => {
    if (!canManageIntegrations(req.user)) return res.status(403).json({ error: 'Brak uprawnień' });
    const data = readOnly((s) => {
      ensureIntegrationsCollections(s);
      return {
        denylist: s.integrationRetryDenylist || { users: [], channels: [] },
        retry_buckets: s.integrationRetryBuckets || {},
        denylist_history: (s.integrationDenylistHistory || []).slice().sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, 200),
      };
    });
    res.json(data);
  });

  router.patch('/integrations/security/denylist', requireAuth, (req, res) => {
    if (!['Prezes', 'Dyrektor'].includes(req.user?.rola)) return res.status(403).json({ error: 'Brak uprawnień' });
    const users = Array.isArray(req.body?.users) ? req.body.users.map((x) => toNum(x)).filter(Boolean) : null;
    const channels = Array.isArray(req.body?.channels)
      ? req.body.channels.map((x) => String(x)).filter((x) => ['sms', 'email', 'push'].includes(x))
      : null;
    const row = withStore((s) => {
      ensureIntegrationsCollections(s);
      const current = s.integrationRetryDenylist || { users: [], channels: [] };
      const next = {
        users: users || current.users || [],
        channels: channels || current.channels || [],
      };
      s.integrationRetryDenylist = next;
      s.integrationDenylistHistory.push({
        id: s.nextIntegrationDenylistHistoryId++,
        action: 'manual_update',
        actor_user_id: req.user.id,
        actor_user_name: userName(s, req.user.id),
        prev: current,
        next,
        created_at: new Date().toISOString(),
      });
      return next;
    });
    res.json(row);
  });

  router.post('/integrations/security/denylist/preset', requireAuth, (req, res) => {
    if (!['Prezes', 'Dyrektor'].includes(req.user?.rola)) return res.status(403).json({ error: 'Brak uprawnień' });
    const preset = String(req.body?.preset || '');
    const row = withStore((s) => {
      ensureIntegrationsCollections(s);
      const current = s.integrationRetryDenylist || { users: [], channels: [] };
      let next = { ...current };
      if (preset === 'block_sms_global') {
        next = { ...current, channels: [...new Set([...(current.channels || []), 'sms'])] };
      } else if (preset === 'allow_all_channels') {
        next = { ...current, channels: [] };
      } else if (preset === 'clear_all') {
        next = { users: [], channels: [] };
      } else {
        return null;
      }
      s.integrationRetryDenylist = next;
      s.integrationDenylistHistory.push({
        id: s.nextIntegrationDenylistHistoryId++,
        action: `preset:${preset}`,
        actor_user_id: req.user.id,
        actor_user_name: userName(s, req.user.id),
        prev: current,
        next,
        created_at: new Date().toISOString(),
      });
      return next;
    });
    if (!row) return res.status(400).json({ error: 'Nieznany preset' });
    res.json(row);
  });

  router.post('/integrations/security/denylist/rollback/:historyId', requireAuth, (req, res) => {
    if (!['Prezes', 'Dyrektor'].includes(req.user?.rola)) return res.status(403).json({ error: 'Brak uprawnień' });
    const historyId = toNum(req.params.historyId);
    const row = withStore((s) => {
      ensureIntegrationsCollections(s);
      const h = (s.integrationDenylistHistory || []).find((x) => x.id === historyId);
      if (!h) return null;
      const createdAtMs = new Date(h.created_at || 0).getTime();
      const maxAgeMs = DENYLIST_ROLLBACK_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
      if (!createdAtMs || Date.now() - createdAtMs > maxAgeMs) return { too_old: true };
      const current = s.integrationRetryDenylist || { users: [], channels: [] };
      const next = {
        users: Array.isArray(h.next?.users) ? h.next.users : [],
        channels: Array.isArray(h.next?.channels) ? h.next.channels : [],
      };
      s.integrationRetryDenylist = next;
      s.integrationDenylistHistory.push({
        id: s.nextIntegrationDenylistHistoryId++,
        action: `rollback:${historyId}`,
        actor_user_id: req.user.id,
        actor_user_name: userName(s, req.user.id),
        prev: current,
        next,
        created_at: new Date().toISOString(),
      });
      return next;
    });
    if (row?.too_old) {
      return res.status(400).json({ error: `Rollback dostępny tylko do ${DENYLIST_ROLLBACK_MAX_AGE_DAYS} dni wstecz` });
    }
    if (!row) return res.status(404).json({ error: 'Nie znaleziono wpisu historii' });
    res.json(row);
  });

  router.get('/integrations/logs', requireAuth, (req, res) => {
    const taskId = toNum(req.query?.task_id);
    const channel = req.query?.channel ? String(req.query.channel) : null;
    const status = req.query?.status ? String(req.query.status) : null;
    const page = Math.max(1, toNum(req.query?.page) || 1);
    const pageSizeRaw = toNum(req.query?.page_size) || 25;
    const pageSize = Math.min(200, Math.max(1, pageSizeRaw));
    const sortBy = String(req.query?.sort_by || 'created_at');
    const sortDir = String(req.query?.sort_dir || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';
    const data = readOnly((s) => {
      ensureIntegrationsCollections(s);
      let logs = (s.integrationLogs || []).slice();
      if (taskId) logs = logs.filter((x) => x.task_id === taskId);
      if (channel) logs = logs.filter((x) => x.channel === channel);
      if (status) logs = logs.filter((x) => x.status === status);
      logs.sort((a, b) => {
        const aVal = a[sortBy];
        const bVal = b[sortBy];
        if (sortBy === 'created_at') {
          const diff = new Date(aVal || 0).getTime() - new Date(bVal || 0).getTime();
          return sortDir === 'asc' ? diff : -diff;
        }
        if (aVal == null && bVal == null) return 0;
        if (aVal == null) return sortDir === 'asc' ? -1 : 1;
        if (bVal == null) return sortDir === 'asc' ? 1 : -1;
        const diff = String(aVal).localeCompare(String(bVal), 'pl');
        return sortDir === 'asc' ? diff : -diff;
      });
      const total = logs.length;
      const offset = (page - 1) * pageSize;
      const items = logs.slice(offset, offset + pageSize);
      return { items, total, page, page_size: pageSize, total_pages: Math.max(1, Math.ceil(total / pageSize)) };
    });
    res.json(data);
  });

  router.get('/integrations/logs/export', requireAuth, (req, res) => {
    const taskId = toNum(req.query?.task_id);
    const channel = req.query?.channel ? String(req.query.channel) : null;
    const status = req.query?.status ? String(req.query.status) : null;
    const rows = readOnly((s) => {
      ensureIntegrationsCollections(s);
      let logs = (s.integrationLogs || []).slice();
      if (taskId) logs = logs.filter((x) => x.task_id === taskId);
      if (channel) logs = logs.filter((x) => x.channel === channel);
      if (status) logs = logs.filter((x) => x.status === status);
      return logs.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    });
    const header = ['id', 'created_at', 'channel', 'task_id', 'title', 'status', 'created_by_name'];
    const csv = [
      header.join(','),
      ...rows.map((l) =>
        [l.id, l.created_at, l.channel, l.task_id, l.title, l.status, l.created_by_name]
          .map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`)
          .join(',')
      ),
    ].join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="integrations-logs-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(csv);
  });

  router.post('/integrations/logs/:id/retry', requireAuth, (req, res) => {
    if (!canManageIntegrations(req.user)) return res.status(403).json({ error: 'Brak uprawnień do retry' });
    const id = toNum(req.params.id);
    const row = withStore((s) => {
      ensureIntegrationsCollections(s);
      const rate = checkRetryRateLimit(s, req.user.id);
      if (!rate.ok) return { rate_limited: true, retry_after_ms: rate.retry_after_ms };
      const src = (s.integrationLogs || []).find((x) => x.id === id);
      if (!src) return null;
      if (!canRetryChannel(req.user, src.channel)) return { forbidden_channel: true, channel: src.channel };
      if (isRetryDenied(s, req.user.id, src.channel)) return { denylisted: true };
      const retry = pushIntegrationEvent(
        s,
        src.task_id,
        req.user.id,
        src.channel,
        `RETRY: ${src.title}`,
        { retry_of: src.id }
      );
      if (retry) {
        s.integrationRetryAudit.push({
          id: s.nextIntegrationRetryAuditId++,
          mode: 'single',
          actor_user_id: req.user.id,
          actor_user_name: userName(s, req.user.id),
          source_log_id: src.id,
          created_log_id: retry.id,
          created_at: new Date().toISOString(),
          ip: String(req.headers['x-forwarded-for'] || req.ip || ''),
          user_agent: String(req.headers['user-agent'] || ''),
        });
      }
      return retry;
    });
    if (row?.forbidden_channel) return res.status(403).json({ error: `Brak uprawnień do retry kanału ${row.channel}` });
    if (row?.denylisted) return res.status(403).json({ error: 'Retry zablokowany denylistą' });
    if (row?.rate_limited) return res.status(429).json({ error: 'Rate limit retry', retry_after_ms: row.retry_after_ms });
    if (!row) return res.status(404).json({ error: 'Nie znaleziono logu' });
    res.status(201).json(row);
  });

  router.post('/integrations/logs/retry-batch', requireAuth, (req, res) => {
    if (!canManageIntegrations(req.user)) return res.status(403).json({ error: 'Brak uprawnień do retry' });
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map((x) => toNum(x)).filter(Boolean) : [];
    if (!ids.length) return res.status(400).json({ error: 'Brak id logow' });
    let rateLimited = false;
    let retryAfterMs = 0;
    const out = withStore((s) => {
      ensureIntegrationsCollections(s);
      const rows = [];
      for (const id of ids) {
        const rate = checkRetryRateLimit(s, req.user.id);
        if (!rate.ok) {
          rateLimited = true;
          retryAfterMs = rate.retry_after_ms || 0;
          break;
        }
        const src = (s.integrationLogs || []).find((x) => x.id === id);
        if (!src) continue;
        if (!canRetryChannel(req.user, src.channel)) continue;
        if (isRetryDenied(s, req.user.id, src.channel)) continue;
        const retry = pushIntegrationEvent(
          s,
          src.task_id,
          req.user.id,
          src.channel,
          `RETRY: ${src.title}`,
          { retry_of: src.id, batch: true }
        );
        if (retry) {
          rows.push(retry);
          s.integrationRetryAudit.push({
            id: s.nextIntegrationRetryAuditId++,
            mode: 'batch',
            actor_user_id: req.user.id,
            actor_user_name: userName(s, req.user.id),
            source_log_id: src.id,
            created_log_id: retry.id,
            created_at: new Date().toISOString(),
            ip: String(req.headers['x-forwarded-for'] || req.ip || ''),
            user_agent: String(req.headers['user-agent'] || ''),
          });
        }
      }
      return rows;
    });
    res.status(201).json({ ok: true, retried: out.length, rows: out, rate_limited: rateLimited, retry_after_ms: retryAfterMs });
  });

  router.get('/integrations/retry-audit', requireAuth, (_req, res) => {
    const list = readOnly((s) => {
      ensureIntegrationsCollections(s);
      return (s.integrationRetryAudit || [])
        .slice()
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 500);
    });
    res.json(list);
  });

  router.post('/tasks/:id/workflow/checklist', requireAuth, (req, res) => {
    const id = toNum(req.params.id);
    const text = String(req.body?.text || '').trim();
    if (!text) return res.status(400).json({ error: 'Brak tresci checklisty' });
    const row = withStore((s) => {
      const z = s.zlecenia.find((x) => x.id === id);
      if (!z || !canViewTask(s, req.user, id)) return null;
      ensureWorkflowCollections(s);
      const k = String(id);
      if (!s.taskChecklist[k]) s.taskChecklist[k] = [];
      const item = {
        id: s.nextTaskChecklistId++,
        text: text.slice(0, 300),
        done: false,
        created_at: new Date().toISOString(),
        created_by: req.user.id,
        created_by_name: userName(s, req.user.id),
      };
      s.taskChecklist[k].push(item);
      return item;
    });
    if (!row) return res.status(404).json({ error: 'Nie znaleziono' });
    res.status(201).json(row);
  });

  router.patch('/tasks/:id/workflow/checklist/:itemId', requireAuth, (req, res) => {
    const id = toNum(req.params.id);
    const itemId = toNum(req.params.itemId);
    const row = withStore((s) => {
      const z = s.zlecenia.find((x) => x.id === id);
      if (!z || !canViewTask(s, req.user, id)) return null;
      ensureWorkflowCollections(s);
      const k = String(id);
      const item = (s.taskChecklist[k] || []).find((x) => x.id === itemId);
      if (!item) return null;
      if (req.body?.text != null) item.text = String(req.body.text).slice(0, 300);
      if (req.body?.done != null) item.done = !!req.body.done;
      item.updated_at = new Date().toISOString();
      item.updated_by = req.user.id;
      item.updated_by_name = userName(s, req.user.id);
      return item;
    });
    if (!row) return res.status(404).json({ error: 'Nie znaleziono' });
    res.json(row);
  });

  router.delete('/tasks/:id/workflow/checklist/:itemId', requireAuth, (req, res) => {
    const id = toNum(req.params.id);
    const itemId = toNum(req.params.itemId);
    const ok = withStore((s) => {
      const z = s.zlecenia.find((x) => x.id === id);
      if (!z || !canViewTask(s, req.user, id)) return false;
      ensureWorkflowCollections(s);
      const k = String(id);
      const arr = s.taskChecklist[k] || [];
      const before = arr.length;
      s.taskChecklist[k] = arr.filter((x) => x.id !== itemId);
      return s.taskChecklist[k].length !== before;
    });
    if (!ok) return res.status(404).json({ error: 'Nie znaleziono' });
    res.json({ ok: true });
  });

  router.post('/tasks/:id/workflow/reminders', requireAuth, (req, res) => {
    const id = toNum(req.params.id);
    const title = String(req.body?.title || '').trim();
    const dueAt = req.body?.due_at ? new Date(req.body.due_at).toISOString() : null;
    if (!title) return res.status(400).json({ error: 'Brak tytulu przypomnienia' });
    const row = withStore((s) => {
      const z = s.zlecenia.find((x) => x.id === id);
      if (!z || !canViewTask(s, req.user, id)) return null;
      ensureWorkflowCollections(s);
      const k = String(id);
      if (!s.taskReminders[k]) s.taskReminders[k] = [];
      const item = {
        id: s.nextTaskReminderId++,
        title: title.slice(0, 300),
        due_at: dueAt,
        done: false,
        created_at: new Date().toISOString(),
        created_by: req.user.id,
        created_by_name: userName(s, req.user.id),
      };
      s.taskReminders[k].push(item);
      const cfg = (s.taskIntegrations && s.taskIntegrations[k]) || null;
      if (!cfg || cfg.auto_on_reminder !== false) {
        pushIntegrationEvent(
          s,
          id,
          req.user.id,
          'push',
          `Nowe przypomnienie: ${item.title}`,
          { due_at: item.due_at || null }
        );
      }
      return item;
    });
    if (!row) return res.status(404).json({ error: 'Nie znaleziono' });
    res.status(201).json(row);
  });

  router.patch('/tasks/:id/workflow/reminders/:reminderId', requireAuth, (req, res) => {
    const id = toNum(req.params.id);
    const reminderId = toNum(req.params.reminderId);
    const row = withStore((s) => {
      const z = s.zlecenia.find((x) => x.id === id);
      if (!z || !canViewTask(s, req.user, id)) return null;
      ensureWorkflowCollections(s);
      const k = String(id);
      const item = (s.taskReminders[k] || []).find((x) => x.id === reminderId);
      if (!item) return null;
      if (req.body?.title != null) item.title = String(req.body.title).slice(0, 300);
      if (req.body?.due_at != null) item.due_at = req.body.due_at ? new Date(req.body.due_at).toISOString() : null;
      if (req.body?.done != null) item.done = !!req.body.done;
      item.updated_at = new Date().toISOString();
      item.updated_by = req.user.id;
      item.updated_by_name = userName(s, req.user.id);
      return item;
    });
    if (!row) return res.status(404).json({ error: 'Nie znaleziono' });
    res.json(row);
  });

  router.delete('/tasks/:id/workflow/reminders/:reminderId', requireAuth, (req, res) => {
    const id = toNum(req.params.id);
    const reminderId = toNum(req.params.reminderId);
    const ok = withStore((s) => {
      const z = s.zlecenia.find((x) => x.id === id);
      if (!z || !canViewTask(s, req.user, id)) return false;
      ensureWorkflowCollections(s);
      const k = String(id);
      const arr = s.taskReminders[k] || [];
      const before = arr.length;
      s.taskReminders[k] = arr.filter((x) => x.id !== reminderId);
      return s.taskReminders[k].length !== before;
    });
    if (!ok) return res.status(404).json({ error: 'Nie znaleziono' });
    res.json({ ok: true });
  });

  router.post('/tasks/:id/logi', requireAuth, (req, res) => {
    const id = toNum(req.params.id);
    const b = req.body || {};
    const row = withStore((s) => {
      const z = s.zlecenia.find((x) => x.id === id);
      if (!z || !canViewTask(s, req.user, id)) return null;
      if (!s.taskLogs) s.taskLogs = {};
      const k = String(id);
      if (!s.taskLogs[k]) s.taskLogs[k] = [];
      const lid = s.nextTaskLogId++;
      const now = new Date().toISOString();
      const pr = userName(s, req.user.id);
      const entry = {
        id: lid,
        pracownik: b.tresc ? `${pr} — ${b.tresc}` : pr,
        tresc: b.tresc || '',
        start_time: now,
        end_time: now,
        duration_hours: Number(b.duration_hours) || 0,
        czas_pracy_minuty: Number(b.czas_pracy_minuty) || 0,
        status: ['Zakonczone', 'Zakończony'].includes(String(b.status)) ? 'Zakończony' : 'W trakcie',
      };
      s.taskLogs[k].push(entry);
      return entry;
    });
    if (!row) return res.status(404).json({ error: 'Nie znaleziono' });
    res.status(201).json(row);
  });

  router.get('/tasks/:id/problemy', requireAuth, (req, res) => {
    const id = toNum(req.params.id);
    if (!readOnly((s) => canViewTask(s, req.user, id))) return res.status(404).json({ error: 'Nie znaleziono' });
    const list = readOnly((s) => (s.taskProblemy && s.taskProblemy[String(id)]) || []);
    res.json(list);
  });

  router.get('/tasks/:id/zdjecia', requireAuth, (req, res) => {
    const id = toNum(req.params.id);
    if (!readOnly((s) => canViewTask(s, req.user, id))) return res.status(404).json({ error: 'Nie znaleziono' });
    const list = readOnly((s) => (s.taskZdjecia && s.taskZdjecia[String(id)]) || []);
    res.json(list);
  });

  router.get('/tasks/:id/wideo', requireAuth, (req, res) => {
    const id = toNum(req.params.id);
    if (!readOnly((s) => canViewTask(s, req.user, id))) return res.status(404).json({ error: 'Nie znaleziono' });
    const list = readOnly((s) => (s.taskWideo && s.taskWideo[String(id)]) || []);
    res.json(list);
  });

  router.get('/tasks/:id/dokumenty', requireAuth, (req, res) => {
    const id = toNum(req.params.id);
    if (!readOnly((s) => canViewTask(s, req.user, id))) return res.status(404).json({ error: 'Nie znaleziono' });
    const list = readOnly((s) => (s.taskDokumenty && s.taskDokumenty[String(id)]) || []);
    res.json(list);
  });

  router.post('/tasks/:id/zdjecia', requireAuth, upZdj.single('zdjecie'), (req, res) => {
    try {
      const id = toNum(req.params.id);
      if (!req.file) return res.status(400).json({ error: 'Brak pliku (pole: zdjecie)' });
      const rel = `/api/uploads/zlecenia/${id}/${req.file.filename}`;
      const row = withStore((s) => {
        const z = s.zlecenia.find((x) => x.id === id);
        if (!z || !canViewTask(s, req.user, id)) return null;
        if (!s.taskZdjecia) s.taskZdjecia = {};
        const k = String(id);
        if (!s.taskZdjecia[k]) s.taskZdjecia[k] = [];
        const zid = s.nextTaskZdjecieId++;
        const typ = req.body?.typ || 'inne';
        const opisRaw = req.body?.opis;
        const opis =
          opisRaw != null && String(opisRaw).trim() ? String(opisRaw).trim().slice(0, 4000) : undefined;
        let tagi = [];
        const tagiRaw = req.body?.tagi;
        if (tagiRaw != null && String(tagiRaw).trim()) {
          const s = String(tagiRaw).trim();
          try {
            const p = JSON.parse(s);
            tagi = (Array.isArray(p) ? p : [s])
              .map((x) => String(x ?? '').trim())
              .filter(Boolean)
              .map((x) => x.slice(0, 80))
              .slice(0, 20);
          } catch {
            tagi = s
              .split(/[,;]+/)
              .map((x) => x.trim())
              .filter(Boolean)
              .map((x) => x.slice(0, 80))
              .slice(0, 20);
          }
        }
        const meta = {
          id: zid,
          typ,
          sciezka: rel,
          created_at: new Date().toISOString(),
          ...(opis ? { opis } : {}),
          ...(tagi.length ? { tagi } : {}),
        };
        s.taskZdjecia[k].push(meta);
        return meta;
      });
      if (!row) return res.status(404).json({ error: 'Nie znaleziono' });
      res.status(201).json(row);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.patch('/tasks/:id/zdjecia/:mediaId', requireAuth, (req, res) => {
    const id = toNum(req.params.id);
    const mediaId = toNum(req.params.mediaId);
    const body = req.body || {};
    const row = withStore((s) => {
      const z = s.zlecenia.find((x) => x.id === id);
      if (!z || !canViewTask(s, req.user, id)) return null;
      const list = (s.taskZdjecia && s.taskZdjecia[String(id)]) || [];
      const item = list.find((x) => x.id === mediaId);
      if (!item) return null;
      if (body.typ != null) item.typ = String(body.typ);
      if (body.opis != null) item.opis = String(body.opis).slice(0, 500);
      if (body.tagi != null) {
        const tags = Array.isArray(body.tagi)
          ? body.tagi
          : String(body.tagi).split(',').map((x) => x.trim()).filter(Boolean);
        item.tagi = tags.slice(0, 20);
      }
      item.updated_at = new Date().toISOString();
      item.updated_by = req.user.id;
      return item;
    });
    if (!row) return res.status(404).json({ error: 'Nie znaleziono' });
    res.json(row);
  });

  router.delete('/tasks/:id/zdjecia/:mediaId', requireAuth, (req, res) => {
    const id = toNum(req.params.id);
    const mediaId = toNum(req.params.mediaId);
    const removed = withStore((s) => {
      const z = s.zlecenia.find((x) => x.id === id);
      if (!z || !canViewTask(s, req.user, id)) return null;
      const key = String(id);
      const list = (s.taskZdjecia && s.taskZdjecia[key]) || [];
      const idx = list.findIndex((x) => x.id === mediaId);
      if (idx < 0) return null;
      const [item] = list.splice(idx, 1);
      return item;
    });
    if (!removed) return res.status(404).json({ error: 'Nie znaleziono' });
    safeUnlink(path.join(__dirname, '..', removed.sciezka.replace('/api/', '')));
    res.json({ ok: true });
  });

  router.post('/tasks/:id/wideo', requireAuth, upWideo.single('wideo'), (req, res) => {
    try {
      const id = toNum(req.params.id);
      if (!req.file) return res.status(400).json({ error: 'Brak pliku (pole: wideo)' });
      const rel = `/api/uploads/zlecenia/${id}/${req.file.filename}`;
      const row = withStore((s) => {
        const z = s.zlecenia.find((x) => x.id === id);
        if (!z || !canViewTask(s, req.user, id)) return null;
        if (!s.taskWideo) s.taskWideo = {};
        const k = String(id);
        if (!s.taskWideo[k]) s.taskWideo[k] = [];
        if (!s.nextTaskWideoId) s.nextTaskWideoId = 1;
        const wid = s.nextTaskWideoId++;
        const meta = {
          id: wid,
          nazwa: req.file.originalname,
          sciezka: rel,
          mime: req.file.mimetype || 'video/mp4',
          size: req.file.size || 0,
          created_at: new Date().toISOString(),
          autor: userName(s, req.user.id),
        };
        s.taskWideo[k].push(meta);
        return meta;
      });
      if (!row) return res.status(404).json({ error: 'Nie znaleziono' });
      res.status(201).json(row);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post('/tasks/:id/dokumenty', requireAuth, upDok.single('dokument'), (req, res) => {
    try {
      const id = toNum(req.params.id);
      if (!req.file) return res.status(400).json({ error: 'Brak pliku (pole: dokument)' });
      const rel = `/api/uploads/zlecenia/${id}/docs/${req.file.filename}`;
      const row = withStore((s) => {
        const z = s.zlecenia.find((x) => x.id === id);
        if (!z || !canViewTask(s, req.user, id)) return null;
        if (!s.taskDokumenty) s.taskDokumenty = {};
        if (!s.nextTaskDokumentId) s.nextTaskDokumentId = 1;
        const k = String(id);
        if (!s.taskDokumenty[k]) s.taskDokumenty[k] = [];
        const item = {
          id: s.nextTaskDokumentId++,
          nazwa: req.file.originalname,
          sciezka: rel,
          mime: req.file.mimetype || 'application/octet-stream',
          size: req.file.size || 0,
          kategoria: String(req.body?.kategoria || 'inne'),
          status: String(req.body?.status || 'roboczy'),
          opis: String(req.body?.opis || '').slice(0, 600),
          wersja: 1,
          created_at: new Date().toISOString(),
          created_by: req.user.id,
          created_by_name: userName(s, req.user.id),
        };
        s.taskDokumenty[k].push(item);
        return item;
      });
      if (!row) return res.status(404).json({ error: 'Nie znaleziono' });
      res.status(201).json(row);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.patch('/tasks/:id/dokumenty/:docId', requireAuth, (req, res) => {
    const id = toNum(req.params.id);
    const docId = toNum(req.params.docId);
    const row = withStore((s) => {
      const z = s.zlecenia.find((x) => x.id === id);
      if (!z || !canViewTask(s, req.user, id)) return null;
      const k = String(id);
      const item = ((s.taskDokumenty && s.taskDokumenty[k]) || []).find((x) => x.id === docId);
      if (!item) return null;
      if (req.body?.kategoria != null) item.kategoria = String(req.body.kategoria);
      if (req.body?.status != null) item.status = String(req.body.status);
      if (req.body?.opis != null) item.opis = String(req.body.opis).slice(0, 600);
      if (req.body?.nazwa != null) item.nazwa = String(req.body.nazwa).slice(0, 180);
      if (req.body?.bump_version) item.wersja = Number(item.wersja || 1) + 1;
      item.updated_at = new Date().toISOString();
      item.updated_by = req.user.id;
      item.updated_by_name = userName(s, req.user.id);
      return item;
    });
    if (!row) return res.status(404).json({ error: 'Nie znaleziono' });
    res.json(row);
  });

  router.delete('/tasks/:id/dokumenty/:docId', requireAuth, (req, res) => {
    const id = toNum(req.params.id);
    const docId = toNum(req.params.docId);
    const removed = withStore((s) => {
      const z = s.zlecenia.find((x) => x.id === id);
      if (!z || !canViewTask(s, req.user, id)) return null;
      const k = String(id);
      const list = (s.taskDokumenty && s.taskDokumenty[k]) || [];
      const idx = list.findIndex((x) => x.id === docId);
      if (idx < 0) return null;
      const [item] = list.splice(idx, 1);
      return item;
    });
    if (!removed) return res.status(404).json({ error: 'Nie znaleziono' });
    safeUnlink(path.join(__dirname, '..', removed.sciezka.replace('/api/', '')));
    res.json({ ok: true });
  });

  router.patch('/tasks/:id/wideo/:mediaId', requireAuth, (req, res) => {
    const id = toNum(req.params.id);
    const mediaId = toNum(req.params.mediaId);
    const body = req.body || {};
    const row = withStore((s) => {
      const z = s.zlecenia.find((x) => x.id === id);
      if (!z || !canViewTask(s, req.user, id)) return null;
      const list = (s.taskWideo && s.taskWideo[String(id)]) || [];
      const item = list.find((x) => x.id === mediaId);
      if (!item) return null;
      if (body.nazwa != null) item.nazwa = String(body.nazwa).slice(0, 160);
      if (body.opis != null) item.opis = String(body.opis).slice(0, 500);
      if (body.tagi != null) {
        const tags = Array.isArray(body.tagi)
          ? body.tagi
          : String(body.tagi).split(',').map((x) => x.trim()).filter(Boolean);
        item.tagi = tags.slice(0, 20);
      }
      item.updated_at = new Date().toISOString();
      item.updated_by = req.user.id;
      return item;
    });
    if (!row) return res.status(404).json({ error: 'Nie znaleziono' });
    res.json(row);
  });

  router.delete('/tasks/:id/wideo/:mediaId', requireAuth, (req, res) => {
    const id = toNum(req.params.id);
    const mediaId = toNum(req.params.mediaId);
    const removed = withStore((s) => {
      const z = s.zlecenia.find((x) => x.id === id);
      if (!z || !canViewTask(s, req.user, id)) return null;
      const key = String(id);
      const list = (s.taskWideo && s.taskWideo[key]) || [];
      const idx = list.findIndex((x) => x.id === mediaId);
      if (idx < 0) return null;
      const [item] = list.splice(idx, 1);
      return item;
    });
    if (!removed) return res.status(404).json({ error: 'Nie znaleziono' });
    safeUnlink(path.join(__dirname, '..', removed.sciezka.replace('/api/', '')));
    res.json({ ok: true });
  });

  router.get('/dniowki/zlecenie/:id', requireAuth, (req, res) => {
    const id = toNum(req.params.id);
    if (!readOnly((s) => canViewTask(s, req.user, id))) return res.status(404).json({ error: 'Nie znaleziono' });
    const dniowki = readOnly((s) => (s.dniowki || []).filter((d) => d.zlecenie_id === id));
    res.json({ dniowki });
  });

  router.get('/sms/historia', requireAuth, (req, res) => {
    const list = readOnly((s) => {
      const logs = Array.isArray(s.smsLogs) ? s.smsLogs : [];
      const isMgmt = ['Prezes', 'Dyrektor', 'Kierownik'].includes(req.user.rola);
      const visible = isMgmt ? logs : logs.filter((x) => x.created_by === req.user.id);
      return visible
        .slice()
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .map((x) => ({
          ...x,
          created_by_name: userName(s, x.created_by) || null,
          updated_by_name: userName(s, x.updated_by) || null,
        }));
    });
    res.json(list);
  });

  router.post('/sms/zlecenie/:id', requireAuth, (req, res) => {
    const id = toNum(req.params.id);
    const typ = req.body?.typ || 'manual';
    const row = withStore((s) => {
      const z = s.zlecenia.find((x) => x.id === id);
      if (!z) return null;
      if (!s.smsLogs) s.smsLogs = [];
      if (!s.nextSmsLogId) {
        const maxId = s.smsLogs.reduce((m, x) => Math.max(m, Number(x.id) || 0), 0);
        s.nextSmsLogId = maxId + 1;
      }
      const log = {
        id: s.nextSmsLogId++,
        task_id: id,
        typ,
        recipient_name: z.klient_nazwa || null,
        recipient_phone: z.klient_telefon || null,
        status: z.klient_telefon ? 'wyslano_demo' : 'brak_numeru',
        created_by: req.user.id,
        created_at: new Date().toISOString(),
      };
      s.smsLogs.push(log);
      return log;
    });
    if (!row) return res.status(404).json({ error: 'Nie znaleziono zlecenia' });
    res.json({ ok: true, demo: true, ...row });
  });

  router.post('/sms/manual', requireAuth, (req, res) => {
    const phone = String(req.body?.recipient_phone || '').trim();
    const text = String(req.body?.text || '').trim();
    const recipientName = String(req.body?.recipient_name || '').trim() || null;
    const typ = req.body?.typ || 'manual_text';
    if (!phone) return res.status(400).json({ error: 'Brak numeru telefonu' });
    if (!text) return res.status(400).json({ error: 'Brak tresci SMS' });

    const row = withStore((s) => {
      if (!s.smsLogs) s.smsLogs = [];
      if (!s.nextSmsLogId) {
        const maxId = s.smsLogs.reduce((m, x) => Math.max(m, Number(x.id) || 0), 0);
        s.nextSmsLogId = maxId + 1;
      }
      const log = {
        id: s.nextSmsLogId++,
        task_id: null,
        typ,
        recipient_name: recipientName,
        recipient_phone: phone,
        status: 'wyslano_demo',
        created_by: req.user.id,
        created_at: new Date().toISOString(),
        text_preview: text.slice(0, 120),
      };
      s.smsLogs.push(log);
      return log;
    });

    res.status(201).json({ ok: true, demo: true, ...row });
  });

  router.patch('/sms/historia/:id/status', requireAuth, (req, res) => {
    const id = toNum(req.params.id);
    const next = String(req.body?.status || '').trim();
    const allowed = new Set([
      'wyslano_demo',
      'brak_numeru',
      'w_kolejce',
      'dostarczono',
      'blad',
      'anulowano',
    ]);
    if (!allowed.has(next)) {
      return res.status(400).json({ error: 'Nieprawidlowy status' });
    }
    const row = withStore((s) => {
      const logs = Array.isArray(s.smsLogs) ? s.smsLogs : [];
      const item = logs.find((x) => x.id === id);
      if (!item) return null;
      item.status = next;
      item.updated_at = new Date().toISOString();
      item.updated_by = req.user.id;
      return item;
    });
    if (!row) return res.status(404).json({ error: 'Nie znaleziono wpisu SMS' });
    res.json({ ok: true, ...row });
  });

  router.get('/pdf/zlecenie/:id', requireAuth, (req, res) => {
    const id = toNum(req.params.id);
    if (!readOnly((s) => canViewTask(s, req.user, id))) return res.status(404).json({ error: 'Nie znaleziono' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="zlecenie-${id}.pdf"`);
    res.send(MIN_PDF);
  });

  router.get('/pdf/faktura/:id', requireAuth, (req, res) => {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="faktura-${req.params.id}.pdf"`);
    res.send(MIN_PDF);
  });

  router.get('/pdf/cmr/:id', requireAuth, async (req, res) => {
    const id = toNum(req.params.id);
    const row = readOnly((state) => {
      const c = (state.cmrLists || []).find((x) => x.id === id);
      if (!c || !canViewCmr(state, req.user, c)) return null;
      return enrichCmr(state, c);
    });
    if (!row) return res.status(404).json({ error: 'Nie znaleziono' });
    try {
      const pdf = await buildCmrPdfBuffer(row);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="cmr-${String(row.numer || id).replace(/[^\w.-]+/g, '_')}.pdf"`);
      res.send(pdf);
    } catch (e) {
      res.status(500).json({ error: e.message || 'PDF error' });
    }
  });

  router.get('/klienci/:id', requireAuth, (req, res) => {
    const id = toNum(req.params.id);
    const row = readOnly((s) => (s.klienci || []).find((k) => k.id === id));
    if (!row) return res.status(404).json({ error: 'Nie znaleziono' });
    res.json(row);
  });

  router.post('/klienci', requireAuth, (req, res) => {
    const b = req.body || {};
    const row = withStore((s) => {
      const id = s.nextKlientId++;
      const k = {
        id,
        imie: b.imie || '',
        nazwisko: b.nazwisko || '',
        firma: b.firma || null,
        telefon: b.telefon || '',
        email: b.email || null,
        adres: b.adres || '',
        miasto: b.miasto || '',
      };
      s.klienci.push(k);
      return k;
    });
    res.status(201).json(row);
  });

  router.put('/klienci/:id', requireAuth, (req, res) => {
    const id = toNum(req.params.id);
    const b = req.body || {};
    const row = withStore((s) => {
      const k = s.klienci.find((x) => x.id === id);
      if (!k) return null;
      Object.assign(k, b, { id });
      return k;
    });
    if (!row) return res.status(404).json({ error: 'Nie znaleziono' });
    res.json(row);
  });

  router.delete('/klienci/:id', requireAuth, (req, res) => {
    const id = toNum(req.params.id);
    withStore((s) => {
      s.klienci = (s.klienci || []).filter((k) => k.id !== id);
    });
    res.json({ ok: true });
  });

  router.post('/oddzialy', requireAuth, (req, res) => {
    if (!['Prezes', 'Dyrektor'].includes(req.user.rola)) return res.status(403).json({ error: 'Brak uprawnień' });
    const b = req.body || {};
    const row = withStore((s) => {
      const id = s.oddzialy.length ? Math.max(...s.oddzialy.map((o) => o.id)) + 1 : 1;
      const o = {
        id,
        nazwa: b.nazwa,
        miasto: b.miasto || '',
        adres: b.adres || '',
        kod_pocztowy: b.kod_pocztowy || '',
        telefon: b.telefon || '',
        email: b.email || '',
        kierownik_id: toNum(b.kierownik_id),
      };
      s.oddzialy.push(o);
      return o;
    });
    res.status(201).json(row);
  });

  router.put('/oddzialy/:id', requireAuth, (req, res) => {
    if (!['Prezes', 'Dyrektor'].includes(req.user.rola)) return res.status(403).json({ error: 'Brak uprawnień' });
    const id = toNum(req.params.id);
    const b = req.body || {};
    const row = withStore((s) => {
      const o = s.oddzialy.find((x) => x.id === id);
      if (!o) return null;
      Object.assign(o, b, { id });
      return o;
    });
    if (!row) return res.status(404).json({ error: 'Nie znaleziono' });
    res.json(row);
  });

  router.delete('/oddzialy/:id', requireAuth, (req, res) => {
    if (!['Prezes', 'Dyrektor'].includes(req.user.rola)) return res.status(403).json({ error: 'Brak uprawnień' });
    const id = toNum(req.params.id);
    withStore((s) => {
      s.oddzialy = s.oddzialy.filter((o) => o.id !== id);
    });
    res.json({ ok: true });
  });

  router.get('/oddzialy/delegacje/wszystkie', requireAuth, (req, res) => {
    const list = readOnly((s) => (s.delegacje || []).map((d) => enrichDelegacja(s, d)));
    res.json(list);
  });

  router.post('/oddzialy/delegacje', requireAuth, (req, res) => {
    const b = req.body || {};
    const row = withStore((s) => {
      if (!s.delegacje) s.delegacje = [];
      const userId = toNum(b.user_id ?? b.wyceniajacy_id);
      const teamId = toNum(b.ekipa_id);
      const zasobTyp = userId ? 'wyceniajacy' : 'ekipa';
      if (!teamId && !userId) return { error: 'Wybierz ekipe albo wyceniajacego do delegacji.', status: 400 };
      const sourceBranch = toNum(b.oddzial_z);
      const targetBranch = toNum(b.oddzial_do);
      if (!sourceBranch || !targetBranch || sourceBranch === targetBranch) {
        return { error: 'Wybierz dwa rozne oddzialy delegacji.', status: 400 };
      }
      if (teamId) {
        const team = (s.teams || []).find((x) => Number(x.id) === Number(teamId));
        if (!team) return { error: 'Nie znaleziono ekipy do delegacji.', status: 400 };
        if (Number(team.oddzial_id) !== Number(sourceBranch)) {
          return { error: 'Oddzial zrodlowy musi byc oddzialem macierzystym ekipy.', status: 400 };
        }
      }
      if (userId) {
        const user = (s.users || []).find((x) => Number(x.id) === Number(userId));
        if (!user || !isEstimatorRole(user.rola)) return { error: 'Delegowac mozna tylko wyceniajacego.', status: 400 };
        if (Number(user.oddzial_id) !== Number(sourceBranch)) {
          return { error: 'Oddzial zrodlowy musi byc oddzialem macierzystym wyceniajacego.', status: 400 };
        }
      }
      const id = s.nextDelegacjaId++;
      const d = {
        id,
        zasob_typ: zasobTyp,
        ekipa_id: teamId,
        user_id: userId,
        wyceniajacy_id: userId,
        oddzial_z: sourceBranch,
        oddzial_do: targetBranch,
        data_od: b.data_od,
        data_do: b.data_do || null,
        cel: b.cel || '',
        uwagi: b.uwagi || '',
        status: 'Planowana',
        created_at: new Date().toISOString(),
      };
      s.delegacje.push(d);
      return enrichDelegacja(s, d);
    });
    if (row?.error) return res.status(row.status || 400).json({ error: row.error });
    res.status(201).json(row);
  });

  router.put('/oddzialy/delegacje/:id/status', requireAuth, (req, res) => {
    const id = toNum(req.params.id);
    const { status } = req.body || {};
    const row = withStore((s) => {
      const d = (s.delegacje || []).find((x) => x.id === id);
      if (!d) return null;
      if (status) d.status = status;
      return enrichDelegacja(s, d);
    });
    if (!row) return res.status(404).json({ error: 'Nie znaleziono' });
    res.json(row);
  });

  router.put('/oddzialy/pracownik/:userId/przenies', requireAuth, (req, res) => {
    const uid = toNum(req.params.userId);
    const oddzialId = toNum(req.body?.oddzial_id);
    const row = withStore((s) => {
      const u = s.users.find((x) => x.id === uid);
      const o = s.oddzialy.find((x) => x.id === oddzialId);
      if (!u || !o) return null;
      if (!canTransferSpecialist(req.user, u)) return { _forbidden: true };
      u.oddzial_id = oddzialId;
      u.oddzial_nazwa = o.nazwa;
      return stripHaslo(u);
    });
    if (row?._forbidden) return res.status(403).json({ error: 'Brak uprawnien' });
    if (!row) return res.status(400).json({ error: 'Nieprawidłowe dane' });
    res.json(row);
  });

  function buildEkipaDetail(state, team) {
    const odd = state.oddzialy.find((o) => o.id === team.oddzial_id);
    const cz = (state.ekipaCzlonkowie || []).filter((c) => c.ekipa_id === team.id);
    const czlonkowie = cz.map((c) => {
      const u = state.users.find((x) => x.id === c.user_id);
      return {
        id: c.id,
        user_id: c.user_id,
        imie: u?.imie,
        nazwisko: u?.nazwisko,
        rola: c.rola || u?.rola,
        stawka_godzinowa: u?.stawka_godzinowa ?? 0,
      };
    });
    let brygadzista_imie;
    let brygadzista_nazwisko;
    let brygadzista_telefon;
    let brygadzista_id = team.brygadzista_id;
    if (brygadzista_id) {
      const bu = state.users.find((x) => x.id === brygadzista_id);
      if (bu) {
        brygadzista_imie = bu.imie;
        brygadzista_nazwisko = bu.nazwisko;
        brygadzista_telefon = bu.telefon;
      }
    }
    return {
      ...team,
      oddzial_nazwa: odd?.nazwa || null,
      czlonkowie,
      brygadzista_id,
      brygadzista_imie,
      brygadzista_nazwisko,
      brygadzista_telefon,
      procent_wynagrodzenia: team.procent_wynagrodzenia ?? 15,
    };
  }

  router.get('/ekipy/:id', requireAuth, (req, res) => {
    const id = toNum(req.params.id);
    const row = readOnly((s) => {
      const t = s.teams.find((x) => x.id === id);
      if (t && !canAccessOddzial(req.user, t.oddzial_id)) return null;
      return t ? buildEkipaDetail(s, t) : null;
    });
    if (!row) return res.status(404).json({ error: 'Nie znaleziono' });
    res.json(row);
  });

  router.post('/ekipy', requireAuth, (req, res) => {
    const b = req.body || {};
    if (!canManageTeams(req.user)) return res.status(403).json({ error: 'Brak uprawnien' });
    const row = withStore((s) => {
      const id = s.teams.length ? Math.max(...s.teams.map((t) => t.id)) + 1 : 1;
      const oddzialId = canSeeAll(req.user) ? toNum(b.oddzial_id) : toNum(req.user.oddzial_id);
      const t = {
        id,
        nazwa: b.nazwa,
        oddzial_id: oddzialId,
        kolor: b.kolor || '#34D399',
        brygadzista_id: toNum(b.brygadzista_id),
        procent_wynagrodzenia: toNum(b.procent_wynagrodzenia) ?? 15,
      };
      s.teams.push(t);
      return buildEkipaDetail(s, t);
    });
    res.status(201).json(row);
  });

  router.put('/ekipy/:id', requireAuth, (req, res) => {
    const id = toNum(req.params.id);
    const b = req.body || {};
    if (!canManageTeams(req.user)) return res.status(403).json({ error: 'Brak uprawnien' });
    const row = withStore((s) => {
      const t = s.teams.find((x) => x.id === id);
      if (!t) return null;
      if (!canManageOddzial(req.user, t.oddzial_id)) return { _forbidden: true };
      if (b.oddzial_id != null && !canManageOddzial(req.user, toNum(b.oddzial_id))) return { _forbidden: true };
      if (b.nazwa != null) t.nazwa = b.nazwa;
      if (b.oddzial_id != null) t.oddzial_id = toNum(b.oddzial_id);
      if (b.kolor != null) t.kolor = b.kolor;
      if (b.brygadzista_id !== undefined) t.brygadzista_id = toNum(b.brygadzista_id);
      if (b.procent_wynagrodzenia != null) t.procent_wynagrodzenia = Number(b.procent_wynagrodzenia);
      return buildEkipaDetail(s, t);
    });
    if (row?._forbidden) return res.status(403).json({ error: 'Brak uprawnien' });
    if (!row) return res.status(404).json({ error: 'Nie znaleziono' });
    res.json(row);
  });

  router.delete('/ekipy/:id', requireAuth, (req, res) => {
    const id = toNum(req.params.id);
    if (!canManageTeams(req.user)) return res.status(403).json({ error: 'Brak uprawnien' });
    const outcome = withStore((s) => {
      const t = s.teams.find((x) => x.id === id);
      if (t && !canManageOddzial(req.user, t.oddzial_id)) return 'forbidden';
      s.teams = s.teams.filter((t) => t.id !== id);
      s.ekipaCzlonkowie = (s.ekipaCzlonkowie || []).filter((c) => c.ekipa_id !== id);
      return 'ok';
    });
    if (outcome === 'forbidden') return res.status(403).json({ error: 'Brak uprawnien' });
    res.json({ ok: true });
  });

  function addMember(state, ekipaId, userId, rola) {
    const exists = (state.ekipaCzlonkowie || []).some((c) => c.ekipa_id === ekipaId && c.user_id === userId);
    if (exists) return { duplicate: true };
    const id = state.nextEkipaCzlonekId++;
    state.ekipaCzlonkowie.push({ id, ekipa_id: ekipaId, user_id: userId, rola: rola || 'Pomocnik' });
    return { ok: true };
  }

  function postEkipaMember(req, res) {
    const ekipaId = toNum(req.params.id);
    const b = req.body || {};
    if (!canManageTeams(req.user)) return res.status(403).json({ error: 'Brak uprawnien' });
    const nested = b.user || {};
    const uid = toNum(
      b.user_id ?? b.pracownik_id ?? b.uzytkownik_id ?? nested.id ?? b.userId ?? b.pracownikId
    );
    const rola = b.rola || b.rola_w_ekipie || nested.rola || 'Pomocnik';
    const r = withStore((s) => {
      const team = s.teams.find((t) => t.id === ekipaId);
      if (!team || !uid) return null;
      if (!canManageOddzial(req.user, team.oddzial_id)) return { forbidden: true };
      const out = addMember(s, ekipaId, uid, rola);
      return out.duplicate ? { duplicate: true } : { ok: true };
    });
    if (r?.forbidden) return res.status(403).json({ error: 'Brak uprawnien' });
    if (!r) return res.status(400).json({ error: 'Nieprawidłowe dane' });
    if (r.duplicate) return res.status(409).json({ error: 'Już w ekipie' });
    res.status(201).json({ ok: true });
  }

  router.post('/ekipy/:id/czlonkowie', requireAuth, postEkipaMember);
  router.post('/ekipy/:id/pracownicy', requireAuth, postEkipaMember);
  router.put('/ekipy/:id/czlonkowie', requireAuth, postEkipaMember);
  router.put('/ekipy/:id/pracownicy', requireAuth, postEkipaMember);
  router.patch('/ekipy/:id/czlonkowie', requireAuth, postEkipaMember);
  router.patch('/ekipy/:id/pracownicy', requireAuth, postEkipaMember);

  function deleteEkipaMember(req, res) {
    const ekipaId = toNum(req.params.id);
    const workerId = toNum(req.params.workerId);
    if (!canManageTeams(req.user)) return res.status(403).json({ error: 'Brak uprawnien' });
    const outcome = withStore((s) => {
      const team = s.teams.find((t) => t.id === ekipaId);
      if (team && !canManageOddzial(req.user, team.oddzial_id)) return 'forbidden';
      s.ekipaCzlonkowie = (s.ekipaCzlonkowie || []).filter((c) => !(c.ekipa_id === ekipaId && c.user_id === workerId));
      return 'ok';
    });
    if (outcome === 'forbidden') return res.status(403).json({ error: 'Brak uprawnien' });
    res.json({ ok: true });
  }
  router.delete('/ekipy/:id/czlonkowie/:workerId', requireAuth, deleteEkipaMember);
  router.delete('/ekipy/:id/pracownicy/:workerId', requireAuth, deleteEkipaMember);
  router.delete('/ekipy/:id/members/:workerId', requireAuth, deleteEkipaMember);

  router.get('/uzytkownicy/:id', requireAuth, (req, res) => {
    const id = toNum(req.params.id);
    const row = readOnly((s) => {
      if (!canViewUser(s, req.user, id)) return null;
      return stripHaslo(s.users.find((u) => u.id === id));
    });
    if (row?._forbidden) return res.status(403).json({ error: 'Brak dostepu do oddzialu' });
    if (!row) return res.status(404).json({ error: 'Nie znaleziono' });
    res.json(row);
  });

  router.post('/uzytkownicy', requireAuth, (req, res) => {
    const b = req.body || {};
    if (!canCreateUserWithRole(req.user, b.rola || 'Pomocnik')) {
      return res.status(403).json({ error: 'Brak uprawnień' });
    }
    const row = withStore((s) => {
      const id = s.nextUserId++;
      const oid = canSeeAllBranches(req.user) ? toNum(b.oddzial_id) : toNum(req.user.oddzial_id);
      const odd = s.oddzialy.find((o) => o.id === oid);
      const u = {
        id,
        login: b.login || `user${id}`,
        haslo: b.haslo || 'haslo123',
        imie: b.imie || '',
        nazwisko: b.nazwisko || '',
        email: b.email || '',
        telefon: b.telefon || '',
        rola: b.rola || 'Pomocnik',
        oddzial_id: oid,
        oddzial_nazwa: odd?.nazwa || null,
        ekipa_id: toNum(b.ekipa_id),
        aktywny: b.aktywny !== false,
        procent_wynagrodzenia: toNum(b.procent_wynagrodzenia) ?? 15,
        stawka_godzinowa: toNum(b.stawka_godzinowa) ?? 0,
        stanowisko: b.stanowisko || '',
        data_zatrudnienia: b.data_zatrudnienia || null,
        adres_zamieszkania: b.adres_zamieszkania || '',
        kontakt_awaryjny_imie: b.kontakt_awaryjny_imie || '',
        kontakt_awaryjny_telefon: b.kontakt_awaryjny_telefon || '',
        notatki: b.notatki || '',
        wynagrodzenie_stawka_dzienna_pln: 0,
        wynagrodzenie_procent_realizacji: 0,
        wynagrodzenie_dodatki_pln: 0,
        wynagrodzenie_dodatki_opis: '',
      };
      s.users.push(u);
      return stripHaslo(u);
    });
    res.status(201).json(row);
  });

  router.put('/uzytkownicy/:id', requireAuth, (req, res) => {
    const id = toNum(req.params.id);
    const b = req.body || {};
    const row = withStore((s) => {
      const u = s.users.find((x) => x.id === id);
      if (!u) return null;
      if (!canManageTargetUser(req.user, u)) return { _forbidden: true };
      const skip = ['id', 'haslo'];
      for (const k of Object.keys(b)) {
        if (skip.includes(k)) continue;
        if (k === 'oddzial_id') {
          if (!canTransferSpecialist(req.user, u)) return { _forbidden: true };
          u.oddzial_id = toNum(b.oddzial_id);
          u.oddzial_nazwa = oddzialNazwa(s, u.oddzial_id);
        } else {
          u[k] = b[k];
        }
      }
      return stripHaslo(u);
    });
    if (row?._forbidden) return res.status(403).json({ error: 'Brak uprawnien' });
    if (!row) return res.status(404).json({ error: 'Nie znaleziono' });
    res.json(row);
  });

  router.put('/uzytkownicy/:id/haslo', requireAuth, (req, res) => {
    const id = toNum(req.params.id);
    const nh = req.body?.nowe_haslo;
    if (!nh || String(nh).length < 6) return res.status(400).json({ error: 'Hasło min. 6 znaków' });
    const ok = withStore((s) => {
      const u = s.users.find((x) => x.id === id);
      if (!u) return null;
      if (!canManageTargetUser(req.user, u)) return 'forbidden';
      u.haslo = nh;
      return true;
    });
    if (ok === 'forbidden') return res.status(403).json({ error: 'Brak uprawnien' });
    if (!ok) return res.status(404).json({ error: 'Nie znaleziono' });
    res.json({ ok: true });
  });

  router.put('/uzytkownicy/:id/aktywny', requireAuth, (req, res) => {
    const id = toNum(req.params.id);
    const aktywny = req.body?.aktywny;
    const row = withStore((s) => {
      const u = s.users.find((x) => x.id === id);
      if (!u) return null;
      if (!canManageTargetUser(req.user, u)) return { _forbidden: true };
      u.aktywny = aktywny;
      return stripHaslo(u);
    });
    if (row?._forbidden) return res.status(403).json({ error: 'Brak uprawnien' });
    if (!row) return res.status(404).json({ error: 'Nie znaleziono' });
    res.json(row);
  });

  router.put('/uzytkownicy/:id/procent', requireAuth, (req, res) => {
    const id = toNum(req.params.id);
    const p = toNum(req.body?.procent_wynagrodzenia);
    const row = withStore((s) => {
      const u = s.users.find((x) => x.id === id);
      if (!u) return null;
      if (!canManageTargetUser(req.user, u)) return { _forbidden: true };
      u.procent_wynagrodzenia = p ?? 15;
      return stripHaslo(u);
    });
    if (row?._forbidden) return res.status(403).json({ error: 'Brak uprawnien' });
    if (!row) return res.status(404).json({ error: 'Nie znaleziono' });
    res.json(row);
  });

  router.get('/uzytkownicy/:id/kompetencje', requireAuth, (req, res) => {
    const id = toNum(req.params.id);
    const list = readOnly((s) => {
      if (!canViewUser(s, req.user, id)) return null;
      return (s.kompetencje || []).filter((k) => k.user_id === id);
    });
    if (list === null) return res.status(404).json({ error: 'Nie znaleziono' });
    res.json(list);
  });

  router.post('/uzytkownicy/:id/kompetencje', requireAuth, (req, res) => {
    const id = toNum(req.params.id);
    const b = req.body || {};
    const row = withStore((s) => {
      const u = s.users.find((x) => x.id === id);
      if (!u) return null;
      if (!canManageTargetUser(req.user, u)) return { _forbidden: true };
      const kid = s.nextKompetencjaId++;
      const k = {
        id: kid,
        user_id: id,
        nazwa: b.nazwa || '',
        typ: b.typ || 'inne',
        nr_dokumentu: b.nr_dokumentu || '',
        data_uzyskania: b.data_uzyskania || null,
        data_waznosci: b.data_waznosci || null,
        wydawca: b.wydawca || '',
      };
      s.kompetencje.push(k);
      return k;
    });
    if (row?._forbidden) return res.status(403).json({ error: 'Brak uprawnien' });
    res.status(201).json(row);
  });

  router.delete('/uzytkownicy/:userId/kompetencje/:kid', requireAuth, (req, res) => {
    const uid = toNum(req.params.userId);
    const kid = toNum(req.params.kid);
    const ok = withStore((s) => {
      const u = s.users.find((x) => x.id === uid);
      if (!u) return null;
      if (!canManageTargetUser(req.user, u)) return 'forbidden';
      s.kompetencje = (s.kompetencje || []).filter((k) => !(k.user_id === uid && k.id === kid));
      return true;
    });
    if (ok === 'forbidden') return res.status(403).json({ error: 'Brak uprawnien' });
    if (!ok) return res.status(404).json({ error: 'Nie znaleziono' });
    res.json({ ok: true });
  });

  router.get('/role', requireAuth, (req, res) => {
    const list = readOnly((s) => s.roles || []);
    res.json(list);
  });

  router.post('/role', requireAuth, (req, res) => {
    if (!['Prezes', 'Dyrektor'].includes(req.user.rola)) return res.status(403).json({ error: 'Brak uprawnień' });
    const b = req.body || {};
    const row = withStore((s) => {
      const id = s.nextRoleId++;
      const r = {
        id,
        nazwa: b.nazwa || `Rola ${id}`,
        kolor: b.kolor || '#94A3B8',
        opis: b.opis || '',
        poziom: toNum(b.poziom) ?? 1,
        aktywna: b.aktywna !== false,
        uprawnienia: b.uprawnienia || {},
      };
      s.roles.push(r);
      return r;
    });
    res.status(201).json(row);
  });

  router.put('/role/:id', requireAuth, (req, res) => {
    if (!['Prezes', 'Dyrektor'].includes(req.user.rola)) return res.status(403).json({ error: 'Brak uprawnień' });
    const id = toNum(req.params.id);
    const b = req.body || {};
    const row = withStore((s) => {
      const r = s.roles.find((x) => x.id === id);
      if (!r) return null;
      Object.assign(r, b, { id });
      return r;
    });
    if (!row) return res.status(404).json({ error: 'Nie znaleziono' });
    res.json(row);
  });

  router.delete('/role/:id', requireAuth, (req, res) => {
    if (!['Prezes', 'Dyrektor'].includes(req.user.rola)) return res.status(403).json({ error: 'Brak uprawnień' });
    const id = toNum(req.params.id);
    withStore((s) => {
      s.roles = (s.roles || []).filter((r) => r.id !== id);
    });
    res.json({ ok: true });
  });

  router.get('/flota/pojazdy', requireAuth, (req, res) => {
    res.json(readOnly((s) => (s.flotaPojazdy || []).map(normalizeFleetRow)));
  });
  router.get('/flota/sprzet', requireAuth, (req, res) => {
    res.json(readOnly((s) => (s.flotaSprzet || []).map(normalizeFleetRow)));
  });
  router.get('/flota/naprawy', requireAuth, (req, res) => {
    res.json(readOnly((s) => {
      const invoices = s.flotaFakturyNapraw || [];
      return (s.flotaNaprawy || []).map((repair) => {
        const repairInvoices = invoices.filter((x) => Number(x.naprawa_id) === Number(repair.id));
        const faktury_kwota = repairInvoices.reduce((sum, x) => sum + (Number(x.kwota) || 0), 0);
        return {
          ...repair,
          faktury_count: repairInvoices.length,
          faktury_kwota,
        };
      });
    }));
  });

  router.get('/flota/:typ/:id/zdjecia', requireAuth, (req, res) => {
    const typ = String(req.params.typ || '');
    const id = toNum(req.params.id);
    if (!['pojazdy', 'sprzet'].includes(typ) || !id) return res.status(400).json({ error: 'Nieprawidlowy zasob' });
    const rows = readOnly((s) => (s.flotaZdjecia || [])
      .filter((x) => x.typ === typ && Number(x.zasob_id) === id)
      .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()));
    res.json(rows);
  });

  router.post('/flota/:typ/:id/zdjecia', requireAuth, upFleetFile.single('zdjecie'), (req, res) => {
    const typ = String(req.params.typ || '');
    const id = toNum(req.params.id);
    if (!['pojazdy', 'sprzet'].includes(typ) || !id) return res.status(400).json({ error: 'Nieprawidlowy zasob' });
    if (!req.file) return res.status(400).json({ error: 'Brak pliku' });
    const row = withStore((s) => {
      const asset = (typ === 'pojazdy' ? s.flotaPojazdy : s.flotaSprzet || []).find((x) => Number(x.id) === id);
      if (!asset) return null;
      if (!canSeeAll(req.user) && String(asset.oddzial_id || '') !== String(req.user.oddzial_id || '')) return { _forbidden: true };
      if (!s.flotaZdjecia) s.flotaZdjecia = [];
      if (!s.nextFlotaZdjecieId) s.nextFlotaZdjecieId = 1;
      const rel = path.relative(path.join(__dirname, '..', 'uploads'), req.file.path).split(path.sep).join('/');
      const photo = {
        id: s.nextFlotaZdjecieId++,
        typ,
        zasob_id: id,
        url: `/api/uploads/${rel}`,
        nazwa_pliku: req.file.originalname,
        mime: req.file.mimetype || null,
        opis: req.body?.opis ? String(req.body.opis).trim().slice(0, 1000) : null,
        created_by: req.user.id,
        created_by_name: userName(s, req.user.id),
        created_at: new Date().toISOString(),
      };
      s.flotaZdjecia.push(photo);
      return photo;
    });
    if (row?._forbidden) return res.status(403).json({ error: 'Brak dostepu do oddzialu' });
    if (!row) return res.status(404).json({ error: 'Nie znaleziono zasobu' });
    res.status(201).json(row);
  });

  router.delete('/flota/:typ/:id/zdjecia/:photoId', requireAuth, (req, res) => {
    const typ = String(req.params.typ || '');
    const id = toNum(req.params.id);
    const photoId = toNum(req.params.photoId);
    if (!['pojazdy', 'sprzet'].includes(typ) || !id || !photoId) return res.status(400).json({ error: 'Nieprawidlowy zasob' });
    const deleted = withStore((s) => {
      const asset = (typ === 'pojazdy' ? (s.flotaPojazdy || []) : (s.flotaSprzet || [])).find((x) => Number(x.id) === id);
      if (!asset) return null;
      if (!canSeeAll(req.user) && String(asset.oddzial_id || '') !== String(req.user.oddzial_id || '')) return { _forbidden: true };
      const rows = s.flotaZdjecia || [];
      const idx = rows.findIndex((x) => x.typ === typ && Number(x.zasob_id) === id && Number(x.id) === photoId);
      if (idx === -1) return null;
      const [photo] = rows.splice(idx, 1);
      return photo;
    });
    if (deleted?._forbidden) return res.status(403).json({ error: 'Brak dostepu do oddzialu' });
    if (!deleted) return res.status(404).json({ error: 'Nie znaleziono zdjecia' });
    if (deleted.url) {
      const rel = String(deleted.url).replace(/^\/api\/uploads\/?/, '');
      const root = path.resolve(path.join(__dirname, '..', 'uploads'));
      const abs = path.resolve(path.join(root, rel));
      if (abs.startsWith(root)) safeUnlink(abs);
    }
    res.json({ ok: true });
  });

  router.get('/flota/naprawy/:id/faktury', requireAuth, (req, res) => {
    const id = toNum(req.params.id);
    if (!id) return res.status(400).json({ error: 'Nieprawidlowe id' });
    const rows = readOnly((s) => (s.flotaFakturyNapraw || [])
      .filter((x) => Number(x.naprawa_id) === id)
      .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()));
    res.json(rows);
  });

  router.post('/flota/naprawy/:naprawaId/faktury', requireAuth, upFleetFile.single('faktura'), (req, res) => {
    const naprawaId = toNum(req.params.naprawaId);
    if (!naprawaId) return res.status(400).json({ error: 'Nieprawidlowe id' });
    if (!req.file) return res.status(400).json({ error: 'Brak pliku faktury' });
    const row = withStore((s) => {
      const repair = (s.flotaNaprawy || []).find((x) => Number(x.id) === naprawaId);
      if (!repair) return null;
      if (!canSeeAll(req.user) && String(repair.oddzial_id || '') !== String(req.user.oddzial_id || '')) return { _forbidden: true };
      if (!s.flotaFakturyNapraw) s.flotaFakturyNapraw = [];
      if (!s.nextFlotaFakturaNaprawId) s.nextFlotaFakturaNaprawId = 1;
      const kwota = toNum(req.body?.kwota);
      const rel = path.relative(path.join(__dirname, '..', 'uploads'), req.file.path).split(path.sep).join('/');
      const invoice = {
        id: s.nextFlotaFakturaNaprawId++,
        naprawa_id: naprawaId,
        url: `/api/uploads/${rel}`,
        nazwa_pliku: req.file.originalname,
        numer: req.body?.numer ? String(req.body.numer).trim().slice(0, 120) : null,
        kwota,
        opis: req.body?.opis ? String(req.body.opis).trim().slice(0, 1000) : null,
        created_by: req.user.id,
        created_by_name: userName(s, req.user.id),
        created_at: new Date().toISOString(),
      };
      s.flotaFakturyNapraw.push(invoice);
      if (kwota != null) {
        const currentCost = Number(repair.koszt || 0) || 0;
        repair.koszt = Math.max(currentCost, kwota);
      }
      return invoice;
    });
    if (row?._forbidden) return res.status(403).json({ error: 'Brak dostepu do oddzialu' });
    if (!row) return res.status(404).json({ error: 'Nie znaleziono naprawy' });
    res.status(201).json(row);
  });

  router.delete('/flota/naprawy/:naprawaId/faktury/:invoiceId', requireAuth, (req, res) => {
    const naprawaId = toNum(req.params.naprawaId);
    const invoiceId = toNum(req.params.invoiceId);
    if (!naprawaId || !invoiceId) return res.status(400).json({ error: 'Nieprawidlowe id' });
    const deleted = withStore((s) => {
      const repair = (s.flotaNaprawy || []).find((x) => Number(x.id) === naprawaId);
      if (!repair) return null;
      if (!canSeeAll(req.user) && String(repair.oddzial_id || '') !== String(req.user.oddzial_id || '')) return { _forbidden: true };
      const rows = s.flotaFakturyNapraw || [];
      const idx = rows.findIndex((x) => Number(x.naprawa_id) === naprawaId && Number(x.id) === invoiceId);
      if (idx === -1) return null;
      const [invoice] = rows.splice(idx, 1);
      const remaining = rows.filter((x) => Number(x.naprawa_id) === naprawaId);
      const maxInvoice = remaining.reduce((max, x) => Math.max(max, Number(x.kwota || 0) || 0), 0);
      if (Number(repair.koszt || 0) === Number(invoice.kwota || 0)) repair.koszt = maxInvoice || null;
      return invoice;
    });
    if (deleted?._forbidden) return res.status(403).json({ error: 'Brak dostepu do oddzialu' });
    if (!deleted) return res.status(404).json({ error: 'Nie znaleziono faktury' });
    if (deleted.url) {
      const rel = String(deleted.url).replace(/^\/api\/uploads\/?/, '');
      const root = path.resolve(path.join(__dirname, '..', 'uploads'));
      const abs = path.resolve(path.join(root, rel));
      if (abs.startsWith(root)) safeUnlink(abs);
    }
    res.json({ ok: true });
  });

  router.post('/flota/pojazdy', requireAuth, (req, res) => {
    const b = req.body || {};
    const row = withStore((s) => {
      const id = s.nextFlotaPojazdId++;
      const p = {
        id,
        ...b,
        status: b.status || 'Dostępny',
        oddzial_id: toNum(b.oddzial_id),
        ekipa_id: toNum(b.ekipa_id),
      };
      p.status = normalizeFleetText(p.status || 'Dostepny');
      s.flotaPojazdy.push(p);
      return p;
    });
    res.status(201).json(row);
  });

  router.put('/flota/pojazdy/:id', requireAuth, (req, res) => {
    const id = toNum(req.params.id);
    const b = req.body || {};
    const row = withStore((s) => {
      const p = (s.flotaPojazdy || []).find((x) => x.id === id);
      if (!p) return null;
      if (!canSeeAll(req.user) && String(p.oddzial_id || '') !== String(req.user.oddzial_id || '')) return { _forbidden: true };
      Object.assign(p, b, {
        id,
        status: normalizeFleetText(b.status || p.status || 'Dostepny'),
        oddzial_id: toNum(b.oddzial_id) ?? p.oddzial_id ?? req.user.oddzial_id,
        ekipa_id: toNum(b.ekipa_id),
      });
      return normalizeFleetRow(p);
    });
    if (row?._forbidden) return res.status(403).json({ error: 'Brak dostepu do oddzialu' });
    if (!row) return res.status(404).json({ error: 'Nie znaleziono' });
    res.json(row);
  });

  router.post('/flota/sprzet', requireAuth, (req, res) => {
    const b = req.body || {};
    const row = withStore((s) => {
      const id = s.nextFlotaSprzetId++;
      const p = { id, ...b, status: b.status || 'Dostępny', oddzial_id: toNum(b.oddzial_id), ekipa_id: toNum(b.ekipa_id) };
      p.status = normalizeFleetText(p.status || 'Dostepny');
      s.flotaSprzet.push(p);
      return p;
    });
    res.status(201).json(row);
  });

  router.put('/flota/sprzet/:id', requireAuth, (req, res) => {
    const id = toNum(req.params.id);
    const b = req.body || {};
    const row = withStore((s) => {
      const p = (s.flotaSprzet || []).find((x) => x.id === id);
      if (!p) return null;
      if (!canSeeAll(req.user) && String(p.oddzial_id || '') !== String(req.user.oddzial_id || '')) return { _forbidden: true };
      Object.assign(p, b, {
        id,
        status: normalizeFleetText(b.status || p.status || 'Dostepny'),
        oddzial_id: toNum(b.oddzial_id) ?? p.oddzial_id ?? req.user.oddzial_id,
        ekipa_id: toNum(b.ekipa_id),
      });
      return normalizeFleetRow(p);
    });
    if (row?._forbidden) return res.status(403).json({ error: 'Brak dostepu do oddzialu' });
    if (!row) return res.status(404).json({ error: 'Nie znaleziono' });
    res.json(row);
  });

  router.delete('/flota/:typ/:id', requireAuth, (req, res) => {
    const typ = String(req.params.typ || '');
    const id = toNum(req.params.id);
    if (!['pojazdy', 'sprzet'].includes(typ) || !id) return res.status(400).json({ error: 'Nieprawidlowy zasob' });
    const deleted = withStore((s) => {
      const key = typ === 'pojazdy' ? 'flotaPojazdy' : 'flotaSprzet';
      const arr = s[key] || [];
      const item = arr.find((x) => Number(x.id) === id);
      if (!item) return null;
      if (!canSeeAll(req.user) && String(item.oddzial_id || '') !== String(req.user.oddzial_id || '')) return { _forbidden: true };
      s[key] = arr.filter((x) => Number(x.id) !== id);
      s.flotaZdjecia = (s.flotaZdjecia || []).filter((x) => !(x.typ === typ && Number(x.zasob_id) === id));
      return item;
    });
    if (deleted?._forbidden) return res.status(403).json({ error: 'Brak dostepu do oddzialu' });
    if (!deleted) return res.status(404).json({ error: 'Nie znaleziono' });
    res.json({ ok: true });
  });

  const REZ_STATUSES = ['Zarezerwowane', 'Wydane', 'Zwrócone', 'Anulowane'];
  router.post('/flota/naprawy', requireAuth, (req, res) => {
    const b = req.body || {};
    const typZasobu = String(b.typ_zasobu || '').toLowerCase().includes('pojazd') ? 'Pojazd' : 'Sprzet';
    const zasobId = toNum(b.zasob_id);
    if (!zasobId || !String(b.opis_usterki || '').trim()) return res.status(400).json({ error: 'Zasob i opis usterki sa wymagane' });
    const row = withStore((s) => {
      const assetArr = typZasobu === 'Pojazd' ? (s.flotaPojazdy || []) : (s.flotaSprzet || []);
      const asset = assetArr.find((x) => Number(x.id) === zasobId);
      if (!asset) return null;
      if (!canSeeAll(req.user) && String(asset.oddzial_id || '') !== String(req.user.oddzial_id || '')) return { _forbidden: true };
      if (!s.flotaNaprawy) s.flotaNaprawy = [];
      if (!s.nextFlotaNaprawaId) s.nextFlotaNaprawaId = 1;
      const repair = {
        id: s.nextFlotaNaprawaId++,
        typ_zasobu: typZasobu,
        zasob_id: zasobId,
        data_naprawy: b.data_naprawy || new Date().toISOString().slice(0, 10),
        opis_usterki: String(b.opis_usterki || '').trim().slice(0, 4000),
        opis_naprawy: b.opis_naprawy ? String(b.opis_naprawy).trim().slice(0, 4000) : null,
        wykonawca: b.wykonawca ? String(b.wykonawca).trim().slice(0, 500) : null,
        koszt: toNum(b.koszt),
        status: b.status || 'W toku',
        oddzial_id: toNum(b.oddzial_id) ?? asset.oddzial_id ?? req.user.oddzial_id,
        created_by: req.user.id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      s.flotaNaprawy.push(repair);
      if (!String(repair.status || '').toLowerCase().includes('zakoncz')) asset.status = 'W naprawie';
      return repair;
    });
    if (row?._forbidden) return res.status(403).json({ error: 'Brak dostepu do oddzialu' });
    if (!row) return res.status(404).json({ error: 'Nie znaleziono zasobu' });
    res.status(201).json(row);
  });

  router.put('/flota/naprawy/:id', requireAuth, (req, res) => {
    const id = toNum(req.params.id);
    const b = req.body || {};
    const row = withStore((s) => {
      const repair = (s.flotaNaprawy || []).find((x) => Number(x.id) === id);
      if (!repair) return null;
      if (!canSeeAll(req.user) && String(repair.oddzial_id || '') !== String(req.user.oddzial_id || '')) return { _forbidden: true };
      const typZasobu = b.typ_zasobu ? (String(b.typ_zasobu).toLowerCase().includes('pojazd') ? 'Pojazd' : 'Sprzet') : repair.typ_zasobu;
      const zasobId = toNum(b.zasob_id) ?? repair.zasob_id;
      Object.assign(repair, {
        ...b,
        id,
        typ_zasobu: typZasobu,
        zasob_id: zasobId,
        koszt: toNum(b.koszt) ?? repair.koszt ?? null,
        oddzial_id: toNum(b.oddzial_id) ?? repair.oddzial_id ?? req.user.oddzial_id,
        updated_at: new Date().toISOString(),
      });
      const assetArr = typZasobu === 'Pojazd' ? (s.flotaPojazdy || []) : (s.flotaSprzet || []);
      const asset = assetArr.find((x) => Number(x.id) === Number(zasobId));
      if (asset) asset.status = String(repair.status || '').toLowerCase().includes('zakoncz') ? 'Dostepny' : 'W naprawie';
      return repair;
    });
    if (row?._forbidden) return res.status(403).json({ error: 'Brak dostepu do oddzialu' });
    if (!row) return res.status(404).json({ error: 'Nie znaleziono' });
    res.json(row);
  });

  router.delete('/flota/naprawy/:id', requireAuth, (req, res) => {
    const id = toNum(req.params.id);
    const deleted = withStore((s) => {
      const rows = s.flotaNaprawy || [];
      const idx = rows.findIndex((x) => Number(x.id) === id);
      if (idx === -1) return null;
      const repair = rows[idx];
      if (!canSeeAll(req.user) && String(repair.oddzial_id || '') !== String(req.user.oddzial_id || '')) return { _forbidden: true };
      rows.splice(idx, 1);
      const invoices = s.flotaFakturyNapraw || [];
      s.flotaFakturyNapraw = invoices.filter((x) => Number(x.naprawa_id) !== id);
      const assetArr = repair.typ_zasobu === 'Pojazd' ? (s.flotaPojazdy || []) : (s.flotaSprzet || []);
      const asset = assetArr.find((x) => Number(x.id) === Number(repair.zasob_id));
      const hasOtherOpen = rows.some((x) =>
        String(x.typ_zasobu) === String(repair.typ_zasobu) &&
        Number(x.zasob_id) === Number(repair.zasob_id) &&
        !String(x.status || '').toLowerCase().includes('zakoncz')
      );
      if (asset && !hasOtherOpen) asset.status = 'Dostepny';
      return { repair, invoices };
    });
    if (deleted?._forbidden) return res.status(403).json({ error: 'Brak dostepu do oddzialu' });
    if (!deleted) return res.status(404).json({ error: 'Nie znaleziono' });
    for (const invoice of deleted.invoices || []) {
      if (!invoice.url) continue;
      const rel = String(invoice.url).replace(/^\/api\/uploads\/?/, '');
      const root = path.resolve(path.join(__dirname, '..', 'uploads'));
      const abs = path.resolve(path.join(root, rel));
      if (abs.startsWith(root)) safeUnlink(abs);
    }
    res.json({ ok: true });
  });

  const dateYmd = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

  /** Musi być przed `/flota/:typ/:id/status`, żeby nie połapać `typ=rezerwacje`. */
  router.get('/flota/rezerwacje', requireAuth, (req, res) => {
    const { from, to } = req.query || {};
    if (!dateYmd(from) || !dateYmd(to)) {
      return res.status(400).json({ error: 'Nieprawidłowy zakres dat', code: 'VALIDATION_FAILED' });
    }
    const rows = readOnly((s) => {
      const sprzetById = Object.fromEntries((s.flotaSprzet || []).map((x) => [x.id, x]));
      const teamById = Object.fromEntries((s.teams || []).map((x) => [x.id, x]));
      let list = (s.equipmentReservations || []).filter((r) => r.data_do >= from && r.data_od <= to);
      if (!canSeeAll(req.user)) {
        list = list.filter((r) => {
          const eq = sprzetById[r.sprzet_id];
          return eq && String(eq.oddzial_id) === String(req.user.oddzial_id);
        });
      }
      return list.map((r) => ({
        id: r.id,
        sprzet_id: r.sprzet_id,
        ekipa_id: r.ekipa_id,
        data_od: r.data_od,
        data_do: r.data_do,
        caly_dzien: !!r.caly_dzien,
        status: r.status,
        sprzet_nazwa: sprzetById[r.sprzet_id]?.nazwa ?? null,
        ekipa_nazwa: teamById[r.ekipa_id]?.nazwa ?? null,
      }));
    });
    res.json(rows);
  });

  router.post('/flota/rezerwacje', requireAuth, (req, res) => {
    const b = req.body || {};
    const sprzet_id = toNum(b.sprzet_id);
    const ekipa_id = toNum(b.ekipa_id);
    const { data_od, data_do } = b;
    if (!sprzet_id || !ekipa_id || !dateYmd(data_od) || !dateYmd(data_do)) {
      return res.status(400).json({ error: 'Nieprawidłowe dane', code: 'VALIDATION_FAILED' });
    }
    if (data_do < data_od) return res.status(400).json({ error: 'data_do_przed_data_od' });
    const caly_dzien = b.caly_dzien !== false;
    const status = REZ_STATUSES.includes(b.status) ? b.status : 'Zarezerwowane';

    const row = withStore((s) => {
      const spr = (s.flotaSprzet || []).find((x) => x.id === sprzet_id);
      if (!spr) return { err: 'sprzet_nieznaleziony', code: 404 };
      const team = (s.teams || []).find((x) => x.id === ekipa_id);
      if (!team) return { err: 'ekipa_nieznaleziona', code: 404 };
      const sprOdd = spr.oddzial_id;
      const teamOdd = team.oddzial_id;
      if (sprOdd != null && teamOdd != null && sprOdd !== teamOdd) {
        return { err: 'sprzet_ekipa_oddzial', code: 400 };
      }
      if (!canSeeAll(req.user)) {
        if (String(req.user.oddzial_id) !== String(sprOdd) || String(req.user.oddzial_id) !== String(teamOdd)) {
          return { err: 'brak_dostepu_oddzial', code: 403 };
        }
      }
      const oddzialId = sprOdd ?? teamOdd ?? req.user.oddzial_id;
      const active = (s.equipmentReservations || []).some(
        (r) =>
          r.sprzet_id === sprzet_id &&
          !['Anulowane', 'Zwrócone'].includes(r.status) &&
          !(r.data_do < data_od || r.data_od > data_do)
      );
      if (active) return { err: 'rezerwacja_kolizja_sprzet', code: 409 };
      const id = s.nextEquipmentReservationId++;
      const rec = {
        id,
        oddzial_id: oddzialId,
        sprzet_id,
        ekipa_id,
        data_od,
        data_do,
        caly_dzien,
        status,
        user_id: req.user.id,
      };
      s.equipmentReservations.push(rec);
      return { id };
    });
    if (row.err) return res.status(row.code || 400).json({ error: row.err });
    res.json({ id: row.id });
  });

  router.put('/flota/rezerwacje/:id/status', requireAuth, (req, res) => {
    const id = toNum(req.params.id);
    const status = (req.body || {}).status;
    if (!id || !REZ_STATUSES.includes(status)) {
      return res.status(400).json({ error: 'Nieprawidłowe dane', code: 'VALIDATION_FAILED' });
    }
    const ok = withStore((s) => {
      const sprzetById = Object.fromEntries((s.flotaSprzet || []).map((x) => [x.id, x]));
      const r = (s.equipmentReservations || []).find((x) => x.id === id);
      if (!r) return false;
      if (!canSeeAll(req.user)) {
        const eq = sprzetById[r.sprzet_id];
        if (!eq || String(eq.oddzial_id) !== String(req.user.oddzial_id)) return false;
      }
      r.status = status;
      return true;
    });
    if (!ok) return res.status(404).json({ error: 'nie_znaleziono' });
    res.json({ message: 'ok' });
  });

  router.put('/flota/:typ/:id/status', requireAuth, (req, res) => {
    const typ = req.params.typ;
    const id = toNum(req.params.id);
    const { status } = req.body || {};
    const row = withStore((s) => {
      let arr;
      if (typ === 'pojazdy') arr = s.flotaPojazdy;
      else if (typ === 'sprzet') arr = s.flotaSprzet;
      else if (typ === 'naprawy') arr = s.flotaNaprawy;
      else return null;
      const x = arr.find((o) => o.id === id);
      if (!x) return null;
      if (status) x.status = status;
      return x;
    });
    if (!row) return res.status(404).json({ error: 'Nie znaleziono' });
    res.json(row);
  });

  const fmtDailyMin = (m) => {
    const n = Number(m) || 0;
    const h = Math.floor(n / 60);
    const mm = n % 60;
    return `${h}h ${mm}min`;
  };

  const isIsoDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
  const taskDay = (z) => String(z.data_planowana || z.data_wykonania || '').slice(0, 10);

  function ensureTeamDayCollections(state) {
    if (!state.teamDayReports) state.teamDayReports = [];
    if (!state.teamDayReportLines) state.teamDayReportLines = [];
    if (!state.nextTeamDayReportId) state.nextTeamDayReportId = 1;
    if (!state.nextTeamDayReportLineId) state.nextTeamDayReportLineId = 1;
  }

  function buildTeamDayPreview(state, ekipaId, date) {
    const tasks = zleceniaRows(state).filter((z) => String(z.ekipa_id) === String(ekipaId) && taskDay(z) === date);
    const cashByForma = new Map();
    let issuesCount = 0;
    for (const task of tasks) {
      const taskProblems = (state.taskProblemy && state.taskProblemy[String(task.id)]) || [];
      issuesCount += Array.isArray(taskProblems) ? taskProblems.length : 0;
      const cashValue = Number(task.kwota_odebrana ?? task.kwota_gotowka ?? task.gotowka ?? 0) || 0;
      if (cashValue > 0) {
        const forma = String(task.forma_platnosc || task.forma_platnosci || 'gotowka');
        cashByForma.set(forma, (cashByForma.get(forma) || 0) + cashValue);
      }
    }
    return {
      tasks_day: tasks.map((t) => ({ id: t.id, status: t.status, klient_nazwa: t.klient_nazwa || null })),
      cash_by_forma: Array.from(cashByForma, ([forma_platnosc, sum_kwota]) => ({ forma_platnosc, sum_kwota })),
      issues_count: issuesCount,
    };
  }

  function buildTeamDayLines(state, reportId, ekipaId, date) {
    const memberRows = (state.ekipaCzlonkowie || []).filter((m) => String(m.ekipa_id) === String(ekipaId));
    const userIds = memberRows.length ? memberRows.map((m) => m.user_id) : [];
    return userIds.map((userId) => {
      const user = state.users.find((u) => u.id === userId) || {};
      const report = (state.dailyReports || []).find((r) => r.user_id === userId && r.data_raportu === date);
      const minutes = Number(report?.czas_pracy_minuty) || 0;
      const hours = Math.round((minutes / 60) * 100) / 100;
      const rate = Number(user.stawka_godzinowa) || 0;
      return {
        id: state.nextTeamDayReportLineId++,
        report_id: reportId,
        user_id: userId,
        hours_total: hours,
        pay_pln: Math.round(hours * rate * 100) / 100,
        detail_json: {
          source: 'web-local',
          user_name: `${user.imie || ''} ${user.nazwisko || ''}`.trim(),
          daily_report_id: report?.id || null,
        },
      };
    });
  }

  router.get('/raporty/mobile', requireAuth, (req, res) => {
    const stats = readOnly((s) => {
      const all = (s.zlecenia || []).filter((z) => z.typ === 'zlecenie' || z.typ == null);
      const scoped = canSeeAll(req.user) ? all : all.filter((z) => String(z.oddzial_id) === String(req.user.oddzial_id));
      const total_tasks = scoped.length;
      const completed_tasks = scoped.filter((z) => isTaskDone(z.status)).length;
      let total_revenue = 0;
      for (const z of scoped) {
        total_revenue += Number(z.wartosc_rzeczywista ?? z.wartosc_planowana ?? 0) || 0;
      }
      const revenue = Math.round(total_revenue * 100) / 100;
      const cost = 0;
      const avg_margin_percent = revenue > 0 ? ((revenue - cost) / revenue) * 100 : 0;
      return {
        total_tasks,
        completed_tasks,
        total_hours: 0,
        total_revenue: revenue,
        total_cost: cost,
        avg_margin_percent,
      };
    });
    res.json(stats);
  });

  router.get('/mobile/me/team-day-report', requireAuth, (req, res) => {
    const date = String(req.query.date || '').slice(0, 10);
    if (!isIsoDay(date)) return res.status(400).json({ error: 'Uzyj date=YYYY-MM-DD', code: 'VALIDATION_FAILED' });
    const payload = readOnly((s) => {
      ensureTeamDayCollections(s);
      const ekipaId = req.user.ekipa_id;
      if (!ekipaId) return { report: null, lines: [], day_preview: null };
      const report = s.teamDayReports.find((r) => String(r.team_id) === String(ekipaId) && r.report_date === date) || null;
      const lines = report ? s.teamDayReportLines.filter((l) => l.report_id === report.id) : [];
      return {
        report,
        lines,
        day_preview: ['Brygadzista', 'Pomocnik'].includes(req.user.rola) ? buildTeamDayPreview(s, ekipaId, date) : null,
      };
    });
    res.json(payload);
  });

  router.post('/mobile/me/team-day-close', requireAuth, (req, res) => {
    if (!['Brygadzista', 'Pomocnik'].includes(req.user.rola)) {
      return res.status(403).json({ error: 'Tylko ekipa w terenie' });
    }
    const date = String(req.body?.report_date || '').slice(0, 10);
    if (!isIsoDay(date)) return res.status(400).json({ error: 'Uzyj report_date=YYYY-MM-DD', code: 'VALIDATION_FAILED' });
    if (!req.user.ekipa_id) return res.status(400).json({ error: 'Brak przypisanej ekipy' });

    const payload = withStore((s) => {
      ensureTeamDayCollections(s);
      let report = s.teamDayReports.find(
        (r) => String(r.team_id) === String(req.user.ekipa_id) && r.report_date === date
      );
      if (report?.status === 'Approved') return { err: 'Raport dnia jest zatwierdzony', code: 409 };
      const now = new Date().toISOString();
      if (!report) {
        report = {
          id: s.nextTeamDayReportId++,
          team_id: req.user.ekipa_id,
          report_date: date,
          status: 'Draft',
          created_by: req.user.id,
          created_at: now,
          updated_at: now,
        };
        s.teamDayReports.push(report);
      } else {
        report.updated_at = now;
      }
      const lines = buildTeamDayLines(s, report.id, req.user.ekipa_id, date);
      s.teamDayReportLines = s.teamDayReportLines.filter((l) => l.report_id !== report.id).concat(lines);
      return { report, lines, day_preview: buildTeamDayPreview(s, req.user.ekipa_id, date) };
    });
    if (payload.err) return res.status(payload.code || 400).json({ error: payload.err });
    res.json(payload);
  });

  router.get('/payroll/month-close-status', requireAuth, (req, res) => {
    const month = String(req.query.month || new Date().toISOString().slice(0, 7)).slice(0, 7);
    const pending_count = readOnly((s) =>
      (s.dailyReports || []).filter((r) => String(r.data_raportu || '').slice(0, 7) === month && r.status !== 'Wyslany').length
    );
    res.json({
      month,
      export_allowed: pending_count === 0,
      pending_count,
      source: 'web-local',
    });
  });

  router.get('/raporty-dzienne', requireAuth, (req, res) => {
    const data = req.query.data;
    if (!data) return res.status(400).json({ error: 'Brak daty', code: 'VALIDATION_FAILED' });
    const rows = readOnly((s) => {
      let list = (s.dailyReports || []).filter((r) => r.data_raportu === data);
      if (!canSeeAll(req.user)) {
        if (req.user.rola === 'Kierownik') list = list.filter((r) => String(r.oddzial_id) === String(req.user.oddzial_id));
        else list = list.filter((r) => r.user_id === req.user.id);
      }
      return list.map((r) => ({ id: r.id, status: r.status, data_raportu: r.data_raportu, user_id: r.user_id }));
    });
    res.json(rows);
  });

  router.get('/raporty-dzienne/:id(\\d+)', requireAuth, (req, res) => {
    const id = toNum(req.params.id);
    const row = readOnly((s) => {
      const r = (s.dailyReports || []).find((x) => x.id === id);
      if (!r) return null;
      if (!canSeeAll(req.user)) {
        if (req.user.rola === 'Kierownik') {
          if (String(r.oddzial_id) !== String(req.user.oddzial_id)) return null;
        } else if (r.user_id !== req.user.id) return null;
      }
      const zadania = (r.zadania || []).map((z) => ({
        task_id: z.task_id,
        czas_minuty: z.czas_minuty,
        uwagi: z.uwagi,
        klient_nazwa: (s.zlecenia || []).find((t) => t.id === z.task_id)?.klient_nazwa,
        adres: (s.zlecenia || []).find((t) => t.id === z.task_id)?.adres,
      }));
      return {
        ...r,
        czas_pracy_human: fmtDailyMin(r.czas_pracy_minuty),
        zadania,
        materialy: r.materialy || [],
      };
    });
    if (!row) return res.status(404).json({ error: 'Nie znaleziono' });
    res.json(row);
  });

  router.post('/raporty-dzienne', requireAuth, (req, res) => {
    const b = req.body || {};
    const data_raportu = b.data_raportu;
    if (!data_raportu) return res.status(400).json({ error: 'Data wymagana', code: 'VALIDATION_FAILED' });
    const out = withStore((s) => {
      s.dailyReports = s.dailyReports || [];
      let ex = s.dailyReports.find((r) => r.user_id === req.user.id && r.data_raportu === data_raportu);
      if (ex && ex.status === 'Wyslany') return { err: 'cannot_edit_sent', code: 400 };
      if (!ex) {
        const nid = s.nextDailyReportId++;
        ex = {
          id: nid,
          user_id: req.user.id,
          oddzial_id: req.user.oddzial_id,
          data_raportu,
          status: 'Roboczy',
          czas_pracy_minuty: 0,
          zadania: [],
          materialy: [],
          podpis_url: null,
          opis_pracy: null,
        };
        s.dailyReports.push(ex);
      }
      ex.opis_pracy = b.opis_pracy ?? null;
      ex.podpis_url = b.podpis_url ?? null;
      ex.status = 'Roboczy';
      ex.zadania = (b.zadania || []).map((z) => ({
        task_id: z.task_id,
        czas_minuty: Number(z.czas_minuty) || 0,
        uwagi: z.uwagi || null,
      }));
      ex.materialy = (b.materialy || []).map((m) => ({
        nazwa: m.nazwa,
        ilosc: Number(m.ilosc) || 1,
        jednostka: m.jednostka || 'szt',
        koszt_jednostkowy: Number(m.koszt_jednostkowy) || 0,
      }));
      ex.czas_pracy_minuty = ex.zadania.reduce((sum, z) => sum + (Number(z.czas_minuty) || 0), 0);
      return { id: ex.id };
    });
    if (out.err) return res.status(out.code || 400).json({ error: out.err });
    res.json({ success: true, id: out.id, message: 'Raport zapisany' });
  });

  router.post('/raporty-dzienne/:id(\\d+)/wyslij', requireAuth, (req, res) => {
    const id = toNum(req.params.id);
    const ok = withStore((s) => {
      const r = (s.dailyReports || []).find((x) => x.id === id);
      if (!r) return false;
      if (r.user_id !== req.user.id && !canSeeAll(req.user)) return false;
      r.status = 'Wyslany';
      return true;
    });
    if (!ok) return res.status(404).json({ error: 'Nie znaleziono' });
    res.json({ success: true, message: 'Wyslano (demo — bez e-maila)' });
  });

  router.get('/ksiegowosc/faktury', requireAuth, (req, res) => {
    res.json(readOnly((s) => s.faktury || []));
  });

  router.get('/ksiegowosc/faktury/stats', requireAuth, (_req, res) => {
    const stats = readOnly((s) => {
      const f = s.faktury || [];
      const today = new Date().toISOString().slice(0, 10);
      let przychod_total = 0;
      let oplacone = 0;
      let nieoplacone = 0;
      let przeterminowane = 0;
      for (const x of f) {
        const b = parseFloat(x.brutto) || 0;
        przychod_total += b;
        if (x.status === 'Oplacona') oplacone += b;
        if (x.status === 'Nieoplacona') {
          nieoplacone += b;
          if (x.termin_platnosci && x.termin_platnosci < today) przeterminowane += b;
        }
      }
      return { total: f.length, przychod_total, oplacone, nieoplacone, przeterminowane };
    });
    res.json(stats);
  });

  router.get('/ksiegowosc/ustawienia', requireAuth, (_req, res) => {
    res.json(readOnly((s) => s.ksiegowoscUstawienia || {}));
  });

  router.put('/ksiegowosc/ustawienia', requireAuth, (req, res) => {
    const b = req.body || {};
    withStore((s) => {
      s.ksiegowoscUstawienia = { ...(s.ksiegowoscUstawienia || {}), ...b };
    });
    res.json(readOnly((s) => s.ksiegowoscUstawienia));
  });

  router.put('/ksiegowosc/faktury/:id/status', requireAuth, (req, res) => {
    const id = toNum(req.params.id);
    const { status } = req.body || {};
    const row = withStore((s) => {
      const f = (s.faktury || []).find((x) => x.id === id);
      if (!f) return null;
      if (status) f.status = status;
      return f;
    });
    if (!row) return res.status(404).json({ error: 'Nie znaleziono' });
    res.json(row);
  });

  router.post('/ksiegowosc/faktury', requireAuth, (req, res) => {
    const b = req.body || {};
    const row = withStore((s) => {
      const id = s.nextFakturaId++;
      const rok = new Date().getFullYear();
      const numer = `FV/${rok}/${String(s.nextFakturaNumer++).padStart(3, '0')}`;
      let netto = 0;
      let vat = 0;
      const pozycje = Array.isArray(b.pozycje) ? b.pozycje : [];
      for (const p of pozycje) {
        const line = (parseFloat(p.ilosc) || 0) * (parseFloat(p.cena_netto) || 0);
        netto += line;
        vat += line * ((parseFloat(p.vat_stawka) || 0) / 100);
      }
      const brutto = netto + vat;
      const z = s.zlecenia.find((x) => x.id === toNum(b.task_id));
      const f = {
        id,
        numer,
        status: 'Nieoplacona',
        oddzial_id: z?.oddzial_id ?? toNum(b.oddzial_id),
        data_wystawienia: b.data_wystawienia || new Date().toISOString().slice(0, 10),
        data_sprzedazy: b.data_sprzedazy || b.data_wystawienia,
        termin_platnosci: b.termin_platnosci || null,
        forma_platnosci: b.forma_platnosci || 'przelew',
        klient_nazwa: b.klient_nazwa || '',
        klient_nip: b.klient_nip || '',
        klient_email: b.klient_email || '',
        task_id: toNum(b.task_id),
        uwagi: b.uwagi || '',
        pozycje,
        netto: Math.round(netto * 100) / 100,
        vat: Math.round(vat * 100) / 100,
        brutto: Math.round(brutto * 100) / 100,
        created_at: new Date().toISOString(),
      };
      s.faktury.push(f);
      return f;
    });
    res.status(201).json(row);
  });
};
