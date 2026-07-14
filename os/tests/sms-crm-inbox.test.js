// Deterministyczna baza linków trackingu: env to snapshot zamrażany przy pierwszym
// require, więc wartość musi być ustawiona PRZED importami (CI nie ma pliku .env).
process.env.PUBLIC_BASE_URL = 'http://localhost:3005';

const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
}));

jest.mock('../src/services/smsGateway', () => ({
  activeSmsProvider: jest.fn(() => 'mock'),
  sendSmsGateway: jest.fn(),
}));

jest.mock('../src/services/crmInbox', () => ({
  appendCrmMessageForContact: jest.fn(),
}));

const pool = require('../src/config/database');
const { sendSmsGateway } = require('../src/services/smsGateway');
const { appendCrmMessageForContact } = require('../src/services/crmInbox');
const smsRoutes = require('../src/routes/sms');
const { createTestApp } = require('./helpers/create-test-app');
const { env } = require('../src/config/env');

describe('SMS CRM inbox bridge', () => {
  const app = createTestApp('/api/sms', smsRoutes);
  const previousPublicBaseUrl = process.env.PUBLIC_BASE_URL;

  const token = (overrides = {}) =>
    jwt.sign({ id: 7, login: 'tester', rola: 'Dyrektor', oddzial_id: 1, ...overrides }, env.JWT_SECRET, { expiresIn: '1h' });

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PUBLIC_BASE_URL = '';
    sendSmsGateway.mockResolvedValue({ ok: true, provider: 'mock', sid: 'SM123' });
    pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  afterEach(() => {
    if (previousPublicBaseUrl === undefined) {
      delete process.env.PUBLIC_BASE_URL;
    } else {
      process.env.PUBLIC_BASE_URL = previousPublicBaseUrl;
    }
  });

  it('mirrors manual task SMS into CRM lead inbox', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ oddzial_id: 2, klient_telefon: '+48111222333', klient_email: 'jan@example.com' }],
      rowCount: 1,
    });

    const res = await request(app)
      .post('/api/sms/wyslij')
      .set('Authorization', `Bearer ${token()}`)
      .send({ telefon: '+48111222333', tresc: 'Test SMS', task_id: 55 });

    expect(res.status).toBe(200);
    expect(appendCrmMessageForContact).toHaveBeenCalledWith(expect.objectContaining({
      oddzialId: 2,
      phone: '+48111222333',
      email: 'jan@example.com',
      channel: 'sms',
      direction: 'outbound',
      recipientHandle: '+48111222333',
      body: 'Test SMS',
      status: 'sent',
      externalMessageId: 'SM123',
      metadata: { task_id: 55, provider: 'mock', source: 'sms.manual' },
      createdBy: 7,
    }));
  });

  it('sends branch test SMS through the requested branch sender', async () => {
    const res = await request(app)
      .post('/api/sms/oddzial-test')
      .set('Authorization', `Bearer ${token()}`)
      .send({ oddzial_id: 4, telefon: '+48111222333' });

    expect(res.status).toBe(200);
    expect(sendSmsGateway).toHaveBeenCalledWith(expect.objectContaining({
      to: '+48111222333',
      oddzialId: 4,
    }));
  });

  it('blocks managers from testing another branch sender', async () => {
    const res = await request(app)
      .post('/api/sms/oddzial-test')
      .set('Authorization', `Bearer ${token({ rola: 'Kierownik', oddzial_id: 2 })}`)
      .send({ oddzial_id: 4, telefon: '+48111222333' });

    expect(res.status).toBe(403);
    expect(sendSmsGateway).not.toHaveBeenCalled();
  });

  it('mirrors templated task SMS into CRM lead inbox', async () => {
    pool.query
      .mockResolvedValueOnce({
        rows: [{
          id: 77,
          oddzial_id: 3,
          klient_nazwa: 'Maria',
          klient_telefon: '+48999111222',
          klient_email: 'maria@example.com',
          typ_uslugi: 'Wycinka',
          adres: 'Lesna 1',
          miasto: 'Warszawa',
          data_planowana: '2026-05-29T08:00:00.000Z',
          oddzial_telefon: '+48220000000',
          oddzial_nazwa: 'Warszawa',
        }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const res = await request(app)
      .post('/api/sms/zlecenie/77')
      .set('Authorization', `Bearer ${token()}`)
      .send({ typ: 'potwierdzenie' });

    expect(res.status).toBe(200);
    expect(appendCrmMessageForContact).toHaveBeenCalledWith(expect.objectContaining({
      oddzialId: 3,
      phone: '+48999111222',
      email: 'maria@example.com',
      channel: 'sms',
      direction: 'outbound',
      recipientHandle: '+48999111222',
      status: 'sent',
      externalMessageId: 'SM123',
      templateKey: 'potwierdzenie',
      dynamicFields: { typ: 'potwierdzenie', powod: null },
      metadata: { task_id: 77, provider: 'mock', source: 'sms.task' },
      createdBy: 7,
    }));
  });

  it('blocks manual SMS for crew roles before sending', async () => {
    const res = await request(app)
      .post('/api/sms/wyslij')
      .set('Authorization', `Bearer ${token({ rola: 'Brygadzista' })}`)
      .send({ telefon: '+48111222333', tresc: 'Test SMS' });

    expect(res.status).toBe(403);
    expect(pool.query).not.toHaveBeenCalled();
    expect(sendSmsGateway).not.toHaveBeenCalled();
  });

  it('blocks kierownik from sending manual task SMS outside own branch', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ oddzial_id: 9, klient_telefon: '+48111222333', klient_email: 'jan@example.com' }],
      rowCount: 1,
    });

    const res = await request(app)
      .post('/api/sms/wyslij')
      .set('Authorization', `Bearer ${token({ rola: 'Kierownik', oddzial_id: 3 })}`)
      .send({ telefon: '+48111222333', tresc: 'Test SMS', task_id: 55 });

    expect(res.status).toBe(403);
    expect(sendSmsGateway).not.toHaveBeenCalled();
    expect(appendCrmMessageForContact).not.toHaveBeenCalled();
  });

  it('blocks templated task SMS outside kierownik branch', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{
        id: 77,
        oddzial_id: 9,
        klient_telefon: '+48999111222',
        typ_uslugi: 'Wycinka',
      }],
      rowCount: 1,
    });

    const res = await request(app)
      .post('/api/sms/zlecenie/77')
      .set('Authorization', `Bearer ${token({ rola: 'Kierownik', oddzial_id: 3 })}`)
      .send({ typ: 'potwierdzenie' });

    expect(res.status).toBe(403);
    expect(sendSmsGateway).not.toHaveBeenCalled();
    expect(appendCrmMessageForContact).not.toHaveBeenCalled();
  });

  it('lists default and configured SMS templates for managers', async () => {
    pool.query.mockImplementation(async (sql) => {
      const text = String(sql);
      if (text.startsWith('CREATE TABLE') || text.startsWith('CREATE UNIQUE INDEX') || text.startsWith('CREATE INDEX')) {
        return { rows: [], rowCount: 0 };
      }
      if (text.includes('SELECT * FROM sms_status_templates')) {
        return {
          rows: [{ id: 12, oddzial_id: null, template_key: 'zaplanowane', body: 'Global {{service}}', active: true }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });

    const res = await request(app)
      .get('/api/sms/templates?oddzial_id=3')
      .set('Authorization', `Bearer ${token()}`);

    expect(res.status).toBe(200);
    expect(res.body.defaults.zaplanowane).toContain('{{status_url}}');
    expect(res.body.templates).toEqual([
      expect.objectContaining({ template_key: 'zaplanowane', body: 'Global {{service}}' }),
    ]);
  });

  it('saves branch SMS template configuration', async () => {
    pool.query.mockImplementation(async (sql, params) => {
      const text = String(sql);
      if (text.startsWith('CREATE TABLE') || text.startsWith('CREATE UNIQUE INDEX') || text.startsWith('CREATE INDEX')) {
        return { rows: [], rowCount: 0 };
      }
      if (text.includes('INSERT INTO sms_status_templates')) {
        return {
          rows: [{
            id: 44,
            oddzial_id: params[0],
            template_key: params[1],
            body: params[2],
            active: params[3],
            updated_by: params[4],
          }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });

    const res = await request(app)
      .put('/api/sms/templates/w_drodze')
      .set('Authorization', `Bearer ${token()}`)
      .send({ oddzial_id: 3, body: 'Oddzialowy SMS {{service}} {{status_url}}', active: true });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({
      oddzial_id: 3,
      template_key: 'w_drodze',
      body: 'Oddzialowy SMS {{service}} {{status_url}}',
      active: true,
      updated_by: 7,
    }));
  });

  it('uses configured branch SMS template when sending task status', async () => {
    pool.query.mockImplementation(async (sql) => {
      const text = String(sql);
      if (text.includes('FROM tasks t LEFT JOIN branches b')) {
        return {
          rows: [{
            id: 88,
            oddzial_id: 3,
            klient_nazwa: 'Maria',
            klient_telefon: '+48999111222',
            klient_email: 'maria@example.com',
            typ_uslugi: 'Wycinka',
            adres: 'Lesna 1',
            miasto: 'Warszawa',
            link_statusowy_token: 'tok_sms_12345678901234567890',
            data_planowana: '2026-05-29T08:00:00.000Z',
            oddzial_telefon: '+48220000000',
            oddzial_nazwa: 'Warszawa',
          }],
          rowCount: 1,
        };
      }
      if (text.startsWith('CREATE TABLE') || text.startsWith('CREATE UNIQUE INDEX') || text.startsWith('CREATE INDEX')) {
        return { rows: [], rowCount: 0 };
      }
      if (text.includes('FROM sms_status_templates')) {
        return {
          rows: [{ id: 5, oddzial_id: 3, template_key: 'w_drodze', body: 'Custom {{service}} {{status_url}}' }],
          rowCount: 1,
        };
      }
      if (text.startsWith('UPDATE tasks SET status')) {
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    const res = await request(app)
      .post('/api/sms/zlecenie/88')
      .set('Authorization', `Bearer ${token()}`)
      .send({ typ: 'w_drodze' });

    expect(res.status).toBe(200);
    expect(sendSmsGateway).toHaveBeenCalledWith(expect.objectContaining({
      to: '+48999111222',
      body: 'Custom Wycinka http://localhost:3005/track/tok_sms_12345678901234567890',
      taskId: 88,
    }));
  });
});
