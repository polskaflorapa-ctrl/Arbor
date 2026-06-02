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
      if (text.includes('FROM crm_integration_apps a') && text.includes('ORDER BY a.active')) {
        return {
          rows: [{
            id: 41,
            oddzial_id: 7,
            name: 'Landing widget',
            type: 'widget',
            token: 'tok_1',
            active: true,
            config: {},
            event_count: 3,
            last_event_at: '2026-06-01T09:00:00.000Z',
            last_event_status: 'ok',
            last_event_type: 'message.received',
          }],
          rowCount: 1,
        };
      }
      if (text.includes('SELECT * FROM crm_integration_apps WHERE id = $1')) {
        return {
          rows: [{
            id: params[0],
            oddzial_id: 7,
            name: 'WhatsApp Krakow',
            type: 'webhook',
            token: 'tok_wa',
            active: true,
            config: { unified_inbox: true, channel: 'whatsapp' },
          }],
          rowCount: 1,
        };
      }
      if (text.includes('UPDATE crm_integration_apps') && text.includes('SET active')) {
        return {
          rows: [{
            id: params[0],
            oddzial_id: 7,
            name: 'WhatsApp Krakow',
            type: 'webhook',
            token: 'tok_wa',
            active: params[1],
            config: { unified_inbox: true, channel: 'whatsapp' },
            updated_by: params[2],
          }],
          rowCount: 1,
        };
      }
      if (text.includes('SELECT * FROM crm_integration_apps WHERE token')) {
        return {
          rows: [{
            id: 41,
            oddzial_id: 7,
            name: 'Landing widget',
            token: params[0],
            active: true,
            config: params[0] === 'tok_whatsapp'
              ? { channel: 'whatsapp', source: 'unified-inbox-channel-wizard' }
              : {},
          }],
          rowCount: 1,
        };
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
    const auditLog = jest.fn().mockResolvedValue();
    const appWithAudit = createTestApp('/api/crm', crmRoutes, { auditLog });
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

    const auditRes = await request(appWithAudit)
      .post('/api/crm/integrations/apps')
      .set('Authorization', `Bearer ${token()}`)
      .send({ oddzial_id: 7, name: 'WhatsApp', type: 'webhook', config: { unified_inbox: true, channel: 'whatsapp', provider: 'meta' } });

    expect(auditRes.status).toBe(201);
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'crm.integration.app_created',
      entityType: 'crm_integration_app',
      entityId: 41,
      metadata: expect.objectContaining({
        oddzial_id: 7,
        channel: 'whatsapp',
        provider: 'meta',
        unified_inbox: true,
      }),
    }));
  });

  it('lists scoped CRM integration apps without exposing tokens', async () => {
    const res = await request(crmApp)
      .get('/api/crm/integrations/apps')
      .set('Authorization', `Bearer ${token()}`);

    expect(res.status).toBe(200);
    expect(res.body[0]).toEqual(expect.objectContaining({
      id: 41,
      webhook_path: '/api/webhooks/crm/tok_1',
      event_count: 3,
      last_event_at: '2026-06-01T09:00:00.000Z',
      last_event_status: 'ok',
      last_event_type: 'message.received',
    }));
    expect(res.body[0]).not.toHaveProperty('token');
  });

  it('pauses a scoped CRM integration app', async () => {
    const auditLog = jest.fn().mockResolvedValue();
    const appWithAudit = createTestApp('/api/crm', crmRoutes, { auditLog });
    const res = await request(appWithAudit)
      .patch('/api/crm/integrations/apps/41')
      .set('Authorization', `Bearer ${token()}`)
      .send({ active: false });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({
      id: 41,
      active: false,
      webhook_path: '/api/webhooks/crm/tok_wa',
    }));
    const updateCall = pool.query.mock.calls.find(([sql]) => String(sql).includes('UPDATE crm_integration_apps'));
    expect(updateCall[1]).toEqual([41, false, 9]);
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'crm.integration.app_paused',
      entityType: 'crm_integration_app',
      entityId: 41,
      metadata: expect.objectContaining({
        oddzial_id: 7,
        active: false,
        previous_active: true,
      }),
    }));
  });

  it('ingests public webhook payloads into a lead and message', async () => {
    const res = await request(webhookApp)
      .post('/api/webhooks/crm/tok_1')
      .set('Idempotency-Key', 'crm-inbound-ext-1')
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
    const eventInsert = pool.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO crm_integration_events'));
    expect(eventInsert[1]).toEqual(expect.arrayContaining(['ext-1', 'crm-inbound-ext-1']));
  });

  it('replays CRM webhooks idempotently without duplicating lead or message', async () => {
    pool.query.mockImplementation(async (sql, params = []) => {
      const text = String(sql);
      if (text.includes('CREATE TABLE') || text.includes('CREATE INDEX') || text.includes('ALTER TABLE')) return { rows: [], rowCount: 0 };
      if (text.includes('SELECT * FROM crm_integration_apps WHERE token')) {
        return {
          rows: [{
            id: 41,
            oddzial_id: 7,
            name: 'Landing widget',
            token: params[0],
            active: true,
            config: {},
          }],
          rowCount: 1,
        };
      }
      if (text.includes('FROM crm_integration_events') && text.includes('idempotency_key')) {
        return {
          rows: [{
            id: 201,
            status: 'ok',
            lead_id: 101,
            external_id: 'ext-1',
            idempotency_key: 'crm-inbound-ext-1',
            event_type: 'lead.created',
          }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });

    const res = await request(webhookApp)
      .post('/api/webhooks/crm/tok_1')
      .set('Idempotency-Key', 'crm-inbound-ext-1')
      .send({
        event_type: 'lead.created',
        external_id: 'ext-1',
        title: 'Lead z widgetu',
        message: 'Prosze o kontakt',
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({
      ok: true,
      duplicate: true,
      idempotent_replay: true,
      lead_id: 101,
    }));
    expect(pool.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO crm_leads'))).toBe(false);
    expect(pool.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO crm_lead_messages'))).toBe(false);
  });

  it('uses configured channel when webhook payload omits channel', async () => {
    const res = await request(webhookApp)
      .post('/api/webhooks/crm/tok_whatsapp')
      .send({
        event_type: 'message.received',
        external_id: 'wa-1',
        title: 'Lead z WhatsApp',
        phone: '+48111222333',
        message: 'Dzien dobry, prosze o wycene.',
      });

    expect(res.status).toBe(202);
    const messageInsert = pool.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO crm_lead_messages'));
    expect(messageInsert[1]).toEqual(expect.arrayContaining(['whatsapp']));
    const leadInsert = pool.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO crm_leads'));
    expect(leadInsert[1]).toEqual(expect.arrayContaining(['unified-inbox-channel-wizard']));
  });
});
