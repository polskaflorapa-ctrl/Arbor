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

jest.mock('../src/services/teamLeagueTelegram', () => ({
  buildWeeklyTeamLeague: jest.fn(),
  publishWeeklyTeamLeague: jest.fn(),
}));

jest.mock('../src/services/smsGateway', () => ({
  sendSmsGateway: jest.fn(),
}));

jest.mock('../src/services/crmInbox', () => ({
  appendCrmLeadMessage: jest.fn(),
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
const {
  buildWeeklyTeamLeague,
  publishWeeklyTeamLeague,
} = require('../src/services/teamLeagueTelegram');
const { sendSmsGateway } = require('../src/services/smsGateway');
const { appendCrmLeadMessage } = require('../src/services/crmInbox');
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
    sendSmsGateway.mockResolvedValue({ ok: true, provider: 'mock-sms', sid: 'SM-REMINDER-1' });
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

  it('previews branch-scoped voice agent inspection SMS reminders', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{
        id: 303,
        oddzial_id: 7,
        crm_lead_id: 101,
        ogledziny_id: 601,
        caller_phone: '+48500111222',
        customer_name: 'Jan Flora',
        inspection_address: 'ul. Lesna 4',
        city: 'Krakow',
        appointment_at: '2026-06-01T09:00:00.000Z',
        raw_payload: {},
      }],
    });

    const res = await request(app)
      .get('/api/automations/inspection-sms-reminders/preview?oddzial_id=999')
      .set('Authorization', `Bearer ${token({ rola: 'Kierownik', oddzial_id: 7 })}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 1, branch_id: 7 });
    expect(res.body.items[0]).toMatchObject({
      id: 303,
      oddzial_id: 7,
      caller_phone: '+48500111222',
    });
    expect(res.body.items[0].sms_body).toContain('przypominamy o jutrzejszych');
    expect(pool.query.mock.calls[0][0]).toContain("vai.status = 'active'");
    expect(pool.query.mock.calls[0][1]).toEqual([7]);
  });

  it('runs daily reminders and operational digest', async () => {
    pool.query
      .mockResolvedValueOnce({
        rows: [{ id: 5, klient_nazwa: 'Test', data_planowana: '2026-05-20', status: 'Nowe' }],
      })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
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
    expect(res.body.inspectionSmsReminders).toEqual({ scanned: 0, sent: 0, failed: [] });
    expect(res.body.telephonyRetests).toEqual({
      max_age_days: 14,
      branches_total: 0,
      recipients_total: 0,
      notifications_created: 0,
      duplicates_skipped: 0,
    });
    expect(runOperationalDigest).toHaveBeenCalledWith(
      pool,
      expect.objectContaining({ date: '2026-05-25', horizonDays: 2, actorUserId: 10, triggerType: 'manual' })
    );
  });

  it('sends voice agent inspection SMS reminders during daily automation', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{
          id: 303,
          oddzial_id: 2,
          crm_lead_id: 101,
          ogledziny_id: 601,
          caller_phone: '+48500111222',
          customer_name: 'Jan Flora',
          inspection_address: 'ul. Lesna 4',
          city: 'Krakow',
          appointment_at: '2026-06-01T09:00:00.000Z',
          raw_payload: {},
        }],
      })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    appendCrmLeadMessage.mockResolvedValue({ id: 777 });
    runOperationalDigest.mockResolvedValue({
      date: '2026-05-31',
      global: { summary: { total_alerts: 0 }, delivery: { notifications_created: 0 } },
      branches: [],
    });

    const res = await request(app)
      .post('/api/automations/run-daily')
      .set('Authorization', `Bearer ${token({ rola: 'Administrator' })}`)
      .send({ date: '2026-05-31' });

    expect(res.status).toBe(200);
    expect(res.body.inspectionSmsReminders).toEqual({ scanned: 1, sent: 1, failed: [] });
    expect(res.body.telephonyRetests).toEqual(expect.objectContaining({ branches_total: 0 }));
    expect(sendSmsGateway).toHaveBeenCalledWith(expect.objectContaining({
      to: '+48500111222',
      oddzialId: 2,
    }));
    expect(appendCrmLeadMessage).toHaveBeenCalledWith(expect.objectContaining({
      leadId: 101,
      channel: 'sms',
      direction: 'outbound',
      templateKey: 'polska_flora_ogledziny_reminder',
      metadata: expect.objectContaining({
        source: 'automation.inspection_sms_reminder',
        intake_id: 303,
        ogledziny_id: 601,
      }),
    }));
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
    pool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    runOperationalDigest.mockResolvedValue({
      date: '2026-05-25',
      global: { summary: { total_alerts: 1 } },
      branches: [{ branch_id: 7, summary: { total_alerts: 0 } }],
    });

    const res = await request(app)
      .get('/api/automations/daily-digest/tick?secret=cron-secret&date=2026-05-25');

    expect(res.status).toBe(200);
    expect(res.body.telephonyRetests).toEqual(expect.objectContaining({ branches_total: 0 }));
    expect(runOperationalDigest).toHaveBeenCalledWith(
      pool,
      expect.objectContaining({ date: '2026-05-25', triggerType: 'cron', respectEnabled: true })
    );
  });

  it('previews weekly team league with branch scope', async () => {
    buildWeeklyTeamLeague.mockResolvedValue({
      text: 'Liga brygad',
      ranking: { generated_at: '2026-05-31T10:00:00.000Z', periods: { week: { items: [] } } },
    });

    const res = await request(app)
      .get('/api/automations/team-league/preview?oddzial_id=999&as_of=2026-05-31')
      .set('Authorization', `Bearer ${token({ rola: 'Kierownik', oddzial_id: 7 })}`);

    expect(res.status).toBe(200);
    expect(res.body.text).toBe('Liga brygad');
    expect(buildWeeklyTeamLeague).toHaveBeenCalledWith(
      pool,
      expect.objectContaining({ rola: 'Kierownik', oddzial_id: 7 }),
      expect.objectContaining({ as_of: '2026-05-31', oddzial_id: 7 })
    );
  });

  it('sends weekly team league manually', async () => {
    publishWeeklyTeamLeague.mockResolvedValue({
      dryRun: false,
      text: 'Liga brygad',
      telegram: { ok: true, result: { message_id: 123 } },
      ranking: { generated_at: '2026-05-31T10:00:00.000Z' },
    });

    const res = await request(app)
      .post('/api/automations/team-league/send')
      .set('Authorization', `Bearer ${token({ rola: 'Administrator' })}`)
      .send({ as_of: '2026-05-31' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.telegram.ok).toBe(true);
    expect(publishWeeklyTeamLeague).toHaveBeenCalledWith(
      pool,
      expect.objectContaining({ rola: 'Administrator' }),
      expect.objectContaining({ as_of: '2026-05-31', dryRun: false })
    );
  });

  it('runs weekly team league from cron secret', async () => {
    process.env.OPS_CRON_SECRET = 'cron-secret';
    publishWeeklyTeamLeague.mockResolvedValue({
      dryRun: true,
      text: 'Liga brygad',
      telegram: null,
      ranking: {
        generated_at: '2026-05-31T10:00:00.000Z',
        as_of: '2026-05-31',
        periods: { week: { from: '2026-05-25', to: '2026-05-31', winner: null } },
      },
    });

    const res = await request(app)
      .get('/api/automations/team-league/tick?secret=cron-secret&as_of=2026-05-31&dry_run=1');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.dryRun).toBe(true);
    expect(publishWeeklyTeamLeague).toHaveBeenCalledWith(
      pool,
      expect.objectContaining({ rola: 'Administrator' }),
      expect.objectContaining({ as_of: '2026-05-31', dryRun: true })
    );
  });
});
