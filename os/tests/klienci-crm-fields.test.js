const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
}));

const pool = require('../src/config/database');
const klienciRoutes = require('../src/routes/klienci');
const { createTestApp } = require('./helpers/create-test-app');
const { env } = require('../src/config/env');

const app = createTestApp('/api/klienci', klienciRoutes);
const token = jwt.sign({ id: 9, rola: 'Kierownik', oddzial_id: 7 }, env.JWT_SECRET);

describe('Klienci CRM fields', () => {
  beforeEach(() => {
    pool.query.mockReset();
    pool.query.mockImplementation(async (sql, params = []) => {
      const text = String(sql);
      if (text.includes('CREATE TABLE') || text.includes('CREATE INDEX') || text.includes('ALTER TABLE')) {
        return { rows: [], rowCount: 0 };
      }
      if (text.includes('INSERT INTO klienci')) {
        return {
          rows: [{
            id: 12,
            imie: params[0],
            telefon: params[3],
            segment: params[10],
            tags: JSON.parse(params[11]),
            custom_fields: JSON.parse(params[12]),
          }],
          rowCount: 1,
        };
      }
      if (text.includes('SELECT k.*') && text.includes('FROM klienci k')) {
        return {
          rows: [{
            id: 12,
            imie: 'Anna',
            telefon: '+48500100200',
            segment: 'VIP',
            tags: ['premium'],
            custom_fields: { Budzet: '12000' },
          }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });
  });

  it('stores tags, segment and custom fields', async () => {
    const res = await request(app)
      .post('/api/klienci')
      .set('Authorization', `Bearer ${token}`)
      .send({
        imie: 'Anna',
        telefon: '+48500100200',
        segment: 'VIP',
        tags: ['premium', 'premium', 'ogrod'],
        custom_fields: { Budzet: '12000', Kanal: 'WhatsApp' },
      });

    expect(res.status).toBe(201);
    expect(res.body).toEqual(expect.objectContaining({
      segment: 'VIP',
      tags: ['premium', 'ogrod'],
      custom_fields: { Budzet: '12000', Kanal: 'WhatsApp' },
    }));
  });

  it('filters client list by segment and tag', async () => {
    const res = await request(app)
      .get('/api/klienci?segment=VIP&tag=premium')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    const listQuery = pool.query.mock.calls.find(([sql]) => String(sql).includes('SELECT k.*'));
    expect(String(listQuery[0])).toContain('k.segment =');
    expect(String(listQuery[0])).toContain('k.tags ?');
    expect(listQuery[1]).toEqual(['VIP', 'premium']);
  });
});
