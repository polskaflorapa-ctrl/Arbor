/**
 * Smoke tests — SSE /api/notifications/stream endpoint.
 *
 * EventSource auth uses ?token= (no Authorization header support in SSE).
 * We test:
 *   - no token → 401
 *   - bad/expired token → 401
 *   - valid token → 200 + text/event-stream header + initial :ok ping
 *
 * The SSE connection stays open, so we use a raw http.get() call,
 * capture the first chunk, then abort — no supertest for the happy path.
 */

const http = require('http');
const jwt = require('jsonwebtoken');

jest.mock('../src/config/database', () => ({
  query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  connect: jest.fn(),
  testConnection: jest.fn().mockResolvedValue(true),
}));

const { createApp } = require('../src/app');
const { env } = require('../src/config/env');

const app = createApp();

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Start a real HTTP server on a random port, return { server, port }. */
function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port });
    });
  });
}

function stopServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

function validToken(overrides = {}) {
  return jwt.sign({ id: 7, rola: 'Brygadzista', oddzial_id: 2, ...overrides }, env.JWT_SECRET);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GET /api/notifications/stream (SSE)', () => {
  let server, port;

  beforeAll(async () => {
    ({ server, port } = await startServer());
  });

  afterAll(async () => {
    await stopServer(server);
  });

  // ── Auth failures (close immediately, easy to test) ───────────────────────

  it('401 when no token', (done) => {
    const req = http.get(`http://127.0.0.1:${port}/api/notifications/stream`, (res) => {
      expect(res.statusCode).toBe(401);
      req.destroy();
      done();
    });
    req.on('error', done);
  });

  it('401 when token is not a valid JWT', (done) => {
    const req = http.get(
      `http://127.0.0.1:${port}/api/notifications/stream?token=not-a-real-token`,
      (res) => {
        expect(res.statusCode).toBe(401);
        req.destroy();
        done();
      }
    );
    req.on('error', done);
  });

  it('401 for expired token', (done) => {
    const expired = jwt.sign(
      { id: 1, rola: 'Dyrektor' },
      env.JWT_SECRET,
      { expiresIn: '-1s' }
    );
    const req = http.get(
      `http://127.0.0.1:${port}/api/notifications/stream?token=${encodeURIComponent(expired)}`,
      (res) => {
        expect(res.statusCode).toBe(401);
        req.destroy();
        done();
      }
    );
    req.on('error', done);
  });

  // ── Happy path: valid token → SSE stream opens ───────────────────────────

  it('200 + text/event-stream for valid JWT (any role)', (done) => {
    const token = validToken();
    const req = http.get(
      `http://127.0.0.1:${port}/api/notifications/stream?token=${encodeURIComponent(token)}`,
      (res) => {
        expect(res.statusCode).toBe(200);
        expect(res.headers['content-type']).toMatch(/text\/event-stream/);
        expect(res.headers['cache-control']).toMatch(/no-cache/);
        expect(res.headers['x-accel-buffering']).toBe('no');

        // Capture the initial :ok ping, then abort
        let buf = '';
        res.on('data', (chunk) => {
          buf += chunk.toString();
          if (buf.includes(':ok')) {
            req.destroy();
            done();
          }
        });
      }
    );
    req.on('error', (err) => {
      // ECONNRESET is expected when we destroy the connection ourselves
      if (err.code === 'ECONNRESET') return done();
      done(err);
    });
  });

  it('200 for Dyrektor token — same SSE path, no role restriction', (done) => {
    const token = validToken({ rola: 'Dyrektor', oddzial_id: null });
    const req = http.get(
      `http://127.0.0.1:${port}/api/notifications/stream?token=${encodeURIComponent(token)}`,
      (res) => {
        expect(res.statusCode).toBe(200);
        req.destroy();
        done();
      }
    );
    req.on('error', (err) => {
      if (err.code === 'ECONNRESET') return done();
      done(err);
    });
  });
});
