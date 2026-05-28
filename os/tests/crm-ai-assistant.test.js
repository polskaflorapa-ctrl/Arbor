const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  connect: jest.fn(),
}));

jest.mock('../src/services/aiProviders', () => ({
  generateAiText: jest.fn(),
  getAiConfigurationStatus: jest.fn(() => ({ textAvailable: true })),
}));

const pool = require('../src/config/database');
const { generateAiText } = require('../src/services/aiProviders');
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

describe('CRM AI assistant', () => {
  beforeEach(() => {
    pool.query.mockReset();
    generateAiText.mockReset();
    generateAiText.mockResolvedValue({
      provider: 'mock-ai',
      model: 'mock-model',
      text: JSON.stringify({
        summary: 'Klient pyta o wycene i czeka na kontakt.',
        next_best_action: 'Zadzwon dzis i umow ogledziny.',
        suggested_reply: 'Dzien dobry, oddzwonimy dzis z terminem ogledzin.',
        lead_score: 72,
        risk: 'medium',
      }),
    });
    pool.query.mockImplementation(async (sql) => {
      const text = String(sql);
      if (text === 'SELECT id, oddzial_id FROM crm_leads WHERE id = $1') return { rows: [{ id: 22, oddzial_id: 7 }] };
      if (text.includes('FROM crm_leads l') && text.includes('LEFT JOIN users')) {
        return { rows: [{ id: 22, oddzial_id: 7, title: 'Lead AI', stage: 'Lead', source: 'whatsapp', value: 1200, owner_user_id: 9, owner_imie: 'Anna', owner_nazwisko: 'CRM' }] };
      }
      if (text.includes('FROM crm_lead_messages')) {
        return { rows: [{ channel: 'whatsapp', direction: 'inbound', body: 'Prosze o wycene', status: 'received', created_at: '2026-05-28T08:00:00.000Z' }] };
      }
      if (text.includes('FROM crm_lead_activities')) {
        return { rows: [{ type: 'task', text: 'Oddzwonic', due_at: null, completed_at: null, created_at: '2026-05-28T08:05:00.000Z' }] };
      }
      return { rows: [] };
    });
  });

  it('generates a lead summary, next action and suggested reply', async () => {
    const res = await request(app)
      .post('/api/crm/leads/22/ai-assistant')
      .set('Authorization', `Bearer ${token()}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({
      lead_id: 22,
      source: 'ai',
      provider: 'mock-ai',
      summary: 'Klient pyta o wycene i czeka na kontakt.',
      next_best_action: 'Zadzwon dzis i umow ogledziny.',
      suggested_reply: 'Dzien dobry, oddzwonimy dzis z terminem ogledzin.',
      lead_score: 72,
      risk: 'medium',
    }));
    expect(generateAiText).toHaveBeenCalledWith(expect.objectContaining({ maxTokens: 700 }));
  });

  it('blocks branch users from another branch lead', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 22, oddzial_id: 9 }] });

    const res = await request(app)
      .post('/api/crm/leads/22/ai-assistant')
      .set('Authorization', `Bearer ${token({ oddzial_id: 7 })}`);

    expect(res.status).toBe(403);
    expect(generateAiText).not.toHaveBeenCalled();
  });
});
