const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  connect: jest.fn(),
}));

const pool = require('../src/config/database');
const crmRoutes = require('../src/routes/crm');
const { createTestApp } = require('./helpers/create-test-app');
const { env } = require('../src/config/env');

const app = createTestApp('/api/crm', crmRoutes);

const token = (payload = {}) => jwt.sign({
  id: 9,
  rola: 'Kierownik',
  oddzial_id: 7,
  ...payload,
}, env.JWT_SECRET);

describe('CRM workflow automations', () => {
  beforeEach(() => {
    pool.query.mockReset();
    pool.query.mockImplementation(async (sql, params = []) => {
      const text = String(sql);
      if (text.includes('CREATE TABLE') || text.includes('CREATE INDEX')) return { rows: [], rowCount: 0 };
      if (text.includes('INSERT INTO crm_workflow_rules')) {
        return {
          rows: [{
            id: 31,
            oddzial_id: params[0],
            name: params[1],
            trigger_type: params[2],
            trigger_config: JSON.parse(params[3]),
            action_type: params[4],
            action_config: JSON.parse(params[5]),
            active: params[6],
            created_by: params[7],
            updated_by: params[9],
          }],
          rowCount: 1,
        };
      }
      if (text.includes('SELECT * FROM crm_workflow_rules') && text.includes('ORDER BY active')) {
        return {
          rows: [{
            id: 31,
            oddzial_id: 7,
            name: 'Brak odpowiedzi 24h',
            trigger_type: 'no_response_after_hours',
            trigger_config: { hours: 24 },
            action_type: 'create_followup_task',
            action_config: { due_in_hours: 2 },
            active: true,
          }],
          rowCount: 1,
        };
      }
      if (text.includes('SELECT * FROM crm_workflow_rules WHERE') && text.includes('ORDER BY id ASC')) {
        return {
          rows: [{
            id: 31,
            oddzial_id: 7,
            name: 'Brak odpowiedzi 24h',
            trigger_type: 'no_response_after_hours',
            trigger_config: { hours: 24 },
            action_type: 'create_followup_task',
            action_config: { due_in_hours: 2, text: 'Oddzwon do klienta' },
            active: true,
          }],
          rowCount: 1,
        };
      }
      if (text.includes('WITH last_outbound AS')) {
        return {
          rows: [{
            id: 51,
            oddzial_id: 7,
            title: 'Lead bez odpowiedzi',
            stage: 'Lead',
            last_outbound_at: '2026-05-27T08:00:00.000Z',
          }],
          rowCount: 1,
        };
      }
      if (text.includes('INSERT INTO crm_lead_activities')) return { rows: [], rowCount: 1 };
      if (text.includes('UPDATE crm_leads SET next_action_at')) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
  });

  it('creates a no-response follow-up workflow rule', async () => {
    const res = await request(app)
      .post('/api/crm/workflows')
      .set('Authorization', `Bearer ${token()}`)
      .send({
        oddzial_id: 7,
        name: 'Brak odpowiedzi 24h',
        trigger_type: 'no_response_after_hours',
        trigger_config: { hours: 24 },
        action_type: 'create_followup_task',
        action_config: { due_in_hours: 2 },
      });

    expect(res.status).toBe(201);
    expect(res.body).toEqual(expect.objectContaining({
      id: 31,
      oddzial_id: 7,
      trigger_type: 'no_response_after_hours',
      action_type: 'create_followup_task',
      active: true,
    }));
  });

  it('lists workflow rules scoped to user branch', async () => {
    const res = await request(app)
      .get('/api/crm/workflows')
      .set('Authorization', `Bearer ${token()}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    const selectCall = pool.query.mock.calls.find(([sql]) => String(sql).includes('ORDER BY active'));
    expect(selectCall[0]).toContain('oddzial_id = $1');
    expect(selectCall[1]).toEqual([7]);
  });

  it('runs no-response workflows and creates follow-up tasks', async () => {
    const res = await request(app)
      .post('/api/crm/workflows/run')
      .set('Authorization', `Bearer ${token()}`)
      .send({ oddzial_id: 7 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({ actions_count: 1 }));
    const insertActivity = pool.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO crm_lead_activities'));
    expect(insertActivity[1][0]).toBe(51);
    expect(insertActivity[1][1]).toContain('[workflow:31]');
    expect(pool.query.mock.calls.some(([sql]) => String(sql).includes('UPDATE crm_leads SET next_action_at'))).toBe(true);
  });
});
