const { buildKommoTaskPayload } = require('../src/services/kommo');

describe('Kommo task payload service', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV, PUBLIC_BASE_URL: 'https://arbor.example.com' };
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  test('includes operational package for outbound task sync', () => {
    const payload = buildKommoTaskPayload({
      id: 55,
      status: 'Zakonczone',
      klient_nazwa: 'Klient Test',
      wartosc_planowana: 2500,
      work_logs_count: 1,
      work_total_minutes: 125,
      work_started_at: '2026-05-28T08:00:00.000Z',
      work_finished_at: '2026-05-28T10:05:00.000Z',
      work_logs: JSON.stringify([
        {
          id: 10,
          user_id: 7,
          start_time: '2026-05-28T08:00:00.000Z',
          end_time: '2026-05-28T10:05:00.000Z',
          minutes: 125,
          start_lat: 50.1,
          start_lng: 19.9,
        },
      ]),
      photos_count: 2,
      photo_counts_by_type: JSON.stringify({ przed: 1, po: 1 }),
      photos: JSON.stringify([
        { id: 1, typ: 'przed', url: '/uploads/tasks/przed.jpg', opis: 'Przed' },
        { id: 2, typ: 'po', url: 'https://cdn.example.com/po.jpg', opis: 'Po' },
      ]),
      documents_count: 1,
      documents: JSON.stringify([
        { id: 3, nazwa: 'plik.pdf', kategoria: 'kommo', sciezka: '/uploads/kommo/task-55/plik.pdf', remote_url: 'https://kommo.example/plik.pdf' },
      ]),
    });

    expect(payload.task.status_url).toBe('https://arbor.example.com/#/zlecenia/55');
    expect(payload.task.work_time).toMatchObject({
      logs_count: 1,
      total_minutes: 125,
      started_at: '2026-05-28T08:00:00.000Z',
      finished_at: '2026-05-28T10:05:00.000Z',
    });
    expect(payload.task.photos).toMatchObject({
      count: 2,
      by_type: { przed: 1, po: 1 },
    });
    expect(payload.task.photos.items[0].url).toBe('https://arbor.example.com/uploads/tasks/przed.jpg');
    expect(payload.task.photos.items[1].url).toBe('https://cdn.example.com/po.jpg');
    expect(payload.task.documents.items[0]).toMatchObject({
      nazwa: 'plik.pdf',
      url: 'https://arbor.example.com/uploads/kommo/task-55/plik.pdf',
      remote_url: 'https://kommo.example/plik.pdf',
    });
  });
});
