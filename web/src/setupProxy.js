const { createProxyMiddleware } = require('http-proxy-middleware');

/**
 * CRA dev: przekierowuje `/api` na backend (domyślnie :3001).
 * Ustaw w `.env.local` np. ARBOR_API_PROXY_TARGET=http://localhost:3003
 * gdy API działa na innym porcie.
 */
module.exports = function setupProxy(app) {
  const target =
    process.env.ARBOR_API_PROXY_TARGET ||
    process.env.REACT_APP_DEV_PROXY_TARGET ||
    'http://localhost:3001';

  // Widoczne w terminalu `npm start` — przy 502/504 sprawdź, czy ten host faktycznie działa.
  console.info('[setupProxy] CRA /api ->', target);

  app.use(
    '/api',
    createProxyMiddleware({
      target,
      changeOrigin: true,
    })
  );
};
