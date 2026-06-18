const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');
const pool = require('./config/database');
const { env } = require('./config/env');
const { getUploadsRoot } = require('./config/uploadPaths');
const { API_VERSION, API_FEATURES } = require('./config/version');

const { requestContext } = require('./middleware/request-context');
const { localeMiddleware } = require('./middleware/locale');
const { errorHandler, notFoundHandler } = require('./middleware/error-handler');
const { authMiddleware } = require('./middleware/auth');
const { auditMiddleware } = require('./middleware/audit');
const { blockPayrollSettlements } = require('./middleware/payroll-policy');
const { costlyApiLimiter, publicTokenLimiter, webhookLimiter } = require('./middleware/rate-limit');
const { register, metricsMiddleware, metricsEnabled, bindPoolMetrics } = require('./metrics');
const { HTTP_NOT_FOUND } = require('./constants/error-codes');
const { assertProductionSecurityConfig } = require('./config/security-hardening');

const { getSentry } = require('./config/sentry');

const authRoutes = require('./routes/auth');
const tasksRoutes = require('./routes/tasks');
const uzytkownicyRoutes = require('./routes/uzytkownicy');
const oddzialyRoutes = require('./routes/oddzialy');
const ekipyRoutes = require('./routes/ekipy');
const flotaRoutes = require('./routes/flota');
const notificationsRoutes = require('./routes/notifications');
const raportyRoutes = require('./routes/raporty');
const wycenyRoutes = require('./routes/wyceny');
const klienciRoutes = require('./routes/klienci');
const ogledzinyRoutes = require('./routes/ogledziny');
const godzinyRoutes = require('./routes/godziny');
const roleRoutes = require('./routes/role');
const ksiegowoscRoutes = require('./routes/ksiegowosc');
const aiRoutes = require('./routes/ai');
const rozliczeniaRoutes = require('./routes/rozliczenia');
const smsWebhooksRoutes = require('./routes/sms-webhooks');
const smsRoutes = require('./routes/sms');
const telefonRoutes = require('./routes/telefon');
const telephonyRoutes = require('./routes/telephony');
const telefonWebhooksRoutes = require('./routes/telefon-webhooks');
const pdfRoutes = require('./routes/pdf');
const { router: cmrRoutes } = require('./routes/cmr');
const mobileRoutes = require('./routes/mobile');
const raportyDzienneRoutes = require('./routes/raporty-dzienne');
const auditRoutes = require('./routes/audit');
const dashboardRoutes = require('./routes/dashboard');
const automationsRoutes = require('./routes/automations');
const opsRoutes = require('./routes/ops');
const crmRoutes = require('./routes/crm');
const quotationsRoutes = require('./routes/quotations');
const payrollRoutes = require('./routes/payroll');
const quotationPublicRoutes = require('./routes/quotation-public');
const kommoQuotationWebhookRoutes = require('./routes/kommoQuotationWebhook');
const { router: kommoConfigRoutes } = require('./routes/kommoConfig');
const crmWebhooksRoutes = require('./routes/crmWebhooks');
const dispatchRoutes = require('./routes/dispatch');
const biRoutes = require('./routes/bi');
const hrRoutes = require('./routes/hr');
const trackRoutes = require('./routes/track');
const demoRequestsRoutes = require('./routes/demoRequests');
const magazynRoutes = require('./routes/magazyn');

const createApp = () => {
  assertProductionSecurityConfig(env);

  const app = express();
  const uploadsDir = getUploadsRoot();
  const allowedOrigins = env.CORS_ORIGINS
    ? env.CORS_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean)
    : ['*'];
  const isWildcardCors = allowedOrigins.includes('*');

  // Konfiguracja zaufania do reverse-proxy (Render / nginx / Cloudflare).
  // Bez tego express-rate-limit i ręczne `req.ip` wskazują na proxy zamiast klienta —
  // wszystkie żądania trafiają do jednego bucketa. Liczba 1 = ufaj jednemu hopowi.
  // Steruj przez ENV `TRUST_PROXY` (numer / "true" / "false") — dev domyślnie wyłączony.
  const trustProxyEnv = (process.env.TRUST_PROXY || '').trim();
  if (trustProxyEnv) {
    const asNumber = Number(trustProxyEnv);
    if (!Number.isNaN(asNumber)) {
      app.set('trust proxy', asNumber);
    } else if (trustProxyEnv === 'true' || trustProxyEnv === 'false') {
      app.set('trust proxy', trustProxyEnv === 'true');
    } else {
      app.set('trust proxy', trustProxyEnv);
    }
  } else if (env.NODE_ENV === 'production') {
    app.set('trust proxy', 1);
  }

  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  app.use(requestContext);
  app.use(localeMiddleware);
  app.use(auditMiddleware);
  if (metricsEnabled()) {
    app.use(metricsMiddleware);
    bindPoolMetrics(pool);
  }
  const cspDirectives = {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
    styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
    imgSrc: ["'self'", 'data:', 'https:', 'blob:'],
    connectSrc: ["'self'", 'https:', 'wss:'],
    mediaSrc: ["'self'", 'data:', 'https:', 'blob:'],
    frameSrc: ["'self'"],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
    frameAncestors: ["'none'"],
    upgradeInsecureRequests: env.NODE_ENV === 'production' ? [] : null,
  };

  const csp = Object.entries(cspDirectives)
    .filter(([, v]) => v !== null)
    .map(([k, v]) => `${k.replace(/([A-Z])/g, '-$1').toLowerCase()} ${v.join(' ')}`)
    .join('; ');

  app.use(helmet({
    contentSecurityPolicy: env.NODE_ENV === 'production' ? { directives: cspDirectives } : false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }));

  app.use((req, res, next) => {
    if (env.NODE_ENV === 'production') {
      res.setHeader('Content-Security-Policy', csp);
    }
    next();
  });
  app.use(
    cors({
      origin: isWildcardCors ? true : allowedOrigins,
      credentials: !isWildcardCors,
    })
  );
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));
  const blockPrivateUploads =
    env.PUBLIC_UPLOADS_BLOCK_PRIVATE ?? env.NODE_ENV === 'production';
  const privateUploadFolders = new Set(['tasks', 'task-documents']);
  app.use('/uploads', (req, res, next) => {
    const firstSegment = String(req.path || '')
      .replace(/^\/+/, '')
      .split('/')[0];
    if (blockPrivateUploads && privateUploadFolders.has(firstSegment)) {
      return res.status(404).json({
        error: req.t('errors.http.notFound'),
        code: HTTP_NOT_FOUND,
        requestId: req.requestId,
      });
    }
    return next();
  });
  app.use('/uploads', express.static(uploadsDir));

  /** Panel WWW — jawne trasy (Express czasem inaczej mapuje mount + index niż oczekiwane). */
  const webAppCandidates = [
    path.resolve(__dirname, '..', 'public', 'app'),
    path.resolve(process.cwd(), 'public', 'app'),
  ];
  const webAppDir = webAppCandidates.find((d) => fs.existsSync(path.join(d, 'index.html')));
  if (webAppDir) {
    const sendPanelFile = (relativeName) => {
      const abs = path.join(webAppDir, relativeName);
      return (req, res, next) => {
        if (!fs.existsSync(abs)) return next();
        res.sendFile(abs, { dotfiles: 'allow' });
      };
    };
    /** Jedna obsługa — bez przekierowania 301 (unika pętli / konfliktu z trailing slash). */
    app.get(['/app', '/app/', '/app/index.html'], sendPanelFile('index.html'));
    app.get('/app/styles.css', sendPanelFile('styles.css'));
    app.get('/app/app.js', sendPanelFile('app.js'));
    app.use('/app', express.static(webAppDir, { index: false, dotfiles: 'allow' }));
  } else {
    console.warn('[ARBOR-OS] Panel /app/ wylaczony: nie znaleziono public/app/index.html (sprawdz cwd i strukture repo).');
  }

  app.use('/api/auth', authRoutes);
  app.use('/api/tasks', tasksRoutes);
  app.use('/api/uzytkownicy', uzytkownicyRoutes);
  app.use('/api/oddzialy', oddzialyRoutes);
  app.use('/api/ekipy', ekipyRoutes);
  app.use('/api/flota', flotaRoutes);
  app.use('/api/notifications', notificationsRoutes);
  app.use('/api/raporty', raportyRoutes);
  app.use('/api/wyceny', wycenyRoutes);
  app.use('/api/klienci', klienciRoutes);
  app.use('/api/ogledziny', ogledzinyRoutes);
  app.use('/api/godziny', godzinyRoutes);
  app.use('/api/role', roleRoutes);
  app.use('/api/ksiegowosc', ksiegowoscRoutes);
  app.use('/api/ai', costlyApiLimiter, aiRoutes);
  app.use('/api/ekipy/rozliczenie', authMiddleware, blockPayrollSettlements);
  app.use('/api/rozliczenia', rozliczeniaRoutes);
  app.use('/api/sms/webhooks', webhookLimiter, smsWebhooksRoutes);
  app.use('/api/sms', costlyApiLimiter, smsRoutes);
  app.use('/api/telefon/webhooks', webhookLimiter, telefonWebhooksRoutes);
  app.use('/api/telefon', costlyApiLimiter, telefonRoutes);
  app.use('/api/telephony', telephonyRoutes);
  app.use('/api/pdf', costlyApiLimiter, pdfRoutes);
  app.use('/api/cmr', cmrRoutes);
  app.use('/api/mobile', mobileRoutes);
  app.use('/api/raporty-dzienne', raportyDzienneRoutes);
  app.use('/api/audit', auditRoutes);
  app.use('/api/dashboard', dashboardRoutes);
  app.use('/api/automations', automationsRoutes);
  app.use('/api/ops', opsRoutes);
  app.use('/api/crm', crmRoutes);
  app.use('/api/dispatch', dispatchRoutes);
  app.use('/api/bi', biRoutes);
  app.use('/api/hr', hrRoutes);
  app.use('/api/magazyn', magazynRoutes);
  // Alias: KadryDokumenty.js calls /api/position-cards — serve from hr router
  app.use('/api/position-cards', hrRoutes);
  app.use('/api/public', publicTokenLimiter, quotationPublicRoutes);
  app.use('/api/webhooks/crm', webhookLimiter, crmWebhooksRoutes);
  app.use('/api/kommo', kommoConfigRoutes);
  app.use('/api/webhooks', webhookLimiter, kommoQuotationWebhookRoutes);
  app.use('/api/quotations', quotationsRoutes);
  app.use('/api/payroll', payrollRoutes);
  app.use('/api/demo-requests', costlyApiLimiter, demoRequestsRoutes);

  // Public client-facing tracking page (no auth) — linked from SMS
  app.use('/track', publicTokenLimiter, trackRoutes);

  // Mobile remote-config — returns app/branch feature flags.
  // Accepts optional Bearer auth; returns empty config if none configured yet.
  app.get('/api/mobile-config', (req, res) => {
    res.setHeader('X-Api-Version', API_VERSION);
    res.json({});
  });
  app.get('/api/config/mobile', (req, res) => {
    res.setHeader('X-Api-Version', API_VERSION);
    res.json({});
  });

  app.get('/', (req, res) => {
    res.json({
      status: 'ok',
      service: 'arbor-os',
      docs: '/api/docs/openapi.yaml',
      health: '/api/ready',
      requestId: req.requestId,
    });
  });

  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      czas: new Date().toISOString(),
      wersja: API_VERSION,
      features: API_FEATURES,
      requestId: req.requestId,
    });
  });

  // /api/db-test — diagnostyczny, w produkcji tylko z prawidłowym JWT.
  // W dev/test domyślnie otwarty dla wygody (można wymusić auth `DB_TEST_REQUIRE_AUTH=true`).
  const dbTestRequireAuth =
    env.NODE_ENV === 'production' || String(process.env.DB_TEST_REQUIRE_AUTH || '').toLowerCase() === 'true';
  const dbTestHandlers = dbTestRequireAuth ? [authMiddleware] : [];
  app.get('/api/db-test', ...dbTestHandlers, async (req, res, next) => {
    try {
      const result = await pool.query('SELECT NOW() as time');
      res.json({ success: true, time: result.rows[0].time, requestId: req.requestId });
    } catch (error) {
      next(error);
    }
  });

  const openApiPath = path.join(__dirname, '../docs/openapi.yaml');
  app.get('/api/docs/openapi.yaml', (req, res) => {
    if (!fs.existsSync(openApiPath)) {
      return res.status(404).json({
        error: req.t('errors.http.notFound'),
        code: HTTP_NOT_FOUND,
        requestId: req.requestId,
      });
    }
    res.type('text/yaml; charset=utf-8').send(fs.readFileSync(openApiPath, 'utf8'));
  });

  if (metricsEnabled()) {
    // /api/metrics — domyślnie chronione tokenem `METRICS_TOKEN`
    // (nagłówek `Authorization: Bearer <token>` lub `?token=`).
    // Brak tokena w env = w produkcji odmowa, w dev open (z ostrzeżeniem).
    const metricsToken = (process.env.METRICS_TOKEN || '').trim();
    app.get('/api/metrics', async (req, res) => {
      if (metricsToken) {
        const headerAuth = String(req.headers.authorization || '');
        const headerToken = headerAuth.startsWith('Bearer ') ? headerAuth.slice(7).trim() : '';
        const queryToken = String(req.query?.token || '').trim();
        if (headerToken !== metricsToken && queryToken !== metricsToken) {
          return res.status(401).type('text/plain').send('Unauthorized');
        }
      } else if (env.NODE_ENV === 'production') {
        return res.status(401).type('text/plain').send('Unauthorized: METRICS_TOKEN not configured');
      }
      res.setHeader('Content-Type', register.contentType);
      res.end(await register.metrics());
    });
  }

  app.get('/api/ready', async (req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({
        status: 'ready',
        database: 'up',
        requestId: req.requestId,
      });
    } catch {
      res.status(503).json({
        status: 'not_ready',
        database: 'down',
        error: 'Database unavailable',
        requestId: req.requestId,
      });
    }
  });

  app.get('/api/live', authMiddleware, (req, res) => {
    res.json({
      status: 'alive',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      requestId: req.requestId,
    });
  });

  const sentry = getSentry();
  if (sentry) {
    app.use(sentry.Handlers.errorHandler({
      shouldHandleError() {
        return env.NODE_ENV === 'production' || env.NODE_ENV === 'staging';
      },
    }));
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};

module.exports = { createApp };
