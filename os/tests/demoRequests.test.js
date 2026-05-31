const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
}));

jest.mock('../src/config/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const pool = require('../src/config/database');
const demoRequestsRoutes = require('../src/routes/demoRequests');
const { createTestApp } = require('./helpers/create-test-app');
const { env } = require('../src/config/env');

describe('Demo request route', () => {
  const app = createTestApp('/api/demo-requests', demoRequestsRoutes);
  const token = (payload = {}) =>
    jwt.sign({ id: 1, rola: 'Administrator', oddzial_id: null, ...payload }, env.JWT_SECRET, {
      expiresIn: '1h',
    });
  const mockEnsureDemoRequestsTable = () => {
    for (let index = 0; index < 7; index += 1) {
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    }
  };

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.DEMO_REQUEST_WEBHOOK_URL;
    delete process.env.DEMO_REQUEST_REQUIRE_DATABASE;
    delete process.env.DEMO_REQUEST_TELEGRAM_ENABLED;
    delete process.env.DEMO_REQUEST_TELEGRAM_BOT_TOKEN;
    delete process.env.DEMO_REQUEST_TELEGRAM_CHAT_ID;
    delete process.env.DEMO_REQUEST_TELEGRAM_PARSE_MODE;
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    global.fetch = undefined;
  });

  it('accepts a public landing page demo request and stores it', async () => {
    pool.query.mockResolvedValue({ rows: [], rowCount: 1 });

    const res = await request(app)
      .post('/api/demo-requests')
      .set('user-agent', 'jest')
      .send({
        name: 'Jan Kowalski',
        email: 'jan@firma.pl',
        company: 'Firma Test',
        phone: '+48 600 000 000',
        message: 'Chcemy uporzadkowac dyspozytornie.',
      });

    expect(res.status).toBe(201);
    expect(res.body).toEqual(expect.objectContaining({ ok: true, stored: true }));
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE IF NOT EXISTS demo_requests'));
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO demo_requests'),
      expect.arrayContaining(['Jan Kowalski', 'jan@firma.pl', 'Firma Test'])
    );
  });

  it('rejects invalid email input', async () => {
    const res = await request(app)
      .post('/api/demo-requests')
      .send({
        name: 'Jan Kowalski',
        email: 'nie-email',
        company: 'Firma Test',
      });

    expect(res.status).toBe(400);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('can notify a configured webhook', async () => {
    pool.query.mockResolvedValue({ rows: [], rowCount: 1 });
    process.env.DEMO_REQUEST_WEBHOOK_URL = 'https://example.test/webhook';
    global.fetch = jest.fn().mockResolvedValue({ ok: true });

    const res = await request(app)
      .post('/api/demo-requests')
      .send({
        name: 'Jan Kowalski',
        email: 'jan@firma.pl',
        company: 'Firma Test',
      });

    expect(res.status).toBe(201);
    expect(res.body.webhookSent).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://example.test/webhook',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('can notify a configured Telegram sales chat', async () => {
    pool.query.mockResolvedValue({ rows: [], rowCount: 1 });
    process.env.DEMO_REQUEST_TELEGRAM_ENABLED = 'true';
    process.env.DEMO_REQUEST_TELEGRAM_BOT_TOKEN = 'demo-token';
    process.env.DEMO_REQUEST_TELEGRAM_CHAT_ID = 'sales-chat';
    global.fetch = jest.fn().mockResolvedValue({ ok: true });

    const res = await request(app)
      .post('/api/demo-requests')
      .send({
        name: 'Jan Kowalski',
        email: 'jan@firma.pl',
        company: 'Firma Test',
        phone: '+48 600 000 000',
        message: 'Chcemy demo.',
      });

    expect(res.status).toBe(201);
    expect(res.body.telegramSent).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.telegram.org/botdemo-token/sendMessage',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('Firma Test'),
      })
    );
  });

  it('lists demo requests for administrators', async () => {
    mockEnsureDemoRequestsTable();
    pool.query
      .mockResolvedValueOnce({ rows: [{ total: 1 }], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [{
          id: 7,
          name: 'Jan Kowalski',
          email: 'jan@firma.pl',
          company: 'Firma Test',
          phone: '',
          message: 'CRM',
          source: 'landing-page',
          status: 'new',
          sales_note: '',
          client_id: null,
          converted_at: null,
          created_at: '2026-05-31T12:00:00.000Z',
        }],
        rowCount: 1,
      });

    const res = await request(app)
      .get('/api/demo-requests?limit=25')
      .set('Authorization', `Bearer ${token()}`);

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0]).toEqual(expect.objectContaining({ company: 'Firma Test' }));
  });

  it('updates status and sales note for administrators', async () => {
    mockEnsureDemoRequestsTable();
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 7 }], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [{
          id: 7,
          name: 'Jan Kowalski',
          email: 'jan@firma.pl',
          company: 'Firma Test',
          status: 'contacted',
          sales_note: 'Oddzwonic jutro.',
          client_id: null,
          converted_at: null,
        }],
        rowCount: 1,
      });

    const res = await request(app)
      .patch('/api/demo-requests/7')
      .set('Authorization', `Bearer ${token()}`)
      .send({ status: 'contacted', sales_note: 'Oddzwonic jutro.' });

    expect(res.status).toBe(200);
    expect(res.body.item).toEqual(expect.objectContaining({
      id: 7,
      status: 'contacted',
      sales_note: 'Oddzwonic jutro.',
    }));
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE demo_requests'),
      [7, 'contacted', 'Oddzwonic jutro.']
    );
  });

  it('converts a demo request into a CRM client', async () => {
    mockEnsureDemoRequestsTable();
    pool.query
      .mockResolvedValueOnce({
        rows: [{
          id: 7,
          name: 'Jan Kowalski',
          email: 'jan@firma.pl',
          company: 'Firma Test',
          phone: '+48 600 000 000',
          message: 'Chcemy uporzadkowac dyspozytornie.',
          source: 'landing-page',
          status: 'contacted',
          sales_note: 'Gotowy na demo.',
          client_id: null,
        }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [{ id: 123 }], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [{
          id: 7,
          name: 'Jan Kowalski',
          email: 'jan@firma.pl',
          company: 'Firma Test',
          status: 'qualified',
          sales_note: 'Gotowy na demo.',
          client_id: 123,
          converted_at: '2026-05-31T12:30:00.000Z',
        }],
        rowCount: 1,
      });

    const res = await request(app)
      .post('/api/demo-requests/7/convert-client')
      .set('Authorization', `Bearer ${token()}`);

    expect(res.status).toBe(201);
    expect(res.body).toEqual(expect.objectContaining({ ok: true, client_id: 123 }));
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO klienci'),
      expect.arrayContaining(['Jan', 'Kowalski', 'Firma Test'])
    );
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE demo_requests'),
      [7, 123]
    );
  });
});
