const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  connect: jest.fn(),
}));

jest.mock('../src/services/crmWorkflows', () => ({
  createWorkflowRule: jest.fn(),
  listWorkflowEventsForLead: jest.fn(),
  listWorkflowRules: jest.fn(),
  runWorkflowRules: jest.fn(),
}));

const pool = require('../src/config/database');
const crmRoutes = require('../src/routes/crm');
const { createTestApp } = require('./helpers/create-test-app');
const { env } = require('../src/config/env');

const app = createTestApp('/api/crm', crmRoutes);

const token = (payload = {}) => jwt.sign({
  id: 9,
  rola: 'Dyrektor',
  oddzial_id: 7,
  ...payload,
}, env.JWT_SECRET);

describe('CRM command center', () => {
  beforeEach(() => {
    pool.query.mockReset();
    pool.query.mockImplementation(async (sql) => {
      const text = String(sql);
      if (text.includes('WITH last_message AS')) {
        return {
          rows: [
            {
              id: 1,
              title: 'Duza wycinka przy domu',
              oddzial_id: 7,
              stage: 'Lead',
              source: 'telefon',
              value: 9000,
              phone: '+48500100200',
              email: null,
              owner_user_id: null,
              next_action_at: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
              owner_imie: null,
              owner_nazwisko: null,
              owner_login: null,
              last_direction: 'outbound',
              last_channel: 'phone',
              last_message_at: new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString(),
              open_tasks: 2,
              overdue_tasks: 1,
              phone_followup_tasks: 1,
              overdue_phone_followup_tasks: 1,
              next_phone_followup_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
              calls_30d: 1,
            },
            {
              id: 2,
              title: 'Male przyciecie',
              oddzial_id: 7,
              stage: 'OglÄ™dziny',
              source: 'formularz',
              value: 600,
              phone: '+48500100300',
              email: 'jan@example.test',
              owner_user_id: 22,
              next_action_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
              owner_imie: 'Anna',
              owner_nazwisko: 'CRM',
              owner_login: 'anna',
              last_direction: 'inbound',
              last_channel: 'sms',
              last_message_at: new Date().toISOString(),
              open_tasks: 1,
              overdue_tasks: 0,
              phone_followup_tasks: 0,
              overdue_phone_followup_tasks: 0,
              next_phone_followup_at: null,
              calls_30d: 0,
            },
          ],
        };
      }
      return { rows: [] };
    });
  });

  it('returns ranked priority leads with reasons and summary', async () => {
    const res = await request(app)
      .get('/api/crm/command-center?oddzial_id=7&limit=10')
      .set('Authorization', `Bearer ${token()}`);

    expect(res.status).toBe(200);
    expect(res.body.summary).toEqual(expect.objectContaining({
      total: 2,
      critical: 1,
      overdue: 1,
      unassigned: 1,
      phone_followups: 1,
      phone_followups_overdue: 1,
      value_at_risk: 9000,
    }));
    expect(res.body.priorities[0]).toEqual(expect.objectContaining({
      id: 1,
      priority: 'critical',
      next_best_action: expect.stringContaining('Przypisz'),
    }));
    expect(res.body.priorities[0].reasons).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'unassigned' }),
      expect.objectContaining({ key: 'overdue_tasks' }),
      expect.objectContaining({ key: 'phone_followup_overdue' }),
      expect.objectContaining({ key: 'high_value' }),
    ]));
    expect(pool.query.mock.calls[0][1]).toEqual([7, 40]);
  });

  it('limits command center size and keeps user branch scope for non-directors', async () => {
    const res = await request(app)
      .get('/api/crm/command-center?oddzial_id=99&limit=1')
      .set('Authorization', `Bearer ${token({ rola: 'Pracownik', oddzial_id: 7 })}`);

    expect(res.status).toBe(200);
    expect(pool.query.mock.calls[0][1]).toEqual([7, 4]);
    expect(res.body.priorities).toHaveLength(1);
  });
});
