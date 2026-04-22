const client = require('prom-client');
const { env } = require('./config/env');

const register = new client.Registry();
client.collectDefaultMetrics({ register, prefix: 'arbor_' });

const httpRequestsTotal = new client.Counter({
  name: 'arbor_http_requests_total',
  help: 'Liczba żądań HTTP',
  labelNames: ['method', 'path', 'status'],
  registers: [register],
});

const metricsMiddleware = (req, res, next) => {
  res.on('finish', () => {
    const route = req.route?.path ? `${req.baseUrl || ''}${req.route.path}` : req.path || 'unknown';
    httpRequestsTotal.inc({
      method: req.method,
      path: route,
      status: String(res.statusCode),
    });
  });
  next();
};

const metricsEnabled = () => env.METRICS_ENABLED === true;

module.exports = {
  register,
  metricsMiddleware,
  metricsEnabled,
};
