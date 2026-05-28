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
const token = jwt.sign({ id: 9, rola: 'Kierownik', oddzial_id: 7 }, env.JWT_SECRET);

describe('CRM NPS surveys', () => {
  beforeEach(() => {
    pool.query.mockReset();
    pool.query.mockImplementation(async (sql, params = []) => {
      const text = String(sql);
      if (text.includes('CREATE TABLE') || text.includes('CREATE INDEX')) return { rows: [], rowCount: 0 };
      if (text.includes('INSERT INTO crm_nps_surveys')) {
        return {
          rows: [{
            id: 41,
            oddzial_id: params[0],
            lead_id: params[1],
            client_id: params[2],
            task_id: params[3],
            channel: params[4],
            score: params[5],
            comment: params[6],
            respondent_name: params[7],
            respondent_contact: params[8],
            sent_at: params[9],
            created_by: params[10],
          }],
          rowCount: 1,
        };
      }
      if (text.includes('FROM crm_nps_surveys s')) {
        return {
          rows: [{
            id: 41,
            oddzial_id: 7,
            lead_id: 22,
            channel: 'sms',
            score: 10,
            comment: 'Super kontakt',
            lead_title: 'Wycinka sosny',
          }],
        };
      }
      return { rows: [], rowCount: 0 };
    });
  });

  it('creates an NPS survey response', async () => {
    const res = await request(app)
      .post('/api/crm/nps-surveys')
      .set('Authorization', `Bearer ${token}`)
      .send({
        lead_id: 22,
        channel: 'sms',
        score: 10,
        comment: 'Super kontakt',
        respondent_contact: '+48500100200',
      });

    expect(res.status).toBe(201);
    expect(res.body).toEqual(expect.objectContaining({
      oddzial_id: 7,
      lead_id: 22,
      channel: 'sms',
      score: 10,
      nps_group: 'promoter',
    }));
  });

  it('lists recent NPS survey responses', async () => {
    const res = await request(app)
      .get('/api/crm/nps-surveys?oddzial_id=7')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body[0]).toEqual(expect.objectContaining({
      score: 10,
      nps_group: 'promoter',
      lead_title: 'Wycinka sosny',
    }));
  });

  it('rejects invalid NPS scores', async () => {
    const res = await request(app)
      .post('/api/crm/nps-surveys')
      .set('Authorization', `Bearer ${token}`)
      .send({ score: 11 });

    expect(res.status).toBe(400);
  });
});
