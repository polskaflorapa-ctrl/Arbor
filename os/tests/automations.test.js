const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
}));

jest.mock('../src/services/webhook', () => ({
  dispatchWebhook: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/services/audit', () => ({
  logAudit: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/services/opsDigest', () => ({
  buildOperationalDigest: jest.fn(),
  getDigestRunHistory: jest.fn(),
  listDigestSettings: jest.fn(),
  runOperationalDigest: jest.fn(),
  saveDigestSettings: jest.fn(),
}));

const pool = require('../src/config/database');
const automationsRoutes = require('../src/routes/automations');
const {
  buildOperationalDigest,
  getDigestRunHistory,
  listDigestSettings,
  runOperationalDigest,
  saveDigestSettings,
} = require('../src/services/opsDigest');
const { createTestApp } = require('./helpers/create-test-app');
const { env } = require('../src/config/env');

describe('Automations routes', () => {
  const app = createTestApp('/api/automations', automationsRoutes);
  const token = (payload) =>
    jwt.sign({ id: 10, rola: 'Administrator', oddzial_id: null, ...payload }, env.JWT_SECRET, {
      expiresIn: '1h',
    });

  beforeEach(() => {
    jest.clearAllMocks();
    pool.query.mockReset();
  });

  it('previews operational digest with Kierownik branch scope', async () => {
    buildOperationalDigest.mockResolvedValue({
      date: '2026-05-25',
      branch_id: 7,
      summary: { total_alerts: 1 },
      alerts: [{ type: 'tasks_overdue' }],
    });

    const res = await request(app)
      .get('/api/automations/daily-digest/preview?oddzial_id=999&date=2026-05-25')
      .set('Authorization', `Bearer ${token({ rola: 'Kierownik', oddzial_id: 7 })}`);

    expect(res.status).toBe(200);
    expect(buildOperationalDigest).toHaveBeenCalledWith(
      pool,
      expect.objectContaining({ branchId: 7, date: '2026-05-25' })
    );
    expect(res.body.summary.total_alerts).toBe(1);
  });

  it('runs daily reminders and operational digest', async () => {
    pool.query
      .mockResolvedValueOnce({
        rows: [{ id: 5, klient_nazwa: 'Test', data_planowana: '2026-05-20', status: 'Nowe' }],
      })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });
    runOperationalDigest.mockResolvedValue({
      date: '2026-05-25',
      global: { summary: { total_alerts: 0 }, delivery: { notifications_created: 1 } },
      branches: [],
    });

    const res = await request(app)
      .post('/api/automations/run-daily')
      .set('Authorization', `Bearer ${token({ rola: 'Administrator' })}`)
      .send({ date: '2026-05-25', horizon_days: 2 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.reminders).toEqual({ scanned: 1, remindersCreated: 1 });
    expect(runOperationalDigest).toHaveBeenCalledWith(
      pool,
      expect.objectContaining({ date: '2026-05-25', horizonDays: 2, actorUserId: 10, triggerType: 'manual' })
    );
  });

  it('returns branch-scoped operational digest run history', async () => {
    getDigestRunHistory.mockResolvedValue({
      total: 1,
      items: [{ id: 100, scope: 'branch', branch_id: 7, emails_sent: 1 }],
    });

    const res = await request(app)
      .get('/api/automations/daily-digest/history?oddzial_id=999&scope=branch&limit=10')
      .set('Authorization', `Bearer ${token({ rola: 'Kierownik', oddzial_id: 7 })}`);

    expect(res.status).toBe(200);
    expect(getDigestRunHistory).toHaveBeenCalledWith(
      pool,
      expect.objectContaining({ branchId: 7, scope: 'branch', limit: '10' })
    );
    expect(res.body.total).toBe(1);
  });

  it('reads and saves operational digest settings', async () => {
    listDigestSettings.mockResolvedValue([{ scope_key: 'global', enabled: true, send_time: '06:00' }]);
    saveDigestSettings.mockResolvedValue({
      scope_key: 'branch:7',
      scope: 'branch',
      branch_id: 7,
      enabled: true,
      recipient_user_ids: [10],
      extra_emails: ['boss@example.com'],
    });

    const getRes = await request(app)
      .get('/api/automations/daily-digest/settings')
      .set('Authorization', `Bearer ${token({ rola: 'Dyrektor' })}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.settings[0].scope_key).toBe('global');

    const putRes = await request(app)
      .put('/api/automations/daily-digest/settings')
      .set('Authorization', `Bearer ${token({ rola: 'Dyrektor' })}`)
      .send({
        branch_id: 7,
        enabled: true,
        recipient_user_ids: [10],
        extra_emails: ['boss@example.com'],
      });

    expect(putRes.status).toBe(200);
    expect(saveDigestSettings).toHaveBeenCalledWith(
      pool,
      expect.objectContaining({ branch_id: 7, updated_by: 10 })
    );
  });

  it('runs operational digest from cron secret and respects enabled settings', async () => {
    process.env.OPS_CRON_SECRET = 'cron-secret';
    runOperationalDigest.mockResolvedValue({
      date: '2026-05-25',
      global: { summary: { total_alerts: 1 } },
      branches: [{ branch_id: 7, summary: { total_alerts: 0 } }],
    });

    const res = await request(app)
      .get('/api/automations/daily-digest/tick?secret=cron-secret&date=2026-05-25');

    expect(res.status).toBe(200);
    expect(runOperationalDigest).toHaveBeenCalledWith(
      pool,
      expect.objectContaining({ date: '2026-05-25', triggerType: 'cron', respectEnabled: true })
    );
  });
});
