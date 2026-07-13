const request = require('supertest');
const { createApp } = require('../src/app');
const { errorHandler } = require('../src/middleware/error-handler');

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  testConnection: jest.fn().mockResolvedValue(true),
}));

describe('Error response contract', () => {
  const app = createApp();

  it('returns requestId on 404 responses', async () => {
    const res = await request(app).get('/api/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Endpoint nie znaleziony');
    expect(res.body.code).toBe('HTTP_NOT_FOUND');
    expect(typeof res.body.requestId).toBe('string');
    expect(res.body.requestId).toBe(res.headers['x-request-id']);
  });

  it('does not expose internal error details in 5xx responses', () => {
    const req = {
      requestId: 'request-123',
      t: jest.fn().mockReturnValue('Blad serwera'),
      user: { id: 7, login: 'tester', oddzial_id: 3, rola: 'Kierownik' },
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    errorHandler(new Error('password=secret; SELECT * FROM users'), req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Blad serwera',
      code: 'INTERNAL_ERROR',
      requestId: 'request-123',
    });
  });
});
