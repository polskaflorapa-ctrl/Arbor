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
  rola: 'Kierownik',
  oddzial_id: 7,
  ...payload,
}, env.JWT_SECRET);

function leadRow(overrides = {}) {
  return {
    id: 22,
    title: 'Lead dzisiaj',
    stage: 'Lead',
    source: 'whatsapp',
    value: 1200,
    phone: '+48500111222',
    email: 'lead@example.test',
    client_name: 'Jan Klient',
    owner_user_id: null,
    owner_imie: null,
    owner_nazwisko: null,
    owner_login: null,
    oddzial_id: 7,
    next_action_at: null,
    created_at: '2026-06-13T08:00:00.000Z',
    updated_at: '2026-06-13T08:05:00.000Z',
    ...overrides,
  };
}

function messageRow(overrides = {}) {
  return {
    id: 501,
    lead_id: 22,
    lead_title: 'Lead dzisiaj',
    client_name: 'Jan Klient',
    channel: 'whatsapp',
    direction: 'inbound',
    status: 'received',
    body: 'Prosze o kontakt.',
    subject: null,
    sender_handle: '+48500111222',
    recipient_handle: 'ARBOR',
    owner_user_id: 9,
    owner_imie: 'Anna',
    owner_nazwisko: 'CRM',
    owner_login: 'anna',
    retry_count: 0,
    last_error: null,
    created_at: '2026-06-13T08:10:00.000Z',
    ...overrides,
  };
}

describe('CRM today workspace', () => {
  beforeEach(() => {
    pool.query.mockReset();
    pool.query.mockImplementation((sql) => {
      const text = String(sql);
      if (
        text.includes('CREATE TABLE IF NOT EXISTS crm_lead_messages')
        || text.includes('CREATE INDEX IF NOT EXISTS idx_crm_lead_messages')
        || text.includes('ALTER TABLE crm_lead_messages')
      ) {
        return Promise.resolve({ rows: [] });
      }
      if (text.includes('COUNT(*)::int AS c') && text.includes('l.owner_user_id IS NULL')) {
        return Promise.resolve({ rows: [{ c: 1 }] });
      }
      if (text.includes('COUNT(*)::int AS c') && text.includes('crm_lead_activities')) {
        return Promise.resolve({ rows: [{ c: 2 }] });
      }
      if (text.includes('COUNT(*)::int AS c') && text.includes('last_outbound')) {
        return Promise.resolve({ rows: [{ c: 5 }] });
      }
      if (text.includes('COUNT(*)::int AS c') && text.includes("m.direction = 'inbound'")) {
        return Promise.resolve({ rows: [{ c: 3 }] });
      }
      if (text.includes('COUNT(*)::int AS c') && text.includes("m.direction = 'outbound'")) {
        return Promise.resolve({ rows: [{ c: 4 }] });
      }
      if (text.includes('SELECT a.id') && text.includes('crm_lead_activities')) {
        return Promise.resolve({
          rows: [{
            id: 700,
            lead_id: 22,
            text: 'Oddzwon do klienta',
            due_at: '2026-06-13T07:00:00.000Z',
            activity_created_at: '2026-06-12T12:00:00.000Z',
            ...leadRow({ id: 22, title: 'Lead follow-up', lead_title: 'Lead follow-up' }),
          }],
        });
      }
      if (text.includes('FROM crm_lead_messages m') && text.includes("m.direction = 'inbound'")) {
        return Promise.resolve({ rows: [messageRow()] });
      }
      if (text.includes('JOIN last_outbound') && !text.includes('COUNT(*)::int AS c')) {
        return Promise.resolve({ rows: [leadRow({ id: 33, title: 'Stary follow-up', owner_user_id: 9, owner_imie: 'Anna', owner_nazwisko: 'CRM' })] });
      }
      if (text.includes('FROM crm_lead_messages m') && text.includes("m.direction = 'outbound'")) {
        return Promise.resolve({ rows: [messageRow({ id: 502, direction: 'outbound', status: 'failed', last_error: 'Timeout' })] });
      }
      if (text.includes('l.owner_user_id IS NULL')) {
        return Promise.resolve({ rows: [leadRow()] });
      }
      return Promise.resolve({ rows: [] });
    });
  });

  it('returns urgent CRM work grouped for the daily workspace', async () => {
    const res = await request(app)
      .get('/api/crm/today?oddzial_id=7')
      .set('Authorization', `Bearer ${token()}`);

    expect(res.status).toBe(200);
    expect(res.body.kpis).toEqual(expect.objectContaining({
      unassigned_leads: 1,
      overdue_followups: 2,
      new_inbound: 3,
      failed_messages: 4,
      stale_no_response: 5,
    }));
    expect(res.body.unassigned_leads[0]).toEqual(expect.objectContaining({
      id: 22,
      title: 'Lead dzisiaj',
      owner_user_id: null,
    }));
    expect(res.body.overdue_followups[0]).toEqual(expect.objectContaining({
      text: 'Oddzwon do klienta',
      lead: expect.objectContaining({ title: 'Lead follow-up' }),
    }));
    expect(res.body.inbound_messages[0]).toEqual(expect.objectContaining({
      id: 501,
      direction: 'inbound',
      owner_name: 'Anna CRM',
    }));
    expect(res.body.failed_messages[0]).toEqual(expect.objectContaining({
      id: 502,
      status: 'failed',
      last_error: 'Timeout',
    }));
    expect(res.body.stale_leads[0]).toEqual(expect.objectContaining({
      id: 33,
      title: 'Stary follow-up',
    }));
  });
});
