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
const mobileRoutes = require('../src/routes/mobile');
const { createTestApp } = require('./helpers/create-test-app');
const { env } = require('../src/config/env');
const { INVOICE_NUMBER_LOCK_NAMESPACE } = require('../src/services/invoices');

describe('Mobile invoices', () => {
  const app = createTestApp('/api/mobile', mobileRoutes);
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
      klient_nazwa: 'Firma Mobile',
      klient_adres: 'Polna 2, Warszawa',
      klient_email: 'mobile@example.test',
      data_wystawienia: '2026-07-10',
      data_sprzedazy: '2026-07-10',
      forma_platnosci: 'przelew',
      pozycje: [
        { nazwa: 'Wycinka', jednostka: 'usl', ilosc: 1, cena_netto: 250, vat_stawka: 23 },
      ],
      ...overrides,
    };
  }

  it('returns the same 404 for a missing or cross-branch invoice', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ exists: true }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .get('/api/mobile/faktury/9')
      .set('Authorization', `Bearer ${token()}`);

    expect(res.status).toBe(404);
    expect(pool.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('WHERE i.id=$1 AND i.oddzial_id=$2'),
      [9, 3]
    );
    expect(pool.query.mock.calls.some(([sql]) => String(sql).includes('FROM invoice_items'))).toBe(false);
  });

  it('allows directors to load an invoice without a branch predicate', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ exists: true }] })
      .mockResolvedValueOnce({ rows: [{ id: 9, oddzial_id: 8, numer: 'FV/2026/009' }] })
      .mockResolvedValueOnce({ rows: [{ exists: true }] })
      .mockResolvedValueOnce({ rows: [{ id: 1, invoice_id: 9 }] });

    const res = await request(app)
      .get('/api/mobile/faktury/9')
      .set('Authorization', `Bearer ${token({ rola: 'Dyrektor', oddzial_id: null })}`);

    expect(res.status).toBe(200);
    expect(pool.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('WHERE i.id=$1'),
      [9]
    );
    expect(String(pool.query.mock.calls[1][0])).not.toContain('WHERE i.id=$1 AND i.oddzial_id');
  });

  it('does not reveal or update a cross-branch invoice status', async () => {
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const res = await request(app)
      .put('/api/mobile/faktury/9/status')
      .set('Authorization', `Bearer ${token()}`)
      .send({ status: 'Oplacona' });

    expect(res.status).toBe(404);
    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE invoices.id=$2 AND invoices.oddzial_id=$3'),
      ['Oplacona', 9, 3]
    );
  });

  it('allows directors to update invoice status globally', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 9 }], rowCount: 1 });

    const res = await request(app)
      .put('/api/mobile/faktury/9/status')
      .set('Authorization', `Bearer ${token({ rola: 'Prezes', oddzial_id: null })}`)
      .send({ status: 'Oplacona' });

    expect(res.status).toBe(200);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE invoices.id=$2'),
      ['Oplacona', 9]
    );
    expect(String(pool.query.mock.calls[0][0])).not.toContain('invoices.oddzial_id');
  });

  it('allocates a global yearly number with the transaction client', async () => {
    client.query.mockImplementation(async (sql) => {
      const statement = String(sql).trim();
      if (statement.includes('AS last_number')) return { rows: [{ last_number: 4 }] };
      if (statement.startsWith('INSERT INTO invoices')) return { rows: [{ id: 90 }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });

    const res = await request(app)
      .post('/api/mobile/faktury')
      .set('Authorization', `Bearer ${token({ oddzial_id: 8 })}`)
      .send(invoicePayload());

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, id: 90, numer: 'FV/2026/005' });
    expect(pool.query).not.toHaveBeenCalled();
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
      expect.arrayContaining(['FV/2026/005', null, 8, 11, 'Firma Mobile'])
    );

    const statements = client.query.mock.calls.map(([sql]) => String(sql));
    expect(statements.indexOf('BEGIN')).toBeLessThan(statements.indexOf('SELECT pg_advisory_xact_lock($1, $2)'));
    expect(statements.indexOf('SELECT pg_advisory_xact_lock($1, $2)')).toBeLessThan(
      statements.findIndex((sql) => sql.includes('AS last_number'))
    );
    expect(statements.at(-1)).toBe('COMMIT');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('does not expose database errors from mobile invoice creation', async () => {
    client.query.mockImplementation(async (sql) => {
      const statement = String(sql).trim();
      if (statement.includes('AS last_number')) return { rows: [{ last_number: 0 }] };
      if (statement.startsWith('INSERT INTO invoices')) {
        throw new Error('sensitive invoices constraint details');
      }
      return { rows: [], rowCount: 1 };
    });

    const res = await request(app)
      .post('/api/mobile/faktury')
      .set('Authorization', `Bearer ${token()}`)
      .send(invoicePayload());

    expect(res.status).toBe(500);
    expect(res.body.error).toBeTruthy();
    expect(res.body.error).not.toContain('sensitive invoices constraint details');
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.query).not.toHaveBeenCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});
