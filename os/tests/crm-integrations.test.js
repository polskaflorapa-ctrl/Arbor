const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  connect: jest.fn(),
}));

const pool = require('../src/config/database');
const crmRoutes = require('../src/routes/crm');
const crmWebhooksRoutes = require('../src/routes/crmWebhooks');
const { createTestApp } = require('./helpers/create-test-app');
const { env } = require('../src/config/env');

const crmApp = createTestApp('/api/crm', crmRoutes);
const webhookApp = createTestApp('/api/webhooks/crm', crmWebhooksRoutes);

const token = (payload = {}) => jwt.sign({
  id: 9,
  rola: 'Kierownik',
  oddzial_id: 7,
  ...payload,
}, env.JWT_SECRET);

describe('CRM integrations', () => {
  beforeEach(() => {
    pool.query.mockReset();
    pool.query.mockImplementation(async (sql, params = []) => {
      const text = String(sql);
      if (text.includes('CREATE TABLE') || text.includes('CREATE INDEX')) return { rows: [], rowCount: 0 };
      if (text.includes('INSERT INTO crm_integration_apps')) {
        return {
          rows: [{
            id: 41,
            oddzial_id: params[0],
            name: params[1],
            type: params[2],
            token: params[3],
            active: true,
            config: JSON.parse(params[4]),
            created_by: params[5],
            updated_by: params[7],
          }],
          rowCount: 1,
        };
      }
      if (text.includes('SELECT * FROM crm_integration_apps') && text.includes('ORDER BY active')) {
        return {
          rows: [{ id: 41, oddzial_id: 7, name: 'Landing widget', type: 'widget', token: 'tok_1', active: true, config: {} }],
          rowCount: 1,
        };
      }
      if (text.includes('SELECT * FROM crm_integration_apps WHERE token')) {
        return { rows: [{ id: 41, oddzial_id: 7, name: 'Landing widget', token: params[0], active: true }], rowCount: 1 };
      }
      if (text.includes('INSERT INTO crm_leads')) return { rows: [{ id: 101 }], rowCount: 1 };
      if (text.includes('INSERT INTO crm_lead_messages')) return { rows: [], rowCount: 1 };
      if (text.includes('UPDATE crm_leads SET updated_at')) return { rows: [], rowCount: 1 };
      if (text.includes('INSERT INTO crm_integration_events')) {
        return { rows: [{ id: 201, app_id: params[0], event_type: params[1], status: params[2], lead_id: params[3] }], rowCount: 1 };
      }
      if (text.includes('FROM crm_integration_events e')) {
        return {
          rows: [{ id: 201, app_id: 41, app_name: 'Landing widget', oddzial_id: 7, event_type: 'lead.created', status: 'ok', lead_id: 101 }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });
  });

  it('creates CRM integration apps and returns the token once', async () => {
    const res = await request(crmApp)
      .post('/api/crm/integrations/apps')
      .set('Authorization', `Bearer ${token()}`)
      .send({ oddzial_id: 7, name: 'Landing widget', type: 'widget', config: { source: 'landing' } });

    expect(res.status).toBe(201);
    expect(res.body).toEqual(expect.objectContaining({
      id: 41,
      oddzial_id: 7,
      name: 'Landing widget',
      type: 'widget',
      active: true,
      token: expect.any(String),
      webhook_path: expect.stringContaining('/api/webhooks/crm/'),
    }));
  });

  it('lists scoped CRM integration apps without exposing tokens', async () => {
    const res = await request(crmApp)
      .get('/api/crm/integrations/apps')
      .set('Authorization', `Bearer ${token()}`);

    expect(res.status).toBe(200);
    expect(res.body[0]).toEqual(expect.objectContaining({ id: 41, webhook_path: '/api/webhooks/crm/tok_1' }));
    expect(res.body[0]).not.toHaveProperty('token');
  });

  it('ingests public webhook payloads into a lead and message', async () => {
    const res = await request(webhookApp)
      .post('/api/webhooks/crm/tok_1')
      .send({
        event_type: 'lead.created',
        external_id: 'ext-1',
        title: 'Lead z widgetu',
        phone: '+48111222333',
        message: 'Prosze o kontakt',
        source: 'landing',
      });

    expect(res.status).toBe(202);
    expect(res.body).toEqual(expect.objectContaining({ ok: true, lead_id: 101 }));
    expect(pool.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO crm_leads'))).toBe(true);
    expect(pool.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO crm_lead_messages'))).toBe(true);
    expect(pool.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO crm_integration_events'))).toBe(true);
  });
});
