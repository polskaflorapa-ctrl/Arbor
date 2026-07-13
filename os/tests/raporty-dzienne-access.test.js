const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  connect: jest.fn(),
}));

const mockSendMail = jest.fn();
jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({ sendMail: mockSendMail })),
}));

jest.mock('../src/services/audit', () => ({ logAudit: jest.fn() }));
jest.mock('../src/services/webhook', () => ({ dispatchWebhook: jest.fn() }));
jest.mock('../src/config/logger', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
}));

const pool = require('../src/config/database');
const routes = require('../src/routes/raporty-dzienne');
const { createTestApp } = require('./helpers/create-test-app');
const { env } = require('../src/config/env');

describe('Daily report access policy', () => {
  const app = createTestApp('/api/raporty-dzienne', routes);
  const token = (payload = {}) => jwt.sign(
    { id: 11, rola: 'Brygadzista', oddzial_id: 3, ...payload },
    env.JWT_SECRET,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    mockSendMail.mockResolvedValue({ messageId: 'mail-1' });
  });

  it('limits an ordinary employee report list to their own user id', async () => {
    pool.query.mockResolvedValue({ rows: [] });

    const res = await request(app)
      .get('/api/raporty-dzienne')
      .set('Authorization', `Bearer ${token({ rola: 'Pomocnik' })}`);

    expect(res.status).toBe(200);
    const listCall = pool.query.mock.calls.find(([sql]) => String(sql).includes('SELECT r.*'));
    expect(listCall).toBeDefined();
    expect(listCall[0]).toContain('r.user_id = $1');
    expect(listCall[1]).toEqual([11]);
  });

  it('limits an administrator report list to their branch', async () => {
    pool.query.mockResolvedValue({ rows: [] });

    const res = await request(app)
      .get('/api/raporty-dzienne')
      .set('Authorization', `Bearer ${token({ rola: 'Administrator' })}`);

    expect(res.status).toBe(200);
    const listCall = pool.query.mock.calls.find(([sql]) => String(sql).includes('SELECT r.*'));
    expect(listCall[0]).toContain('r.oddzial_id = $1');
    expect(listCall[1]).toEqual([3]);
  });

  it('blocks a worker from reading another user report before loading its details', async () => {
    pool.query.mockImplementation(async (sql) => {
      if (String(sql).includes('SELECT r.*')) {
        return { rows: [{ id: 7, user_id: 99, oddzial_id: 3 }] };
      }
      return { rows: [] };
    });

    const res = await request(app)
      .get('/api/raporty-dzienne/7')
      .set('Authorization', `Bearer ${token()}`);

    expect(res.status).toBe(403);
    expect(pool.query.mock.calls.some(([sql]) => String(sql).includes('FROM daily_report_tasks'))).toBe(false);
  });

  it('blocks a manager from reading a report in another branch', async () => {
    pool.query.mockImplementation(async (sql) => {
      if (String(sql).includes('SELECT r.*')) {
        return { rows: [{ id: 7, user_id: 99, oddzial_id: 8 }] };
      }
      return { rows: [] };
    });

    const res = await request(app)
      .get('/api/raporty-dzienne/7')
      .set('Authorization', `Bearer ${token({ rola: 'Kierownik' })}`);

    expect(res.status).toBe(403);
  });

  it('rolls back before rejecting edits to an already sent report', async () => {
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: 7, status: 'Wyslany' }] })
        .mockResolvedValueOnce({ rows: [] }),
      release: jest.fn(),
    };
    pool.connect.mockResolvedValue(client);
    pool.query.mockResolvedValue({ rows: [] });

    const res = await request(app)
      .post('/api/raporty-dzienne')
      .set('Authorization', `Bearer ${token()}`)
      .send({ data_raportu: '2026-07-11', zadania: [], materialy: [] });

    expect(res.status).toBe(400);
    expect(client.query.mock.calls.map(([sql]) => String(sql).trim())).toEqual([
      'BEGIN',
      expect.stringContaining('SELECT id, status FROM daily_reports'),
      'ROLLBACK',
    ]);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('does not leak database details when a report save fails', async () => {
    const client = {
      query: jest.fn(async (sql) => {
        const statement = String(sql).trim();
        if (statement === 'BEGIN' || statement === 'ROLLBACK') return { rows: [] };
        if (statement.startsWith('SELECT id, status')) return { rows: [] };
        if (statement.startsWith('INSERT INTO daily_reports')) {
          throw new Error('sensitive daily_reports constraint detail');
        }
        return { rows: [] };
      }),
      release: jest.fn(),
    };
    pool.connect.mockResolvedValue(client);
    pool.query.mockResolvedValue({ rows: [] });

    const res = await request(app)
      .post('/api/raporty-dzienne')
      .set('Authorization', `Bearer ${token()}`)
      .send({ data_raportu: '2026-07-11', zadania: [], materialy: [] });

    expect(res.status).toBe(500);
    expect(res.body.error).toBeTruthy();
    expect(res.body.error).not.toContain('sensitive daily_reports constraint detail');
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });

  it('escapes report content and rejects unsafe signature URLs in email HTML', async () => {
    pool.query.mockImplementation(async (sql) => {
      const statement = String(sql);
      if (statement.includes('SELECT r.*')) {
        return {
          rows: [{
            id: 7,
            user_id: 11,
            oddzial_id: 3,
            pracownik_nazwa: '<script>worker()</script>',
            oddzial_nazwa: 'Oddzial <img src=x>',
            data_raportu: '2026-07-11',
            opis_pracy: '<script>alert(1)</script>',
            podpis_url: 'javascript:alert(2)',
            czas_pracy_minuty: 60,
          }],
        };
      }
      if (statement.includes('FROM daily_report_tasks')) {
        return { rows: [{ klient_nazwa: '<b>Klient</b>', uwagi: '<script>x()</script>', czas_minuty: 60 }] };
      }
      if (statement.includes('FROM daily_report_materials')) {
        return { rows: [{ nazwa: '<img src=x>', ilosc: 1, jednostka: 'szt', koszt_jednostkowy: 0 }] };
      }
      if (statement.includes('SELECT email, imie, nazwisko, rola FROM users')) {
        return { rows: [{ email: 'manager@example.test' }] };
      }
      return { rows: [] };
    });

    const res = await request(app)
      .post('/api/raporty-dzienne/7/wyslij')
      .set('Authorization', `Bearer ${token()}`);

    expect(res.status).toBe(200);
    const html = mockSendMail.mock.calls[0][0].html;
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&lt;b&gt;Klient&lt;/b&gt;');
  });

  it('keeps the strictly generated mobile confirmation signature in email HTML', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="150"><text x="50" y="80" font-size="24" fill="#3B2A18">Podpisano</text></svg>';
    const signature = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
    pool.query.mockImplementation(async (sql) => {
      const statement = String(sql);
      if (statement.includes('SELECT r.*')) {
        return {
          rows: [{
            id: 8,
            user_id: 11,
            oddzial_id: 3,
            pracownik_nazwa: 'Jan Testowy',
            oddzial_nazwa: 'Warszawa',
            data_raportu: '2026-07-11',
            podpis_url: signature,
            czas_pracy_minuty: 0,
          }],
        };
      }
      if (statement.includes('FROM daily_report_tasks') || statement.includes('FROM daily_report_materials')) {
        return { rows: [] };
      }
      if (statement.includes('SELECT email, imie, nazwisko, rola FROM users')) {
        return { rows: [{ email: 'manager@example.test' }] };
      }
      return { rows: [] };
    });

    const res = await request(app)
      .post('/api/raporty-dzienne/8/wyslij')
      .set('Authorization', `Bearer ${token()}`);

    expect(res.status).toBe(200);
    expect(mockSendMail.mock.calls[0][0].html).toContain(signature);
  });
});
