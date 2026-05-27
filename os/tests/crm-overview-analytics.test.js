const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  connect: jest.fn(),
}));

jest.mock('../src/services/crmWorkflows', () => ({
  createWorkflowRule: jest.fn(),
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

describe('CRM overview analytics', () => {
  beforeEach(() => {
    pool.query.mockReset();
    pool.query.mockImplementation(async (sql) => {
      const text = String(sql);
      if (text.includes('COUNT(*)::int AS c FROM klienci WHERE created_at')) return { rows: [{ c: 2 }] };
      if (text.includes('COUNT(*)::int AS c FROM klienci')) return { rows: [{ c: 10 }] };
      if (text.includes('COUNT(*)::int AS c FROM tasks') && text.includes('status = ANY')) return { rows: [{ c: 3 }] };
      if (text.includes('COUNT(*)::int AS c FROM tasks')) return { rows: [{ c: 8 }] };
      if (text.includes('COUNT(*)::int AS c FROM phone_call_conversations')) return { rows: [{ c: 4 }] };
      if (text.includes('FROM crm_leads l') && text.includes('LEFT JOIN users o')) {
        return {
          rows: [
            { id: 1, oddzial_id: 7, stage: 'Wygrane', value: 1000, source: 'whatsapp', owner_user_id: 21, owner_imie: 'Anna', owner_nazwisko: 'CRM' },
            { id: 2, oddzial_id: 7, stage: 'Przegrane', value: 500, source: 'whatsapp', owner_user_id: 21, owner_imie: 'Anna', owner_nazwisko: 'CRM' },
            { id: 3, oddzial_id: 7, stage: 'Lead', value: 700, source: 'email', owner_user_id: 22, owner_imie: 'Piotr', owner_nazwisko: 'CRM' },
            { id: 4, oddzial_id: 7, stage: 'Techniczny', value: 200, source: 'email', owner_user_id: null },
          ],
        };
      }
      if (text.includes('SELECT id, status, wartosc_planowana FROM tasks')) return { rows: [] };
      if (text.includes("to_regclass('public.telephony_callbacks')")) return { rows: [{ exists: false }] };
      return { rows: [] };
    });
  });

  it('returns conversion, source and owner analytics from CRM leads', async () => {
    const res = await request(app)
      .get('/api/crm/overview?oddzial_id=7')
      .set('Authorization', `Bearer ${token()}`);

    expect(res.status).toBe(200);
    expect(res.body.kpis.lead_win_rate).toBe(33);
    expect(res.body.analytics.conversion).toEqual(expect.objectContaining({
      total: 4,
      open: 1,
      won: 1,
      lost: 1,
      technical: 1,
      win_rate: 33,
    }));
    expect(res.body.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'whatsapp', count: 2, won: 1, lost: 1, conversion_rate: 50 }),
      expect.objectContaining({ source: 'email', count: 2, technical: 1, conversion_rate: 0 }),
    ]));
    expect(res.body.analytics.owners[0]).toEqual(expect.objectContaining({
      owner_user_id: 21,
      owner_name: 'Anna CRM',
      count: 2,
      won: 1,
      conversion_rate: 50,
    }));
  });
});
