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

  const token = () =>
    jwt.sign({ id: 7, login: 'tester', rola: 'Dyrektor', oddzial_id: 1 }, env.JWT_SECRET, { expiresIn: '1h' });

  beforeEach(() => {
    jest.clearAllMocks();
    sendSmsGateway.mockResolvedValue({ ok: true, provider: 'mock', sid: 'SM123' });
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
});
