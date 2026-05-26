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

  it('serves mock data when same-origin GET calls include the /api prefix', async () => {
    const response = await api.get('/api/notifications');

    expect(response.status).toBe(200);
    expect(response.data).toEqual({ notifications: [], unread_count: 0 });
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
});
