const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  connect: jest.fn(),
}));

jest.mock('../src/config/logger', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
}));

const pool = require('../src/config/database');
const ksiegowoscRoutes = require('../src/routes/ksiegowosc');
const { createTestApp } = require('./helpers/create-test-app');
const { env } = require('../src/config/env');
const { INVOICE_NUMBER_LOCK_NAMESPACE } = require('../src/services/invoices');

describe('Ksiegowosc faktury', () => {
  const app = createTestApp('/api/ksiegowosc', ksiegowoscRoutes);
  const token = (payload = {}) =>
    jwt.sign({ id: 11, rola: 'Kierownik', oddzial_id: 3, ...payload }, env.JWT_SECRET, {
      expiresIn: '1h',
    });

  let client;

  beforeEach(() => {
    jest.clearAllMocks();
    client = {
      query: jest.fn(),
      release: jest.fn(),
    };
    pool.connect.mockResolvedValue(client);
  });

  function invoicePayload(overrides = {}) {
    return {
      klient_nazwa: 'Firma Test',
      klient_adres: 'Lesna 1, Warszawa',
      klient_email: 'firma@example.test',
      data_wystawienia: '2026-06-18',
      data_sprzedazy: '2026-06-18',
      forma_platnosci: 'przelew',
      pozycje: [
        { nazwa: 'Pielegnacja drzew', jednostka: 'usl', ilosc: 2, cena_netto: 100, vat_stawka: 23 },
      ],
      ...overrides,
    };
  }

  it('creates an invoice inside one transaction with locked global yearly numbering', async () => {
    client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ last_number: 4 }] })
      .mockResolvedValueOnce({ rows: [{ id: 90 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post('/api/ksiegowosc/faktury')
      .set('Authorization', `Bearer ${token()}`)
      .send(invoicePayload());

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 90, numer: 'FV/2026/005' });
    expect(pool.query).not.toHaveBeenCalledWith(expect.stringContaining('last_number'), expect.any(Array));
    expect(client.query.mock.calls.map(([sql]) => sql)).toEqual([
      'BEGIN',
      'SELECT pg_advisory_xact_lock($1, $2)',
      expect.stringContaining('FROM invoices'),
      expect.stringContaining('INSERT INTO invoices'),
      expect.stringContaining('INSERT INTO invoice_items'),
      'COMMIT',
    ]);
    expect(client.query).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock($1, $2)',
      [INVOICE_NUMBER_LOCK_NAMESPACE, 2026]
    );
    const numberingCall = client.query.mock.calls.find(([sql]) => String(sql).includes('AS last_number'));
    expect(numberingCall).toBeDefined();
    expect(numberingCall[1]).toEqual([2026]);
    expect(numberingCall[0]).not.toContain('oddzial_id');
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO invoices'),
      expect.arrayContaining(['FV/2026/005', null, 3, 11, 'Firma Test'])
    );
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('rolls back the invoice when an item insert fails', async () => {
    client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ last_number: 0 }] })
      .mockResolvedValueOnce({ rows: [{ id: 91 }], rowCount: 1 })
      .mockRejectedValueOnce(new Error('item insert failed'))
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post('/api/ksiegowosc/faktury')
      .set('Authorization', `Bearer ${token()}`)
      .send(invoicePayload());

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('item insert failed');
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.query).not.toHaveBeenCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('requires a branch when a director has no default branch', async () => {
    client.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post('/api/ksiegowosc/faktury')
      .set('Authorization', `Bearer ${token({ rola: 'Prezes', oddzial_id: null })}`)
      .send(invoicePayload({ oddzial_id: null }));

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Oddzial jest wymagany do wystawienia faktury.');
    expect(client.query).toHaveBeenCalledWith('BEGIN');
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO invoices'))).toBe(false);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('rejects invoice items with a negative net price before opening a transaction', async () => {
    const res = await request(app)
      .post('/api/ksiegowosc/faktury')
      .set('Authorization', `Bearer ${token()}`)
      .send(invoicePayload({
        pozycje: [
          { nazwa: 'Niepoprawny rabat', jednostka: 'szt', ilosc: 1, cena_netto: -50, vat_stawka: 23 },
        ],
      }));

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('scopes invoice detail access to the manager branch', async () => {
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const res = await request(app)
      .get('/api/ksiegowosc/faktury/9')
      .set('Authorization', `Bearer ${token()}`);

    expect(res.status).toBe(404);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE i.id=$1 AND i.oddzial_id=$2'),
      [9, 3]
    );
  });

  it('does not update invoice status outside the manager branch', async () => {
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const res = await request(app)
      .put('/api/ksiegowosc/faktury/9/status')
      .set('Authorization', `Bearer ${token()}`)
      .send({ status: 'Oplacona' });

    expect(res.status).toBe(404);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE invoices.id=$2 AND invoices.oddzial_id=$3'),
      ['Oplacona', 9, 3]
    );
  });
});
