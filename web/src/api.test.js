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
});
