const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { readOnly, withStore } = require('../lib/store');
const { requireAuth } = require('../lib/auth');

const UP_ZDJ = path.join(__dirname, '..', 'uploads', 'zlecenia');
const UP_DOK = path.join(__dirname, '..', 'uploads', 'zlecenia');

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
  return user.rola === 'Administrator' || user.rola === 'Dyrektor';
}

function canManageIntegrations(user) {
  return ['Administrator', 'Dyrektor', 'Kierownik'].includes(user?.rola);
}

function canRetryChannel(user, channel) {
  if (!user?.rola) return false;
  if (['Administrator', 'Dyrektor'].includes(user.rola)) return true;
  if (user.rola === 'Kierownik') return channel === 'email' || channel === 'push';
  return false;
}

const DENYLIST_ROLLBACK_MAX_AGE_DAYS = 14;

function visibleTasks(state, user) {
  const rows = zleceniaRows(state);
  if (canSeeAll(user)) return rows;
  if (user.rola === 'Kierownik') return rows.filter((z) => String(z.oddzial_id) === String(user.oddzial_id));
  if (['Brygadzista', 'Pomocnik', 'Pomocnik bez doświadczenia'].includes(user.rola)) {
    if (!user.ekipa_id) return [];
    return rows.filter((z) => String(z.ekipa_id) === String(user.ekipa_id));
  }
  if (user.oddzial_id != null) return rows.filter((z) => String(z.oddzial_id) === String(user.oddzial_id));
  return rows;
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
  return vis || canSeeAll(user);
}

function oddzialNazwa(state, id) {
  const o = state.oddzialy.find((x) => x.id === id);
  return o ? o.nazwa : null;
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
  const targets = state.users.filter((u) => u.aktywny !== false && ['Administrator', 'Dyrektor', 'Kierownik'].includes(u.rola));
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

  router.get('/tasks/moje', requireAuth, (req, res) => {
    const list = readOnly((s) => mojeTasks(s, req.user).map((z) => enrichRow(s, z)));
    res.json(list);
  });

  router.get('/tasks', requireAuth, (req, res) => {
    const list = readOnly((s) => visibleTasks(s, req.user).map((z) => enrichRow(s, z)));
    res.json(list);
  });

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
    const row = withStore((s) => {
      const id = s.nextZlecenieId++;
      const now = new Date().toISOString();
      const oid = toNum(b.oddzial_id) ?? req.user.oddzial_id;
      const z = {
        id,
        typ: 'zlecenie',
        status: b.status || 'Nowe',
        klient_nazwa: b.klient_nazwa || null,
        klient_telefon: b.klient_telefon || null,
        klient_email: b.klient_email || null,
        adres: b.adres || '',
        miasto: b.miasto || '',
        oddzial_id: oid,
        ekipa_id: toNum(b.ekipa_id),
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
        created_by: req.user.id,
        created_at: now,
      };
      s.zlecenia.push(z);
      return enrichRow(s, z);
    });
    res.status(201).json(row);
  });

  router.put('/tasks/:id', requireAuth, (req, res) => {
    const id = toNum(req.params.id);
    const b = req.body || {};
    const row = withStore((s) => {
      const z = s.zlecenia.find((x) => x.id === id);
      if (!z || !canViewTask(s, req.user, id)) return null;
      const mergeKeys = Object.keys(b).filter((k) => k !== 'id');
      for (const k of mergeKeys) {
        if (b[k] === undefined) continue;
        if (['ekipa_id', 'oddzial_id', 'kierownik_id', 'czas_planowany_godziny', 'wartosc_planowana'].includes(k)) {
          z[k] = toNum(b[k]) ?? b[k];
        } else {
          z[k] = b[k];
        }
      }
      if (b.data_planowana || b.data_wykonania) {
        z.data_planowana = b.data_planowana || z.data_planowana;
        z.data_wykonania = b.data_wykonania || z.data_wykonania;
      }
      return enrichRow(s, z);
    });
    if (!row) return res.status(404).json({ error: 'Nie znaleziono' });
    res.json(row);
  });

  router.delete('/tasks/:id', requireAuth, (req, res) => {
    const id = toNum(req.params.id);
    if (!['Administrator', 'Dyrektor'].includes(req.user.rola)) {
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
    const row = withStore((s) => {
      const z = s.zlecenia.find((x) => x.id === id);
      if (!z || !canViewTask(s, req.user, id)) return null;
      const prevStatus = z.status;
      if (status) z.status = status;
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
    const row = withStore((s) => {
      const z = s.zlecenia.find((x) => x.id === id);
      if (!z || !canViewTask(s, req.user, id)) return null;
      z.ekipa_id = ekipaId;
      return enrichRow(s, z);
    });
    if (!row) return res.status(404).json({ error: 'Nie znaleziono' });
    res.json(row);
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
    if (!['Administrator', 'Dyrektor'].includes(req.user?.rola)) return res.status(403).json({ error: 'Brak uprawnień' });
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
    if (!['Administrator', 'Dyrektor'].includes(req.user?.rola)) return res.status(403).json({ error: 'Brak uprawnień' });
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
    if (!['Administrator', 'Dyrektor'].includes(req.user?.rola)) return res.status(403).json({ error: 'Brak uprawnień' });
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
        const meta = {
          id: zid,
          typ,
          sciezka: rel,
          created_at: new Date().toISOString(),
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
      const isMgmt = ['Administrator', 'Dyrektor', 'Kierownik'].includes(req.user.rola);
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
    if (!['Administrator', 'Dyrektor'].includes(req.user.rola)) return res.status(403).json({ error: 'Brak uprawnień' });
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
    if (!['Administrator', 'Dyrektor'].includes(req.user.rola)) return res.status(403).json({ error: 'Brak uprawnień' });
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
    if (!['Administrator', 'Dyrektor'].includes(req.user.rola)) return res.status(403).json({ error: 'Brak uprawnień' });
    const id = toNum(req.params.id);
    withStore((s) => {
      s.oddzialy = s.oddzialy.filter((o) => o.id !== id);
    });
    res.json({ ok: true });
  });

  router.get('/oddzialy/delegacje/wszystkie', requireAuth, (req, res) => {
    const list = readOnly((s) => s.delegacje || []);
    res.json(list);
  });

  router.post('/oddzialy/delegacje', requireAuth, (req, res) => {
    const b = req.body || {};
    const row = withStore((s) => {
      if (!s.delegacje) s.delegacje = [];
      const id = s.nextDelegacjaId++;
      const d = {
        id,
        ekipa_id: toNum(b.ekipa_id),
        oddzial_z: toNum(b.oddzial_z),
        oddzial_do: toNum(b.oddzial_do),
        data_od: b.data_od,
        data_do: b.data_do || null,
        cel: b.cel || '',
        uwagi: b.uwagi || '',
        status: 'Planowana',
        created_at: new Date().toISOString(),
      };
      s.delegacje.push(d);
      return d;
    });
    res.status(201).json(row);
  });

  router.put('/oddzialy/delegacje/:id/status', requireAuth, (req, res) => {
    const id = toNum(req.params.id);
    const { status } = req.body || {};
    const row = withStore((s) => {
      const d = (s.delegacje || []).find((x) => x.id === id);
      if (!d) return null;
      if (status) d.status = status;
      return d;
    });
    if (!row) return res.status(404).json({ error: 'Nie znaleziono' });
    res.json(row);
  });

  router.put('/oddzialy/pracownik/:userId/przenies', requireAuth, (req, res) => {
    if (!['Administrator', 'Dyrektor'].includes(req.user.rola)) return res.status(403).json({ error: 'Brak uprawnień' });
    const uid = toNum(req.params.userId);
    const oddzialId = toNum(req.body?.oddzial_id);
    const row = withStore((s) => {
      const u = s.users.find((x) => x.id === uid);
      const o = s.oddzialy.find((x) => x.id === oddzialId);
      if (!u || !o) return null;
      u.oddzial_id = oddzialId;
      u.oddzial_nazwa = o.nazwa;
      return stripHaslo(u);
    });
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
      return t ? buildEkipaDetail(s, t) : null;
    });
    if (!row) return res.status(404).json({ error: 'Nie znaleziono' });
    res.json(row);
  });

  router.post('/ekipy', requireAuth, (req, res) => {
    const b = req.body || {};
    const row = withStore((s) => {
      const id = s.teams.length ? Math.max(...s.teams.map((t) => t.id)) + 1 : 1;
      const t = {
        id,
        nazwa: b.nazwa,
        oddzial_id: toNum(b.oddzial_id),
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
    const row = withStore((s) => {
      const t = s.teams.find((x) => x.id === id);
      if (!t) return null;
      if (b.nazwa != null) t.nazwa = b.nazwa;
      if (b.oddzial_id != null) t.oddzial_id = toNum(b.oddzial_id);
      if (b.kolor != null) t.kolor = b.kolor;
      if (b.brygadzista_id !== undefined) t.brygadzista_id = toNum(b.brygadzista_id);
      if (b.procent_wynagrodzenia != null) t.procent_wynagrodzenia = Number(b.procent_wynagrodzenia);
      return buildEkipaDetail(s, t);
    });
    if (!row) return res.status(404).json({ error: 'Nie znaleziono' });
    res.json(row);
  });

  router.delete('/ekipy/:id', requireAuth, (req, res) => {
    const id = toNum(req.params.id);
    withStore((s) => {
      s.teams = s.teams.filter((t) => t.id !== id);
      s.ekipaCzlonkowie = (s.ekipaCzlonkowie || []).filter((c) => c.ekipa_id !== id);
    });
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
    const nested = b.user || {};
    const uid = toNum(
      b.user_id ?? b.pracownik_id ?? b.uzytkownik_id ?? nested.id ?? b.userId ?? b.pracownikId
    );
    const rola = b.rola || b.rola_w_ekipie || nested.rola || 'Pomocnik';
    const r = withStore((s) => {
      const team = s.teams.find((t) => t.id === ekipaId);
      if (!team || !uid) return null;
      const out = addMember(s, ekipaId, uid, rola);
      return out.duplicate ? { duplicate: true } : { ok: true };
    });
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
    withStore((s) => {
      s.ekipaCzlonkowie = (s.ekipaCzlonkowie || []).filter((c) => !(c.ekipa_id === ekipaId && c.user_id === workerId));
    });
    res.json({ ok: true });
  }
  router.delete('/ekipy/:id/czlonkowie/:workerId', requireAuth, deleteEkipaMember);
  router.delete('/ekipy/:id/pracownicy/:workerId', requireAuth, deleteEkipaMember);
  router.delete('/ekipy/:id/members/:workerId', requireAuth, deleteEkipaMember);

  router.get('/uzytkownicy/:id', requireAuth, (req, res) => {
    const id = toNum(req.params.id);
    const row = readOnly((s) => stripHaslo(s.users.find((u) => u.id === id)));
    if (!row) return res.status(404).json({ error: 'Nie znaleziono' });
    res.json(row);
  });

  router.post('/uzytkownicy', requireAuth, (req, res) => {
    if (!['Administrator', 'Dyrektor', 'Kierownik'].includes(req.user.rola)) {
      return res.status(403).json({ error: 'Brak uprawnień' });
    }
    const b = req.body || {};
    const row = withStore((s) => {
      const id = s.nextUserId++;
      const oid = toNum(b.oddzial_id);
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
      const skip = ['id', 'haslo'];
      for (const k of Object.keys(b)) {
        if (skip.includes(k)) continue;
        if (k === 'oddzial_id') {
          u.oddzial_id = toNum(b.oddzial_id);
          u.oddzial_nazwa = oddzialNazwa(s, u.oddzial_id);
        } else {
          u[k] = b[k];
        }
      }
      return stripHaslo(u);
    });
    if (!row) return res.status(404).json({ error: 'Nie znaleziono' });
    res.json(row);
  });

  router.put('/uzytkownicy/:id/haslo', requireAuth, (req, res) => {
    const id = toNum(req.params.id);
    const nh = req.body?.nowe_haslo;
    if (!nh || String(nh).length < 6) return res.status(400).json({ error: 'Hasło min. 6 znaków' });
    withStore((s) => {
      const u = s.users.find((x) => x.id === id);
      if (u) u.haslo = nh;
    });
    res.json({ ok: true });
  });

  router.put('/uzytkownicy/:id/aktywny', requireAuth, (req, res) => {
    const id = toNum(req.params.id);
    const aktywny = req.body?.aktywny;
    const row = withStore((s) => {
      const u = s.users.find((x) => x.id === id);
      if (!u) return null;
      u.aktywny = aktywny;
      return stripHaslo(u);
    });
    if (!row) return res.status(404).json({ error: 'Nie znaleziono' });
    res.json(row);
  });

  router.put('/uzytkownicy/:id/procent', requireAuth, (req, res) => {
    const id = toNum(req.params.id);
    const p = toNum(req.body?.procent_wynagrodzenia);
    const row = withStore((s) => {
      const u = s.users.find((x) => x.id === id);
      if (!u) return null;
      u.procent_wynagrodzenia = p ?? 15;
      return stripHaslo(u);
    });
    if (!row) return res.status(404).json({ error: 'Nie znaleziono' });
    res.json(row);
  });

  router.get('/uzytkownicy/:id/kompetencje', requireAuth, (req, res) => {
    const id = toNum(req.params.id);
    const list = readOnly((s) => (s.kompetencje || []).filter((k) => k.user_id === id));
    res.json(list);
  });

  router.post('/uzytkownicy/:id/kompetencje', requireAuth, (req, res) => {
    const id = toNum(req.params.id);
    const b = req.body || {};
    const row = withStore((s) => {
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
    res.status(201).json(row);
  });

  router.delete('/uzytkownicy/:userId/kompetencje/:kid', requireAuth, (req, res) => {
    const uid = toNum(req.params.userId);
    const kid = toNum(req.params.kid);
    withStore((s) => {
      s.kompetencje = (s.kompetencje || []).filter((k) => !(k.user_id === uid && k.id === kid));
    });
    res.json({ ok: true });
  });

  router.get('/role', requireAuth, (req, res) => {
    const list = readOnly((s) => s.roles || []);
    res.json(list);
  });

  router.post('/role', requireAuth, (req, res) => {
    if (!['Administrator', 'Dyrektor'].includes(req.user.rola)) return res.status(403).json({ error: 'Brak uprawnień' });
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
    if (!['Administrator', 'Dyrektor'].includes(req.user.rola)) return res.status(403).json({ error: 'Brak uprawnień' });
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
    if (!['Administrator', 'Dyrektor'].includes(req.user.rola)) return res.status(403).json({ error: 'Brak uprawnień' });
    const id = toNum(req.params.id);
    withStore((s) => {
      s.roles = (s.roles || []).filter((r) => r.id !== id);
    });
    res.json({ ok: true });
  });

  router.get('/flota/pojazdy', requireAuth, (req, res) => {
    res.json(readOnly((s) => s.flotaPojazdy || []));
  });
  router.get('/flota/sprzet', requireAuth, (req, res) => {
    res.json(readOnly((s) => s.flotaSprzet || []));
  });
  router.get('/flota/naprawy', requireAuth, (req, res) => {
    res.json(readOnly((s) => s.flotaNaprawy || []));
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
      s.flotaPojazdy.push(p);
      return p;
    });
    res.status(201).json(row);
  });

  router.post('/flota/sprzet', requireAuth, (req, res) => {
    const b = req.body || {};
    const row = withStore((s) => {
      const id = s.nextFlotaSprzetId++;
      const p = { id, ...b, status: b.status || 'Dostępny', oddzial_id: toNum(b.oddzial_id), ekipa_id: toNum(b.ekipa_id) };
      s.flotaSprzet.push(p);
      return p;
    });
    res.status(201).json(row);
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
