const request = require('supertest');

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  testConnection: jest.fn().mockResolvedValue(true),
}));

const { createApp } = require('../src/app');

describe('Quotations API mount', () => {
  const app = createApp();

  it.each([
    '/api/quotations',
    '/api/quotations/panel/do-przypisania',
    '/api/quotations/panel/moje-zatwierdzenia',
    '/api/quotations/norms/service-times',
  ])('mounts %s behind auth instead of returning 404', async (path) => {
    const res = await request(app).get(path);

    expect([401, 403]).toContain(res.status);
  });
});
