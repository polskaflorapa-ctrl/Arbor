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

describe('CRM message templates', () => {
  beforeEach(() => {
    pool.query.mockReset();
    pool.query.mockImplementation(async (sql, params = []) => {
      const text = String(sql);
      if (text.includes('CREATE TABLE') || text.includes('CREATE INDEX')) return { rows: [], rowCount: 0 };
      if (text.includes('INSERT INTO crm_message_templates')) {
        return {
          rows: [{
            id: 31,
            oddzial_id: params[0],
            key: params[1],
            name: params[2],
            channel: params[3],
            subject: params[4],
            body: params[5],
            variables: JSON.parse(params[6]),
            active: true,
            created_by: params[7],
            updated_by: params[9],
          }],
          rowCount: 1,
        };
      }
      if (text.includes('SELECT * FROM crm_message_templates WHERE') && text.includes('ORDER BY')) {
        return {
          rows: [{
            id: 31,
            oddzial_id: 7,
            key: 'follow_up',
            name: 'Follow-up',
            channel: 'sms',
            subject: null,
            body: 'Dzien dobry, wracam w sprawie {title}.',
            variables: ['title'],
            active: true,
          }],
          rowCount: 1,
        };
      }
      if (text.includes('SELECT * FROM crm_message_templates WHERE id')) {
        return {
          rows: [{
            id: 31,
            oddzial_id: 7,
            key: 'follow_up',
            name: 'Follow-up',
            channel: 'sms',
            subject: null,
            body: 'Dzien dobry, wracam w sprawie {title}.',
            variables: ['title'],
            active: true,
          }],
          rowCount: 1,
        };
      }
      if (text === 'SELECT * FROM crm_leads WHERE id = $1') {
        return { rows: [{ id: 22, oddzial_id: 7, title: 'Wycinka sosny', phone: '+48111', email: 'a@b.test', source: 'web', stage: 'Lead', value: 900 }] };
      }
      if (text.includes('INSERT INTO crm_lead_messages')) {
        return {
          rows: [{
            id: 102,
            lead_id: 22,
            channel: params[1],
            direction: params[2],
            subject: params[6],
            body: params[7],
            status: params[8],
            template_key: params[11],
            dynamic_fields: JSON.parse(params[12]),
            metadata: JSON.parse(params[13]),
            created_by: params[16],
          }],
          rowCount: 1,
        };
      }
      if (text.includes('UPDATE crm_leads SET updated_at')) return { rows: [], rowCount: 1 };
      if (text.includes('SELECT imie, nazwisko, login FROM users')) return { rows: [{ imie: 'Anna', nazwisko: 'CRM', login: 'anna' }] };
      return { rows: [], rowCount: 0 };
    });
  });

  it('creates templates and extracts dynamic variables', async () => {
    const res = await request(app)
      .post('/api/crm/message-templates')
      .set('Authorization', `Bearer ${token()}`)
      .send({
        oddzial_id: 7,
        key: 'follow_up',
        name: 'Follow-up',
        channel: 'sms',
        body: 'Dzien dobry, wracam w sprawie {title}.',
      });

    expect(res.status).toBe(201);
    expect(res.body).toEqual(expect.objectContaining({
      id: 31,
      key: 'follow_up',
      channel: 'sms',
      variables: ['title'],
    }));
  });

  it('renders templates with fields', async () => {
    const res = await request(app)
      .post('/api/crm/message-templates/31/render')
      .set('Authorization', `Bearer ${token()}`)
      .send({ fields: { title: 'Wycinka sosny' } });

    expect(res.status).toBe(200);
    expect(res.body.rendered_body).toBe('Dzien dobry, wracam w sprawie Wycinka sosny.');
  });

  it('stores a lead message from a template', async () => {
    const res = await request(app)
      .post('/api/crm/leads/22/messages')
      .set('Authorization', `Bearer ${token()}`)
      .send({
        template_id: 31,
        direction: 'outbound',
        recipient_handle: '+48111',
        dynamic_fields: { title: 'Wycinka sosny' },
      });

    expect(res.status).toBe(201);
    expect(res.body).toEqual(expect.objectContaining({
      channel: 'sms',
      direction: 'outbound',
      body: 'Dzien dobry, wracam w sprawie Wycinka sosny.',
      template_key: 'follow_up',
      author_name: 'Anna CRM',
    }));
    const insert = pool.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO crm_lead_messages'));
    expect(JSON.parse(insert[1][12])).toEqual(expect.objectContaining({
      title: 'Wycinka sosny',
      lead_id: 22,
      phone: '+48111',
    }));
    expect(JSON.parse(insert[1][13])).toEqual(expect.objectContaining({ template_id: 31 }));
  });
});
