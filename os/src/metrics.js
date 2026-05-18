const client = require('prom-client');
const { env } = require('./config/env');

const register = new client.Registry();
client.collectDefaultMetrics({ register, prefix: 'arbor_' });

// ─── Counters ─────────────────────────────────────────────────────────────────

const httpRequestsTotal = new client.Counter({
  name: 'arbor_http_requests_total',
  help: 'Liczba żądań HTTP',
  labelNames: ['method', 'path', 'status'],
  registers: [register],
});

// ─── Latency histogram ───────────────────────────────────────────────────────

const httpDurationSeconds = new client.Histogram({
  name: 'arbor_http_duration_seconds',
  help: 'Czas odpowiedzi HTTP w sekundach',
  labelNames: ['method', 'path', 'status'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

// ─── DB pool gauge ───────────────────────────────────────────────────────────

const dbPoolTotal = new client.Gauge({
  name: 'arbor_db_pool_total',
  help: 'Łączna liczba połączeń w puli',
  registers: [register],
});
const dbPoolIdle = new client.Gauge({
  name: 'arbor_db_pool_idle',
  help: 'Liczba wolnych połączeń w puli',
  registers: [register],
});
const dbPoolWaiting = new client.Gauge({
  name: 'arbor_db_pool_waiting',
  help: 'Liczba zapytań oczekujących na połączenie',
  registers: [register],
});

/**
 * Call this after pool is created: bindPoolMetrics(pool)
 * Updates gauges every 15 seconds.
 */
function bindPoolMetrics(pool) {
  const update = () => {
    dbPoolTotal.set(pool.totalCount || 0);
    dbPoolIdle.set(pool.idleCount || 0);
    dbPoolWaiting.set(pool.waitingCount || 0);
  };
  update();
  setInterval(update, 15_000);
}

// ─── Middleware ───────────────────────────────────────────────────────────────

const metricsMiddleware = (req, res, next) => {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const route = req.route?.path ? `${req.baseUrl || ''}${req.route.path}` : req.path || 'unknown';
    const labels = { method: req.method, path: route, status: String(res.statusCode) };
    httpRequestsTotal.inc(labels);
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    httpDurationSeconds.observe(labels, durationMs / 1000);
  });
  next();
};

const metricsEnabled = () => env.METRICS_ENABLED === true;

module.exports = {
  register,
  metricsMiddleware,
  metricsEnabled,
  bindPoolMetrics,
};
