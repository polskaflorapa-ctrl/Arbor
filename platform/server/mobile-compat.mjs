// Warstwa kompatybilności dla natywnej aplikacji mobilnej (Expo, repo C:\Users\paha1\arbor\mobile).
// Aplikacja mówi kontraktem backendu "os" (polskie nazwy: /api/tasks/moje, /api/ekipy,
// /api/oddzialy, user {imie, nazwisko, rola, oddzial_id, ekipa_id}) — ten moduł tłumaczy
// go dwukierunkowo na kanoniczny model danych platformy (orders/crews/branches/users/
// equipment/valuations/invoices). Kształty wzięte z mobile/utils/testMode.ts i ekranów.
//
// Autoryzacja mutacji: model terenowy jak w /api/sync/mutations — użytkownik może
// mutować zlecenia w swoim zakresie widoczności (rola+oddział+ekipa), bez wymogu
// orders:write (brygadzista w terenie zamyka SWOJE zlecenia).
//
// Zdjęcia: przyjmujemy metadane i liczniki (wpisy w timeline zlecenia); binaria
// czekają na skonfigurowany storage (AWS_S3_BUCKET) — patrz komentarz przy endpointcie.

const ROLE_LABELS = {
  ADMINISTRATOR: 'Administrator',
  DYREKTOR: 'Dyrektor',
  ROP: 'Dyrektor',
  KIEROWNIK: 'Kierownik',
  WYCENIAJACY: 'Wyceniający',
  BRYGADZISTA: 'Brygadzista',
  PRACOWNIK: 'Pracownik',
  KSIEGOWA: 'Księgowa',
};

const STATUS_TO_MOBILE = {
  NOWE: 'Nowe',
  ZAPLANOWANE: 'Zaplanowane',
  W_REALIZACJI: 'W realizacji',
  ZAKONCZONE: 'Zakończone',
  ANULOWANE: 'Anulowane',
};
const STATUS_FROM_MOBILE = Object.fromEntries(
  Object.entries(STATUS_TO_MOBILE).map(([canonical, mobile]) => [mobile.toLowerCase(), canonical]),
);

const PRIORITY_TO_MOBILE = { niski: 'Niski', normalny: 'Normalny', wysoki: 'Wysoki', pilny: 'Pilny' };
const PRIORITY_FROM_MOBILE = Object.fromEntries(
  Object.entries(PRIORITY_TO_MOBILE).map(([canonical, mobile]) => [mobile.toLowerCase(), canonical]),
);

export function mobileUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    imie: user.firstName ?? '',
    nazwisko: user.lastName ?? '',
    email: user.email ?? `${user.login}@polskaflora.local`,
    login: user.login,
    rola: ROLE_LABELS[user.role] ?? user.role,
    oddzial_id: user.branchId ?? null,
    ekipa_id: user.teamId ?? null,
  };
}

// Ostatnie pozycje GPS ekip (zasilane przez POST /api/mobile/me/location).
// In-memory: pozycja "na żywo" jest ulotna z natury; trwały ślad idzie eventem gps:*.
const liveLocations = new Map();

export function registerMobileCompat(app, deps) {
  const {
    visibleOrders, visibleBranches, visibleCrews, visibleUsers, visibleNotifications,
    visibleEquipment, visibleValuations, saveDb, pushEvent, portalTokenFor,
  } = deps;

  const actorName = (user) => `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || user.login;
  const nowIso = () => new Date().toISOString();
  const newId = (prefix) => `${prefix}-${Math.random().toString(36).slice(2, 10)}`;

  function timelineOf(order) {
    order.timeline ??= [];
    return order.timeline;
  }

  function mobileTask(db, order) {
    const client = (db.clients ?? []).find((next) => next.id === order.clientId) ?? {};
    const crew = (db.crews ?? []).find((next) => next.id === order.teamId) ?? {};
    const timeline = order.timeline ?? [];
    const photos = timeline.filter((entry) => entry.kind === 'photo');
    return {
      id: order.id,
      klient_nazwa: client.name ?? order.clientId ?? 'Klient',
      klient_telefon: client.phone ?? null,
      klient_email: client.email ?? null,
      adres: order.address ?? '',
      miasto: order.city ?? '',
      typ_uslugi: order.type ?? 'Prace arborystyczne',
      status: STATUS_TO_MOBILE[order.status] ?? order.status ?? 'Nowe',
      priorytet: PRIORITY_TO_MOBILE[order.priority] ?? 'Normalny',
      data_planowana: order.scheduledAt ?? null,
      data_zaplanowana: order.scheduledAt ?? null,
      brygadzista_id: crew.leaderId ?? null,
      ekipa_id: order.teamId ?? null,
      ekipa_nazwa: crew.name ?? null,
      opis: order.mobileNotes ?? [order.type, order.priority ? `priorytet: ${order.priority}` : null].filter(Boolean).join(' · '),
      notatki_wewnetrzne: order.mobileNotes ?? '',
      wartosc_planowana: order.value ?? null,
      czas_planowany_godziny: order.plannedHours ?? null,
      created_at: order.createdAt ?? null,
      photo_total: photos.length,
      photo_wycena: photos.filter((entry) => entry.photoType === 'wycena').length,
      photo_szkic: photos.filter((entry) => entry.photoType === 'szkic').length,
      photo_dojazd: photos.filter((entry) => entry.photoType === 'dojazd').length,
      work_logs_total: timeline.length,
    };
  }

  function findOrderInScope(req, id) {
    return visibleOrders(req.db, req.user).find((order) => String(order.id) === String(id)) ?? null;
  }

  function myOrders(req) {
    const orders = visibleOrders(req.db, req.user).filter((order) => order.status !== 'ANULOWANE');
    if (req.user.teamId) return orders.filter((order) => order.teamId === req.user.teamId);
    return orders;
  }

  async function recordTimeline(req, order, entry, eventName, eventPayload) {
    timelineOf(order).push({ at: nowIso(), by: actorName(req.user), ...entry });
    order.updatedAt = nowIso();
    order.updatedBy = req.user.id;
    if (eventName) {
      pushEvent(req.db, req.user, `branch:${order.branchId}:orders`, eventName, { id: order.id, ...eventPayload });
    }
    await saveDb(req.db);
  }

  // ---- Sesja / użytkownicy ----
  app.get('/api/auth/me', (req, res) => {
    res.json({ user: mobileUser(req.user) });
  });

  app.get('/api/auth/pomocnicy', (req, res) => {
    const team = visibleUsers(req.db, req.user).filter((user) => user.teamId && user.teamId === req.user.teamId && user.id !== req.user.id);
    res.json(team.map(mobileUser));
  });

  app.get('/api/uzytkownicy', (req, res) => {
    res.json(visibleUsers(req.db, req.user).map(mobileUser));
  });

  // ---- Zlecenia (mobile "tasks") ----
  app.get('/api/tasks/moje', (req, res) => {
    res.json(myOrders(req).map((order) => mobileTask(req.db, order)));
  });

  app.get('/api/tasks/wszystkie', (req, res) => {
    let orders = visibleOrders(req.db, req.user);
    const { from, to, data } = req.query;
    const inDay = (value, day) => String(value ?? '').slice(0, 10) === String(day);
    if (data) orders = orders.filter((order) => inDay(order.scheduledAt, data));
    if (from) orders = orders.filter((order) => String(order.scheduledAt ?? '').slice(0, 10) >= String(from));
    if (to) orders = orders.filter((order) => String(order.scheduledAt ?? '').slice(0, 10) <= String(to));
    res.json(orders.map((order) => mobileTask(req.db, order)));
  });

  app.get('/api/tasks/nowe', (req, res) => {
    res.json(visibleOrders(req.db, req.user).filter((order) => order.status === 'NOWE').map((order) => mobileTask(req.db, order)));
  });

  app.get('/api/tasks/stats', (req, res) => {
    const orders = visibleOrders(req.db, req.user);
    const count = (status) => orders.filter((order) => order.status === status).length;
    res.json({
      nowe: count('NOWE'),
      zaplanowane: count('ZAPLANOWANE'),
      w_realizacji: count('W_REALIZACJI'),
      zakonczone: count('ZAKONCZONE'),
      razem: orders.length,
    });
  });

  // Wyceny terenowe (szkice) — mapowane na kanoniczne valuations (widoczne w biurze!).
  app.get('/api/tasks/field-drafts', (req, res) => {
    const valuations = visibleValuations(req.db, req.user).filter((valuation) => (valuation.media ?? []).includes('mobile'));
    res.json(valuations.map((valuation) => ({
      id: valuation.id,
      task_id: valuation.orderId,
      status: valuation.status,
      wartosc: valuation.totalNet ?? null,
      pozycje: valuation.items ?? [],
      notatki: valuation.notes ?? '',
      created_at: valuation.createdAt ?? null,
    })));
  });

  app.post('/api/tasks/field-drafts', async (req, res) => {
    const body = req.body ?? {};
    const orderId = body.task_id ?? body.orderId ?? body.zlecenie_id ?? null;
    const order = orderId ? findOrderInScope(req, orderId) : null;
    // Wycena musi wskazywać zlecenie — z niego bierzemy klienta (NOT NULL w schemacie).
    if (!order) return res.status(orderId ? 404 : 400).json({ error: orderId ? 'Zlecenie poza zakresem' : 'Wycena terenowa wymaga zlecenia (task_id)' });
    // orderId jest UNIQUE: szkic z terenu nadpisuje istniejący szkic, ale nie rusza
    // wyceny będącej już w obiegu biura (zatwierdzona/przydzielona).
    const existing = (req.db.valuations ?? []).find((valuation) => valuation.orderId === order.id);
    if (existing && existing.status !== 'do_potwierdzenia') {
      return res.status(409).json({ error: `Zlecenie ma już wycenę w obiegu (status: ${existing.status})` });
    }
    const valuation = existing ?? { id: newId('WM'), orderId: order.id, createdAt: nowIso(), createdBy: req.user.id };
    Object.assign(valuation, {
      clientId: order.clientId,
      branchId: order.branchId ?? req.user.branchId,
      estimatorId: req.user.id,
      status: 'do_potwierdzenia',
      inspectionAt: order.inspectionAt ?? order.scheduledAt ?? nowIso(),
      items: Array.isArray(body.pozycje ?? body.items) ? (body.pozycje ?? body.items) : [],
      totalNet: Number(body.wartosc ?? body.totalNet ?? 0) || 0,
      margin: 0,
      notes: String(body.notatki ?? body.notes ?? 'Wycena terenowa z aplikacji mobilnej'),
      media: ['mobile'],
      updatedAt: nowIso(),
      updatedBy: req.user.id,
    });
    if (!existing) (req.db.valuations ??= []).unshift(valuation);
    pushEvent(req.db, req.user, 'valuations', existing ? 'valuation.updated' : 'valuation.created', { id: valuation.id, orderId: valuation.orderId, totalNet: valuation.totalNet });
    await saveDb(req.db);
    res.status(existing ? 200 : 201).json({ id: valuation.id, ok: true });
  });

  app.get('/api/wyceny', (req, res) => {
    res.json(visibleValuations(req.db, req.user).map((valuation) => ({
      id: valuation.id,
      task_id: valuation.orderId,
      status: valuation.status,
      wartosc: valuation.totalNet ?? null,
      created_at: valuation.createdAt ?? null,
    })));
  });

  app.get('/api/tasks/:id', (req, res) => {
    const order = findOrderInScope(req, req.params.id);
    if (!order) return res.status(404).json({ error: 'Nie znaleziono zlecenia' });
    res.json(mobileTask(req.db, order));
  });

  // Edycja/zmiana statusu/przypisanie ekipy — używane przez szczegóły zlecenia i autoplan.
  app.put('/api/tasks/:id', async (req, res) => {
    const order = findOrderInScope(req, req.params.id);
    if (!order) return res.status(404).json({ error: 'Nie znaleziono zlecenia' });
    const body = req.body ?? {};
    const changes = [];

    if (body.status != null) {
      const nextStatus = STATUS_FROM_MOBILE[String(body.status).toLowerCase()];
      if (nextStatus && nextStatus !== order.status) {
        order.status = nextStatus;
        changes.push(`status → ${STATUS_TO_MOBILE[nextStatus]}`);
      }
    }
    if ('ekipa_id' in body) {
      const teamId = body.ekipa_id == null ? null : String(body.ekipa_id);
      if (teamId !== (order.teamId ?? null)) {
        const crew = teamId ? (req.db.crews ?? []).find((next) => next.id === teamId) : null;
        if (teamId && !crew) return res.status(400).json({ error: 'Nieznana ekipa' });
        order.teamId = teamId;
        changes.push(`ekipa → ${crew?.name ?? 'brak'}`);
      }
    }
    if (body.priorytet != null) {
      const priority = PRIORITY_FROM_MOBILE[String(body.priorytet).toLowerCase()];
      if (priority) order.priority = priority;
    }
    if (body.adres != null) order.address = String(body.adres);
    if (body.miasto != null) order.city = String(body.miasto);
    if (body.typ_uslugi != null) order.type = String(body.typ_uslugi);
    if (body.wartosc_planowana != null) order.value = Number(body.wartosc_planowana) || order.value;
    if (body.czas_planowany_godziny != null) order.plannedHours = Number(body.czas_planowany_godziny) || null;
    if (body.notatki_wewnetrzne != null) order.mobileNotes = String(body.notatki_wewnetrzne).slice(0, 8000);
    if (body.data_zaplanowana != null || body.data_planowana != null) {
      const at = new Date(body.data_zaplanowana ?? body.data_planowana);
      if (!Number.isNaN(at.getTime())) order.scheduledAt = at.toISOString();
    }

    await recordTimeline(req, order, {
      label: changes.length ? `Aktualizacja z aplikacji mobilnej: ${changes.join(', ')}` : 'Aktualizacja danych z aplikacji mobilnej',
      kind: 'update',
    }, 'order.updated', { status: order.status, teamId: order.teamId });
    res.json(mobileTask(req.db, order));
  });

  app.post('/api/tasks/:id/finish', async (req, res) => {
    const order = findOrderInScope(req, req.params.id);
    if (!order) return res.status(404).json({ error: 'Nie znaleziono zlecenia' });
    order.status = 'ZAKONCZONE';
    const note = String(req.body?.notatka ?? req.body?.opis ?? '').trim();
    await recordTimeline(req, order, {
      label: note ? `Zakończone z terenu: ${note.slice(0, 300)}` : 'Zlecenie zakończone z aplikacji mobilnej',
      kind: 'finish',
    }, 'order.status_changed', { status: 'ZAKONCZONE' });
    res.json({ ok: true, task: mobileTask(req.db, order) });
  });

  app.get('/api/tasks/:id/logi', (req, res) => {
    const order = findOrderInScope(req, req.params.id);
    if (!order) return res.status(404).json({ error: 'Nie znaleziono zlecenia' });
    res.json((order.timeline ?? []).map((entry, index) => ({
      id: index + 1,
      opis: entry.label,
      user_nazwa: entry.by ?? null,
      created_at: entry.at ?? null,
    })));
  });

  app.get('/api/tasks/:id/problemy', (req, res) => {
    const order = findOrderInScope(req, req.params.id);
    if (!order) return res.status(404).json({ error: 'Nie znaleziono zlecenia' });
    res.json((order.timeline ?? []).filter((entry) => entry.kind === 'problem').map((entry, index) => ({
      id: index + 1,
      typ: entry.problemType ?? 'usterka',
      opis: entry.label,
      created_at: entry.at ?? null,
    })));
  });

  app.post('/api/tasks/:id/problemy', async (req, res) => {
    const order = findOrderInScope(req, req.params.id);
    if (!order) return res.status(404).json({ error: 'Nie znaleziono zlecenia' });
    const typ = String(req.body?.typ ?? 'usterka').slice(0, 80);
    const opis = String(req.body?.opis ?? '').trim().slice(0, 4000);
    if (!opis) return res.status(400).json({ error: 'Opis problemu jest wymagany' });
    (req.db.notifications ??= []).unshift({
      id: newId('req'),
      channel: 'zgloszenie',
      role: 'KIEROWNIK',
      title: `Problem z terenu (${typ}) · ${order.id}`,
      body: opis,
      unread: true,
      createdAt: nowIso(),
    });
    await recordTimeline(req, order, { label: `Problem (${typ}): ${opis.slice(0, 300)}`, kind: 'problem', problemType: typ }, 'order.problem_reported', { typ });
    res.status(201).json({ ok: true });
  });

  app.get('/api/tasks/:id/zdjecia', (req, res) => {
    const order = findOrderInScope(req, req.params.id);
    if (!order) return res.status(404).json({ error: 'Nie znaleziono zlecenia' });
    res.json((order.timeline ?? []).filter((entry) => entry.kind === 'photo').map((entry, index) => ({
      id: index + 1,
      typ: entry.photoType ?? 'dokumentacja',
      url: entry.url ?? null,
      opis: entry.note ?? null,
      created_at: entry.at ?? null,
    })));
  });

  // Zdjęcia: rejestrujemy metadane (typ, geo, opis) w timeline zlecenia — liczniki
  // photo_* w apce działają. Binaria wymagają storage (AWS_S3_BUCKET w .env) —
  // do czasu konfiguracji url pozostaje null, a apka pokazuje wpis bez podglądu.
  app.post('/api/tasks/:id/zdjecia', async (req, res) => {
    const order = findOrderInScope(req, req.params.id);
    if (!order) return res.status(404).json({ error: 'Nie znaleziono zlecenia' });
    const body = req.body ?? {};
    const photoType = String(body.typ ?? req.query.typ ?? 'dokumentacja').slice(0, 40);
    await recordTimeline(req, order, {
      label: `Zdjęcie z terenu (${photoType})`,
      kind: 'photo',
      photoType,
      note: body.opis ? String(body.opis).slice(0, 500) : null,
    }, 'order.photo_added', { typ: photoType });
    res.status(201).json({ ok: true, url: null });
  });

  app.get('/api/tasks/:id/protokol-link', (req, res) => {
    const order = findOrderInScope(req, req.params.id);
    if (!order) return res.status(404).json({ error: 'Nie znaleziono zlecenia' });
    const token = portalTokenFor(order);
    res.json({ url: `/portal?token=${encodeURIComponent(token)}`, token });
  });

  // ---- Struktura firmy ----
  app.get('/api/oddzialy', (req, res) => {
    res.json(visibleBranches(req.db, req.user).map((branch) => ({
      id: branch.id,
      nazwa: branch.name ?? branch.city ?? branch.id,
      adres: branch.city ?? '',
      telefon: branch.phone ?? null,
      kierownik_id: null,
    })));
  });

  app.get('/api/ekipy', (req, res) => {
    res.json(visibleCrews(req.db, req.user).map((crew) => ({
      id: crew.id,
      nazwa: crew.name ?? crew.id,
      brygadzista_id: crew.leaderId ?? null,
      oddzial_id: crew.branchId ?? null,
      pracownicy: crew.members ?? [],
      liczba_czlonkow: (crew.members ?? []).length,
    })));
  });

  app.get('/api/ekipy/live-locations', (req, res) => {
    const crews = new Set(visibleCrews(req.db, req.user).map((crew) => crew.id));
    res.json([...liveLocations.values()].filter((location) => crews.has(location.ekipa_id)));
  });

  // ---- Flota ----
  const vehicleTypes = new Set(['pojazd']);
  function mobileEquipment(item) {
    return {
      id: item.id,
      nazwa: item.name ?? item.id,
      typ: item.type ?? 'sprzet',
      status: item.status ?? 'dostepny',
      oddzial_id: item.branchId ?? null,
      przeglad_do: item.serviceDueAt ?? null,
    };
  }

  app.get('/api/flota/pojazdy', (req, res) => {
    res.json(visibleEquipment(req.db, req.user).filter((item) => vehicleTypes.has(item.type)).map(mobileEquipment));
  });

  app.get('/api/flota/sprzet', (req, res) => {
    res.json(visibleEquipment(req.db, req.user).filter((item) => !vehicleTypes.has(item.type)).map(mobileEquipment));
  });

  app.get('/api/flota/naprawy', (req, res) => {
    res.json(visibleEquipment(req.db, req.user).filter((item) => item.status === 'serwis').map((item) => ({
      id: item.id,
      sprzet_id: item.id,
      nazwa: item.name ?? item.id,
      status: 'w naprawie',
      created_at: item.updatedAt ?? null,
    })));
  });

  async function setEquipmentStatus(req, res) {
    const item = visibleEquipment(req.db, req.user).find((next) => String(next.id) === String(req.params.id));
    if (!item) return res.status(404).json({ error: 'Nie znaleziono sprzętu' });
    const statusMap = { dostepny: 'dostepny', 'w naprawie': 'serwis', serwis: 'serwis', 'w terenie': 'w_terenie', zarezerwowany: 'zarezerwowany' };
    const next = statusMap[String(req.body?.status ?? '').toLowerCase()];
    if (!next) return res.status(400).json({ error: 'Nieznany status' });
    item.status = next;
    item.updatedAt = nowIso();
    pushEvent(req.db, req.user, 'announcements', 'equipment.status_changed', { id: item.id, status: next });
    await saveDb(req.db);
    res.json(mobileEquipment(item));
  }
  app.put('/api/flota/pojazdy/:id/status', setEquipmentStatus);
  app.put('/api/flota/sprzet/:id/status', setEquipmentStatus);

  app.post('/api/flota/naprawy', async (req, res) => {
    const item = visibleEquipment(req.db, req.user).find((next) => String(next.id) === String(req.body?.sprzet_id ?? req.body?.pojazd_id ?? ''));
    if (!item) return res.status(404).json({ error: 'Nie znaleziono sprzętu' });
    item.status = 'serwis';
    item.updatedAt = nowIso();
    (req.db.notifications ??= []).unshift({
      id: newId('nap'),
      channel: 'zgloszenie',
      role: 'KIEROWNIK',
      title: `Zgłoszenie naprawy: ${item.name ?? item.id}`,
      body: String(req.body?.opis ?? 'Zgłoszono z aplikacji mobilnej').slice(0, 2000),
      unread: true,
      createdAt: nowIso(),
    });
    pushEvent(req.db, req.user, 'announcements', 'equipment.repair_reported', { id: item.id });
    await saveDb(req.db);
    res.status(201).json({ ok: true, id: item.id });
  });

  // ---- Raporty / pulpit ----
  app.get('/api/raporty/mobile', (req, res) => {
    const orders = visibleOrders(req.db, req.user);
    const today = nowIso().slice(0, 10);
    res.json({
      zlecenia_nowe: orders.filter((order) => order.status === 'NOWE').length,
      zlecenia_w_realizacji: orders.filter((order) => order.status === 'W_REALIZACJI').length,
      zlecenia_ukonczone_dzisiaj: orders.filter((order) => order.status === 'ZAKONCZONE' && String(order.updatedAt ?? '').slice(0, 10) === today).length,
      zespoly_aktywne: new Set(orders.filter((order) => order.status === 'W_REALIZACJI').map((order) => order.teamId).filter(Boolean)).size,
      sr_zadowolenie: null,
    });
  });

  app.get('/api/raporty/ranking-brygad', (req, res) => {
    const orders = visibleOrders(req.db, req.user);
    res.json(visibleCrews(req.db, req.user).map((crew) => {
      const mine = orders.filter((order) => order.teamId === crew.id);
      return {
        ekipa_id: crew.id,
        ekipa_nazwa: crew.name ?? crew.id,
        zakonczone: mine.filter((order) => order.status === 'ZAKONCZONE').length,
        w_realizacji: mine.filter((order) => order.status === 'W_REALIZACJI').length,
        wartosc: mine.reduce((sum, order) => sum + (Number(order.value) || 0), 0),
      };
    }).sort((a, b) => b.zakonczone - a.zakonczone));
  });

  app.get('/api/mobile/me/settlements-overview', (req, res) => {
    const orders = myOrders(req);
    const orderIds = new Set(orders.map((order) => order.id));
    const invoices = (req.db.invoices ?? []).filter((invoice) => orderIds.has(invoice.orderId));
    res.json({
      zlecenia_zakonczone: orders.filter((order) => order.status === 'ZAKONCZONE').length,
      wartosc_zakonczonych: orders.filter((order) => order.status === 'ZAKONCZONE').reduce((sum, order) => sum + (Number(order.value) || 0), 0),
      faktury_wystawione: invoices.length,
      faktury_oplacone: invoices.filter((invoice) => invoice.status === 'oplacona').length,
    });
  });

  app.post('/api/mobile/me/team-day-close', async (req, res) => {
    (req.db.notifications ??= []).unshift({
      id: newId('day'),
      channel: 'zgloszenie',
      role: 'KIEROWNIK',
      title: `Zamknięcie dnia ekipy · ${actorName(req.user)}`,
      body: String(req.body?.podsumowanie ?? 'Ekipa zamknęła dzień w aplikacji mobilnej').slice(0, 2000),
      unread: true,
      createdAt: nowIso(),
    });
    pushEvent(req.db, req.user, `branch:${req.user.branchId}:orders`, 'team.day_closed', { teamId: req.user.teamId });
    await saveDb(req.db);
    res.json({ ok: true });
  });

  app.post('/api/mobile/reports', async (req, res) => {
    (req.db.notifications ??= []).unshift({
      id: newId('rap'),
      channel: 'zgloszenie',
      role: 'KIEROWNIK',
      title: `Raport z terenu · ${actorName(req.user)}`,
      body: JSON.stringify(req.body ?? {}).slice(0, 4000),
      unread: true,
      createdAt: nowIso(),
    });
    await saveDb(req.db);
    res.status(201).json({ ok: true });
  });

  app.get('/api/cmr', (_req, res) => res.json([]));

  // ---- Konfiguracja i telemetria urządzenia ----
  const mobileConfig = { oddzialFeatureOverrides: {}, appFlags: {} };
  app.get('/api/mobile-config', (_req, res) => res.json(mobileConfig));
  app.get('/api/config/mobile', (_req, res) => res.json(mobileConfig));

  app.post('/api/mobile/me/push-token', (_req, res) => res.json({ ok: true }));

  app.post('/api/mobile/me/location', async (req, res) => {
    const { lat, lng } = req.body ?? {};
    if (Number.isFinite(Number(lat)) && Number.isFinite(Number(lng)) && req.user.teamId) {
      liveLocations.set(req.user.teamId, {
        ekipa_id: req.user.teamId,
        user_id: req.user.id,
        lat: Number(lat),
        lng: Number(lng),
        updated_at: nowIso(),
      });
      pushEvent(req.db, req.user, `gps:${req.user.branchId}`, 'crew.location', {
        teamId: req.user.teamId,
        lat: Number(lat),
        lng: Number(lng),
      });
      await saveDb(req.db);
    }
    res.json({ ok: true });
  });

  app.get('/api/notifications', (req, res) => {
    res.json(visibleNotifications(req.db, req.user).map((notification) => ({
      id: notification.id,
      tytul: notification.title,
      tresc: notification.body,
      przeczytane: !notification.unread,
      created_at: notification.createdAt,
    })));
  });
}
