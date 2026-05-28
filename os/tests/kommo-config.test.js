const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
}));

const pool = require('../src/config/database');
const { env } = require('../src/config/env');
const { createTestApp } = require('./helpers/create-test-app');
const { router, DEFAULT_KOMMO_MAPPING } = require('../src/routes/kommoConfig');

const app = createTestApp('/api/kommo', router);

function token(role, oddzialId = 3) {
  return jwt.sign({ id: 11, rola: role, oddzial_id: oddzialId }, env.JWT_SECRET);
}

function setupPool({ selectRows = [], upsertRow = null } = {}) {
  pool.query.mockImplementation(async (sql) => {
    const text = String(sql);
    if (text.includes('CREATE TABLE IF NOT EXISTS kommo_account_mappings')) {
      return { rows: [], rowCount: 0 };
    }
    if (text.includes('CREATE INDEX IF NOT EXISTS idx_kommo_account_mappings_account')) {
      return { rows: [], rowCount: 0 };
    }
    if (text.includes('SELECT id, account_key, status_map, field_aliases, options, updated_at, updated_by')) {
      return { rows: selectRows, rowCount: selectRows.length };
    }
    if (text.includes('INSERT INTO kommo_account_mappings')) {
      const row = upsertRow || {
        account_key: 'default',
        status_map: {},
        field_aliases: {},
        options: {},
      };
      return { rows: [row], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });
}

describe('Kommo config API', () => {
  beforeEach(() => {
    pool.query.mockReset();
  });

  test('GET /api/kommo/config returns 401 without token', async () => {
    const res = await request(app).get('/api/kommo/config');
    expect(res.status).toBe(401);
  });

  test('GET /api/kommo/config returns default mapping fallback for Kierownik', async () => {
    setupPool({ selectRows: [] });

    const res = await request(app)
      .get('/api/kommo/config')
      .set('Authorization', `Bearer ${token('Kierownik')}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({
      account_key: 'default',
      status_map: expect.objectContaining(DEFAULT_KOMMO_MAPPING.status_map),
      field_aliases: expect.objectContaining(DEFAULT_KOMMO_MAPPING.field_aliases),
      options: expect.objectContaining(DEFAULT_KOMMO_MAPPING.options),
    }));
  });

  test('GET /api/kommo/config merges database row with defaults', async () => {
    setupPool({
      selectRows: [{
        account_key: 'account-a',
        status_map: { do_realizacji: 'Zaplanowane' },
        field_aliases: { klient_nazwa: ['nazwa leada'] },
        options: { auto_geocode: false },
      }],
    });

    const res = await request(app)
      .get('/api/kommo/config?account_key=account-a')
      .set('Authorization', `Bearer ${token('Dyrektor')}`);

    expect(res.status).toBe(200);
    expect(res.body.account_key).toBe('account-a');
    expect(res.body.status_map.do_realizacji).toBe('Zaplanowane');
    expect(res.body.options.auto_geocode).toBe(false);
    expect(res.body.options.save_remote_attachments_as_documents).toBe(true);
  });

  test('PUT /api/kommo/config upserts config for Dyrektor', async () => {
    setupPool({
      upsertRow: {
        account_key: 'account-b',
        status_map: { zakonczone: 'Zakonczone' },
        field_aliases: { klient_email: ['mail', 'email'] },
        options: { copy_attachment_binaries_to_storage: true },
      },
    });

    const res = await request(app)
      .put('/api/kommo/config')
      .set('Authorization', `Bearer ${token('Dyrektor')}`)
      .send({
        account_key: 'account-b',
        status_map: { zakonczone: 'Zakonczone' },
        field_aliases: { klient_email: ['mail', 'email'] },
        options: { copy_attachment_binaries_to_storage: true },
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({
      account_key: 'account-b',
      status_map: expect.objectContaining({ zakonczone: 'Zakonczone' }),
      field_aliases: expect.objectContaining({ klient_email: ['mail', 'email'] }),
      options: expect.objectContaining({ copy_attachment_binaries_to_storage: true }),
    }));
  });

  test('PUT /api/kommo/config rejects invalid payload', async () => {
    setupPool();

    const res = await request(app)
      .put('/api/kommo/config')
      .set('Authorization', `Bearer ${token('Dyrektor')}`)
      .send({
        account_key: '',
        status_map: { lead: '' },
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Niepoprawna konfiguracja Kommo');
  });

  test('PUT /api/kommo/config returns 403 for Kierownik', async () => {
    setupPool();

    const res = await request(app)
      .put('/api/kommo/config')
      .set('Authorization', `Bearer ${token('Kierownik')}`)
      .send({ account_key: 'x' });

    expect(res.status).toBe(403);
  });
});
