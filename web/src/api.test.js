import api from './api';
import { TEST_TOKEN } from './utils/testMode';

describe('api test-mode mocks', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('arbor-test-mode', 'true');
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('serves mock login when same-origin calls include the /api prefix', async () => {
    const response = await api.post('/api/auth/login', { login: 'demo_dyrektor', haslo: 'Demo123!ARBOR' });

    expect(response.status).toBe(200);
    expect(response.data.token).toBe(TEST_TOKEN);
    expect(response.data.user.rola).toBe('Dyrektor');
  });

  it('serves the stored test user for /auth/me', async () => {
    localStorage.setItem('user', JSON.stringify({
      id: 7,
      imie: 'Anna',
      nazwisko: 'Kierownik',
      rola: 'Kierownik',
      oddzial_id: 2,
    }));
    localStorage.setItem('permissions', JSON.stringify({ canViewFinance: true }));

    const response = await api.get('/api/auth/me', { dedupe: false });

    expect(response.status).toBe(200);
    expect(response.data).toMatchObject({
      id: 7,
      rola: 'Kierownik',
      permissions: { canViewFinance: true },
    });
  });

  it('serves mock data when same-origin GET calls include the /api prefix', async () => {
    const response = await api.get('/api/notifications');

    expect(response.status).toBe(200);
    expect(response.data).toEqual({ notifications: [], unread_count: 0 });
  });

  it('serves inspection mocks for the local field-inspection views', async () => {
    const list = await api.get('/api/ogledziny?status=Zaplanowane', { dedupe: false });

    expect(list.status).toBe(200);
    expect(list.data.length).toBeGreaterThan(0);
    expect(list.data[0]).toEqual(expect.objectContaining({
      id: expect.any(Number),
      status: 'Zaplanowane',
      klient_nazwa: expect.any(String),
      data_planowana: expect.any(String),
    }));

    const detail = await api.get(`/api/ogledziny/${list.data[0].id}`, { dedupe: false });
    expect(detail.status).toBe(200);
    expect(detail.data).toEqual(expect.objectContaining({
      id: list.data[0].id,
      zdjecia: expect.any(Array),
      media: expect.any(Array),
    }));
  });

  it('serves and persists branch goal and sales metric mocks', async () => {
    const goals = await api.get('/api/oddzialy/cele?rok=2026&miesiac=5', { dedupe: false });
    const sales = await api.get('/api/oddzialy/sprzedaz?rok=2026&miesiac=5', { dedupe: false });

    expect(goals.status).toBe(200);
    expect(goals.data[0]).toEqual(expect.objectContaining({
      oddzial_id: expect.any(Number),
      rok: 2026,
      miesiac: 5,
      plan_zlecen: expect.any(Number),
    }));
    expect(sales.status).toBe(200);
    expect(sales.data[0]).toEqual(expect.objectContaining({
      oddzial_id: expect.any(Number),
      calls_total: expect.any(Number),
      leads_new: expect.any(Number),
    }));

    const savedGoal = await api.post('/api/oddzialy/cele', {
      oddzial_id: goals.data[0].oddzial_id,
      rok: 2026,
      miesiac: 5,
      plan_zlecen: 11,
      plan_obrotu: 22000,
      plan_marzy: 27,
    });
    const savedSales = await api.post('/api/oddzialy/sprzedaz', {
      oddzial_id: goals.data[0].oddzial_id,
      rok: 2026,
      miesiac: 5,
      calls_total: 44,
      calls_answered: 36,
      calls_missed: 8,
      leads_new: 12,
      meetings_booked: 6,
    });

    expect(savedGoal.data).toMatchObject({ plan_zlecen: 11, plan_obrotu: 22000 });
    expect(savedSales.data).toMatchObject({ calls_total: 44, meetings_booked: 6 });

    const goalsAfter = await api.get('/api/oddzialy/cele?rok=2026&miesiac=5', { dedupe: false });
    const salesAfter = await api.get('/api/oddzialy/sprzedaz?rok=2026&miesiac=5', { dedupe: false });
    expect(goalsAfter.data.find((row) => row.oddzial_id === goals.data[0].oddzial_id)).toMatchObject({ plan_zlecen: 11 });
    expect(salesAfter.data.find((row) => row.oddzial_id === goals.data[0].oddzial_id)).toMatchObject({ calls_total: 44 });
  });

  it('serves status workflow side-effect mocks', async () => {
    const log = await api.post('/api/tasks/101/logi', {
      tresc: 'Workflow: test',
      status: 'W_Realizacji',
    });
    expect(log.status).toBe(201);
    expect(log.data).toMatchObject({
      task_id: 101,
      tresc: 'Workflow: test',
      status: 'W_Realizacji',
    });

    const notification = await api.post('/api/notifications', {
      typ: 'info',
      tresc: 'Powiadomienie testowe',
      task_id: 101,
    });
    expect(notification.status).toBe(201);
    expect(notification.data).toMatchObject({
      typ: 'info',
      tresc: 'Powiadomienie testowe',
      task_id: 101,
      read: false,
    });

    const sms = await api.post('/api/sms/zlecenie/101', { typ: 'w_drodze' });
    expect(sms.status).toBe(200);
    expect(sms.data).toMatchObject({
      task_id: 101,
      typ: 'w_drodze',
      status: 'sent',
    });
  });

  it('persists client contact status mocks', async () => {
    const saved = await api.patch('/api/tasks/101/client-contact', {
      status: 'informed',
      note: 'Klient potwierdzil termin i zakres.',
    });

    expect(saved.status).toBe(200);
    expect(saved.data).toMatchObject({
      task_id: 101,
      status: 'informed',
      note: 'Klient potwierdzil termin i zakres.',
      actor: 'Test Dyrektor',
    });
    expect(saved.data.history[0]).toMatchObject({
      task_id: 101,
      status: 'informed',
    });

    const contacts = await api.get('/api/tasks/client-contacts', { dedupe: false });
    expect(contacts.data.contacts['101']).toMatchObject({
      task_id: 101,
      status: 'informed',
      note: 'Klient potwierdzil termin i zakres.',
    });
  });

  it('persists closure decision event mocks', async () => {
    const saved = await api.post('/api/tasks/101/closure-events', {
      action: 'clean_close',
      status_before: 'W_Realizacji',
      status_after: 'Zakonczone',
      warnings: [{ key: 'client', label: 'Status klienta' }],
    });

    expect(saved.status).toBe(201);
    expect(saved.data).toMatchObject({
      task_id: 101,
      action: 'clean_close',
      status_before: 'W_Realizacji',
      status_after: 'Zakonczone',
    });

    const events = await api.get('/api/tasks/closure-events', { dedupe: false });
    expect(events.data.events['101'][0]).toMatchObject({
      task_id: 101,
      action: 'clean_close',
    });
  });

  it('serves attendance mocks with the same-origin /api prefix', async () => {
    const list = await api.get('/api/ekipy/attendance?date=2026-05-25');

    expect(list.status).toBe(200);
    expect(list.data.date).toBe('2026-05-25');
    expect(list.data.summary.total).toBeGreaterThan(0);
    expect(list.data.items[0]).toMatchObject({ dateYmd: '2026-05-25', present: true });

    const saved = await api.put('/api/ekipy/5/attendance', {
      dateYmd: '2026-05-25',
      present: false,
      note: 'Auto w serwisie',
    });

    expect(saved.status).toBe(200);
    expect(saved.data.item).toMatchObject({
      teamId: '5',
      dateYmd: '2026-05-25',
      present: false,
      note: 'Auto w serwisie',
    });
  });

  it('persists task PUT mocks across list and detail reads', async () => {
    const saved = await api.put('/api/tasks/101', {
      klient_nazwa: 'Anna po korekcie',
      status: 'Do_Zatwierdzenia',
      wartosc_planowana: 4321,
    });

    expect(saved.status).toBe(200);
    expect(saved.data).toMatchObject({
      id: 101,
      klient_nazwa: 'Anna po korekcie',
      status: 'Do_Zatwierdzenia',
      wartosc_planowana: 4321,
    });

    const detail = await api.get('/api/tasks/101', { dedupe: false });
    expect(detail.data).toMatchObject({
      id: 101,
      klient_nazwa: 'Anna po korekcie',
      status: 'Do_Zatwierdzenia',
    });

    const list = await api.get('/api/tasks/wszystkie', { dedupe: false });
    expect(list.data.find((task) => task.id === 101)).toMatchObject({
      klient_nazwa: 'Anna po korekcie',
      status: 'Do_Zatwierdzenia',
      wartosc_planowana: 4321,
    });
  });

  it('resets task override mocks when test storage is cleared', async () => {
    await api.put('/api/tasks/101', {
      klient_nazwa: 'Tymczasowa zmiana demo',
      status: 'Do_Zatwierdzenia',
    });

    localStorage.clear();
    localStorage.setItem('arbor-test-mode', 'true');

    const list = await api.get('/api/tasks/wszystkie', { dedupe: false });
    expect(list.data.find((task) => task.id === 101)).toMatchObject({
      klient_nazwa: 'Anna Kowalska',
      status: 'Nowe',
    });
  });

  it('serves task details from the same mock row as the task list', async () => {
    const list = await api.get('/api/tasks/wszystkie', { dedupe: false });
    const row = list.data.find((task) => task.id === 101);

    const detail = await api.get('/api/tasks/101', { dedupe: false });

    expect(detail.data).toMatchObject({
      id: row.id,
      klient_nazwa: row.klient_nazwa,
      status: row.status,
      data_planowana: row.data_planowana,
      ekipa_id: row.ekipa_id,
      ekipa_nazwa: '',
    });
  });

  it('serves the manager cockpit mock from task and team fixtures', async () => {
    const response = await api.get('/api/ops/kierownik-today?date=2026-05-25', { dedupe: false });

    expect(response.status).toBe(200);
    expect(response.data.summary.tasks_total).toBeGreaterThan(0);
    expect(response.data.summary.open).toBeGreaterThan(0);
    expect(response.data.blockers.length).toBeGreaterThan(0);
    expect(response.data.tasks[0]).toEqual(expect.objectContaining({
      id: expect.any(Number),
      action_path: expect.stringMatching(/^\/zlecenia\/\d+/),
    }));
  });

  it('limits blocker previews in mock action recommendations to recommendation-specific blockers', async () => {
    const response = await api.get('/api/ops/action-recommendations?date=2026-05-25', { dedupe: false });

    expect(response.status).toBe(200);
    const byId = Object.fromEntries(response.data.recommendations.map((item) => [item.id, item]));

    if (byId.fix_dispatch_blockers) {
      expect(byId.fix_dispatch_blockers.task_preview[0]).toEqual(
        expect.objectContaining({
          issue_key: null,
          issue_label: null,
        })
      );
      expect(byId.fix_dispatch_blockers.task_preview[0].blockers.every((key) => ['team', 'gps'].includes(key))).toBe(true);
    }

    if (byId.fix_contact_blockers) {
      expect(byId.fix_contact_blockers.task_preview[0]).toEqual(
        expect.objectContaining({
          issue_key: null,
          issue_label: null,
        })
      );
      expect(byId.fix_contact_blockers.task_preview[0].blockers.every((key) => ['phone', 'address'].includes(key))).toBe(true);
    }

    if (byId.resolve_open_issues) {
      expect(byId.resolve_open_issues.task_preview[0]).toEqual(
        expect.objectContaining({
          issue_key: null,
          issue_label: null,
          blockers: ['issue'],
        })
      );
    }
  });

  it('serves dispatch plan mocks for the local auto-dispatch demo', async () => {
    const preview = await api.post('/api/dispatch/plan', {
      date: '2026-05-25',
      oddzial_id: 1,
    });

    expect(preview.status).toBe(200);
    expect(preview.data.date).toBe('2026-05-25');
    expect(preview.data.routes[0]).toMatchObject({
      team_id: expect.any(Number),
      team_name: expect.any(String),
      stops: expect.any(Array),
    });
    expect(preview.data.routes[0].stops.length).toBeGreaterThan(0);
    expect(preview.data.stats).toMatchObject({
      coverage_pct: 100,
      tasks_assigned: preview.data.routes[0].stops.length,
      teams_used: 1,
      tasks_unassigned: 0,
    });

    const saved = await api.post('/api/dispatch/plan/save', {
      date: '2026-05-25',
      oddzial_id: 1,
    });

    expect(saved.data).toMatchObject({
      id: expect.any(Number),
      status: 'draft',
    });

    const applied = await api.post(`/api/dispatch/apply/${saved.data.id}`);
    expect(applied.data).toMatchObject({
      id: saved.data.id,
      status: 'applied',
    });
  });

  it('keeps the demo critical path wired from Zadarma and Kommo to dispatch, settlement and BI', async () => {
    const taskId = 103;

    const intake = await api.post('/api/telephony/calls', {
      oddzial_id: 3,
      phone: '+48500999888',
      call_type: 'inbound',
      status: 'answered',
      duration_sec: 184,
      task_id: taskId,
      lead_name: 'Osiedle Lesne Tarasy',
      provider: 'Zadarma',
    });
    expect(intake.status).toBe(201);
    expect(intake.data).toMatchObject({
      task_id: taskId,
      provider: 'Zadarma',
    });

    const beforeKommo = await api.get(`/api/tasks/${taskId}/kommo-payload`, { dedupe: false });
    expect(beforeKommo.data).toMatchObject({
      event: 'task.sync',
      provider: 'kommo',
      telephony: {
        provider: 'Zadarma',
        phone_only_flow: true,
      },
      task: {
        id: taskId,
        klient_telefon: '+48500999888',
      },
    });

    const savedPlan = await api.post('/api/dispatch/plan/save', {
      date: '2026-05-30',
      oddzial_id: 3,
    });
    expect(savedPlan.data.routes[0].stops.map((stop) => stop.task_id)).toContain(taskId);

    const appliedPlan = await api.post(`/api/dispatch/apply/${savedPlan.data.id}`);
    expect(appliedPlan.data).toMatchObject({ status: 'applied' });

    const start = await api.post(`/api/tasks/${taskId}/start`, {
      lat: 50.06143,
      lng: 19.93658,
    });
    expect(start.data).toMatchObject({
      work_log_id: expect.any(Number),
      task: {
        id: taskId,
        status: 'W_Realizacji',
        active_work_count: 1,
      },
    });

    const finish = await api.post(`/api/tasks/${taskId}/finish`, {
      lat: 50.062,
      lng: 19.937,
      notatki: 'Demo finish',
    });
    expect(finish.data).toMatchObject({
      wartosc_netto_do_rozliczenia: 2800,
      task: {
        id: taskId,
        status: 'Zakonczone',
      },
    });

    const settlement = await api.post(`/api/rozliczenia/zadanie/${taskId}`, {
      wartosc_brutto: 3024,
      vat_stawka: 8,
      koszt_pomocnikow: 200,
      procent_brygadzisty: 15,
    });
    expect(settlement.data).toMatchObject({
      task_id: taskId,
      wartosc_brutto: 3024,
      vat_stawka: 8,
      wartosc_netto: 2800,
      koszt_pomocnikow: 200,
    });
    expect(settlement.data.wynagrodzenie_brygadzisty).toBeCloseTo(390, 2);

    const afterKommo = await api.get(`/api/tasks/${taskId}/kommo-payload`, { dedupe: false });
    expect(afterKommo.data.task).toMatchObject({
      id: taskId,
      status: 'Zakonczone',
      wartosc_netto_do_rozliczenia: 2800,
      settlement: {
        gross: 3024,
        net: 2800,
        helper_cost: 200,
        crew_lead_pay: 390,
      },
      financials: {
        revenue_net: 2800,
        total_known_cost: 590,
        gross_margin: 2210,
        margin_pct: 78.9,
      },
    });

    const overview = await api.get('/api/bi/overview?days=30', { dedupe: false });
    expect(overview.data).toMatchObject({
      tasks_done: expect.any(Number),
      revenue_actual: expect.any(Number),
      gross_margin: expect.any(Number),
      margin_pct: expect.any(Number),
      zadarma_calls: 1,
      kommo_sync_errors: 0,
    });
    expect(overview.data.tasks_done).toBeGreaterThanOrEqual(1);
    expect(overview.data.revenue_actual).toBeGreaterThanOrEqual(2800);

    const drill = await api.get('/api/bi/drill?dim=task&id=103', { dedupe: false });
    expect(drill.data.find((task) => task.id === taskId)).toMatchObject({
      status: 'Zakonczone',
      financials: {
        revenue_net: 2800,
        margin_pct: 78.9,
      },
    });
    expect(drill.data.find((task) => task.id === taskId).financials.cost_sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'helper_cost', status: 'ok' }),
        expect.objectContaining({ key: 'crew_lead_pay', status: 'ok' }),
        expect.objectContaining({ key: 'operational_cost', source: 'demo_finish' }),
      ])
    );

    const kommoDiagnostics = await api.get('/api/tasks/kommo-sync/diagnostics', { dedupe: false });
    expect(kommoDiagnostics.data.summary).toMatchObject({
      outbound_ok: expect.any(Number),
      outbound_pending: expect.any(Number),
      inbound_ok: 1,
      inbound_conflicts: 0,
    });
    expect(kommoDiagnostics.data.queue[0]).toEqual(expect.objectContaining({
      task_id: expect.any(Number),
      status: expect.stringMatching(/pending|retry|dead_letter/),
    }));

    const recommendations = await api.get('/api/ops/action-recommendations?date=2026-05-29&oddzial_id=2', { dedupe: false });
    expect(recommendations.data.summary.actionable).toBeGreaterThan(0);
    expect(recommendations.data.recommendations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: expect.stringMatching(/set_missing_duration|fix_dispatch_blockers/),
          task_preview: expect.any(Array),
          target_path: expect.stringMatching(/^\/zlecenia|^\/kierownik|^\/mapa-live/),
        }),
      ])
    );

    const appliedRecommendation = await api.post('/api/ops/action-recommendations/set_missing_duration/apply', {
      date: '2026-05-29',
      oddzial_id: 2,
      action_kind: 'set_duration_batch',
      task_ids: [102],
      suggested_minutes: 90,
      title: 'Demo: uzupelnij czas planu',
    });
    expect(appliedRecommendation.data).toMatchObject({
      recommendation_id: 'set_missing_duration',
      action_kind: 'set_duration_batch',
      updated_tasks: [expect.objectContaining({
        id: 102,
        czas_obslugi_min: 90,
      })],
      feedback_event: expect.objectContaining({
        action_type: 'recommendation_feedback',
      }),
    });

    const dispatchPreflight = await api.post('/api/ops/action-recommendations/fix_dispatch_blockers/apply', {
      date: '2026-05-29',
      oddzial_id: 2,
      action_kind: 'fix_dispatch_blockers',
      task_ids: [102],
      title: 'Demo: napraw blokady dispatchera',
    });
    expect(dispatchPreflight.data).toMatchObject({
      recommendation_id: 'fix_dispatch_blockers',
      action_kind: 'fix_dispatch_blockers',
      dispatch_preflight: {
        checked: 1,
        fixed_team_count: 1,
        gps_checklist_count: 1,
      },
      feedback_event: expect.objectContaining({
        action_type: 'recommendation_feedback',
      }),
    });
    expect(dispatchPreflight.data.dispatch_preflight.still_blocked[0]).toEqual(
      expect.objectContaining({ task_id: 102, blockers: ['gps'] })
    );
  });

  it('persists route brief confirmation mocks across status reads', async () => {
    const sent = await api.post('/api/dispatch/route-brief/send', {
      date: '2026-05-25',
      oddzial_id: 2,
      team_id: 5,
      team_name: 'Ekipa A',
      task_ids: [101],
      brief: 'Odprawa ekipy - Ekipa A',
    });

    expect(sent.status).toBe(200);
    expect(sent.data.status).toMatchObject({
      team_id: 5,
      sent_to: 1,
      confirmed: 0,
      pending: 1,
    });

    const status = await api.get('/api/dispatch/route-brief/status', {
      params: { date: '2026-05-25', team_ids: '5' },
      dedupe: false,
    });

    expect(status.data.summary).toMatchObject({
      teams_sent: 1,
      sent_to: 1,
      confirmed: 0,
      pending: 1,
    });
    expect(status.data.items[0]).toMatchObject({
      team_id: 5,
      team_name: 'Ekipa A',
      sent_to: 1,
      pending: 1,
    });

    const reminder = await api.post(`/api/dispatch/route-brief/${sent.data.brief_id}/remind`);

    expect(reminder.data).toMatchObject({
      message: 'Przypomnienie wyslane',
      brief_id: sent.data.brief_id,
      team_id: 5,
      reminded: 1,
    });
    expect(reminder.data.recipients[0]).toMatchObject({
      status: 'Nowe',
      reminder_count: 1,
    });

    const afterReminder = await api.get('/api/dispatch/route-brief/status', {
      params: { date: '2026-05-25', team_ids: '5' },
      dedupe: false,
    });

    expect(afterReminder.data.items[0].recipients[0]).toMatchObject({
      status: 'Nowe',
      reminder_count: 1,
    });
  });

  it('serves mock photos consistently with task photo counters', async () => {
    const emptyPhotos = await api.get('/api/tasks/101/zdjecia', { dedupe: false });
    expect(emptyPhotos.data).toEqual([]);

    const filledPhotos = await api.get('/api/tasks/103/zdjecia', { dedupe: false });
    expect(filledPhotos.data).toHaveLength(5);
    expect(filledPhotos.data.map((photo) => photo.typ)).toEqual(['wycena', 'wycena', 'szkic', 'szkic', 'dojazd']);
  });

  it('persists uploaded task photos and updates task photo counters', async () => {
    const formData = new FormData();
    formData.append('zdjecie', new Blob(['demo'], { type: 'image/jpeg' }), 'wycena.jpg');
    formData.append('typ', 'Wycena');
    formData.append('opis', 'Widok drzewa przed wycena');
    formData.append('tagi', 'wycena,teren');

    const saved = await api.post('/api/tasks/101/zdjecia', formData);

    expect(saved.status).toBe(201);
    expect(saved.data).toMatchObject({
      task_id: 101,
      typ: 'wycena',
      opis: 'Widok drzewa przed wycena',
      tagi: ['wycena', 'teren'],
    });

    const photos = await api.get('/api/tasks/101/zdjecia', { dedupe: false });
    expect(photos.data).toHaveLength(1);
    expect(photos.data[0]).toMatchObject({ id: saved.data.id, typ: 'wycena' });

    const detail = await api.get('/api/tasks/101', { dedupe: false });
    expect(detail.data).toMatchObject({
      id: 101,
      photo_total: 1,
      photo_wycena: 1,
      photo_szkic: 0,
      photo_dojazd: 0,
    });

    const list = await api.get('/api/tasks/wszystkie', { dedupe: false });
    expect(list.data.find((task) => task.id === 101)).toMatchObject({
      photo_total: 1,
      photo_wycena: 1,
    });

    await api.delete(`/api/tasks/101/zdjecia/${saved.data.id}`);

    const emptyAgain = await api.get('/api/tasks/101/zdjecia', { dedupe: false });
    expect(emptyAgain.data).toEqual([]);

    const detailAfterDelete = await api.get('/api/tasks/101', { dedupe: false });
    expect(detailAfterDelete.data).toMatchObject({
      photo_total: 0,
      photo_wycena: 0,
    });
  });

  it('persists office plan mocks and marks the task as planned', async () => {
    const saved = await api.put('/api/tasks/101/office-plan', {
      data_planowana: '2026-05-28',
      godzina_rozpoczecia: '10:30',
      czas_planowany_godziny: '3',
      ekipa_id: '5',
      sprzet_notatka: 'Rębak i zestaw arborystyczny',
    });

    expect(saved.status).toBe(200);
    expect(saved.data).toMatchObject({
      id: 101,
      status: 'Zaplanowane',
      data_planowana: '2026-05-28',
      godzina_rozpoczecia: '10:30',
      czas_planowany_godziny: '3',
      ekipa_id: '5',
      ekipa_nazwa: 'Ekipa A',
      sprzet_notatka: 'Rębak i zestaw arborystyczny',
    });

    const detail = await api.get('/api/tasks/101', { dedupe: false });
    expect(detail.data).toMatchObject({
      status: 'Zaplanowane',
      ekipa_id: '5',
      ekipa_nazwa: 'Ekipa A',
    });

    const list = await api.get('/api/tasks/wszystkie', { dedupe: false });
    expect(list.data.find((task) => task.id === 101)).toMatchObject({
      status: 'Zaplanowane',
      ekipa_id: '5',
      ekipa_nazwa: 'Ekipa A',
    });
  });

  it('serves task status PUT mocks and updates derived stats', async () => {
    const saved = await api.put('/api/tasks/1/status', { status: 'Zakonczone' });

    expect(saved.status).toBe(200);
    expect(saved.data).toMatchObject({ id: 1, status: 'Zakonczone' });

    const stats = await api.get('/api/tasks/stats', { dedupe: false });
    expect(stats.data.zakonczone).toBeGreaterThanOrEqual(1);

    const list = await api.get('/api/tasks/wszystkie', { dedupe: false });
    expect(list.data.find((task) => task.id === 1)).toMatchObject({ status: 'Zakonczone' });
  });

  it('adds crew check-in state when a task starts work in test mode', async () => {
    const saved = await api.put('/api/tasks/101/status', { status: 'W_Realizacji' });

    expect(saved.status).toBe(200);
    expect(saved.data).toMatchObject({
      id: 101,
      status: 'W_Realizacji',
      active_work_count: 1,
      work_logs_total: 1,
    });
    expect(saved.data.last_checkin_at).toEqual(expect.any(String));
    expect(saved.data.active_work_started_at).toEqual(expect.any(String));

    const detail = await api.get('/api/tasks/101', { dedupe: false });
    expect(detail.data).toMatchObject({
      status: 'W_Realizacji',
      active_work_count: 1,
      last_checkin_at: expect.any(String),
      active_work_started_at: expect.any(String),
    });
  });

  it('normalizes stale in-progress mock tasks without check-in fields', async () => {
    localStorage.setItem('arbor-test-mode-task-overrides', JSON.stringify({
      101: { id: 101, status: 'W_Realizacji', active_work_count: 0 },
    }));

    const detail = await api.get('/api/tasks/101', { dedupe: false });

    expect(detail.data).toMatchObject({
      status: 'W_Realizacji',
      active_work_count: 1,
      work_logs_total: 1,
      last_checkin_at: expect.any(String),
      active_work_started_at: expect.any(String),
    });
  });
});
