const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');
const pool = require('./config/database');
const { env } = require('./config/env');

const { requestContext } = require('./middleware/request-context');
const { localeMiddleware } = require('./middleware/locale');
const { errorHandler, notFoundHandler } = require('./middleware/error-handler');
const { authMiddleware } = require('./middleware/auth');
const { blockPayrollSettlements } = require('./middleware/payroll-policy');
const { costlyApiLimiter } = require('./middleware/rate-limit');
const { register, metricsMiddleware, metricsEnabled } = require('./metrics');
const { HTTP_NOT_FOUND } = require('./constants/error-codes');

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
const smsRoutes = require('./routes/sms');
const telefonRoutes = require('./routes/telefon');
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

const createApp = () => {
  const app = express();
  const uploadsDir = path.join(__dirname, 'uploads');
  const allowedOrigins = env.CORS_ORIGINS
    ? env.CORS_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean)
    : ['*'];
  const isWildcardCors = allowedOrigins.includes('*');

  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  app.use(requestContext);
  app.use(localeMiddleware);
  if (metricsEnabled()) {
    app.use(metricsMiddleware);
  }
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(
    cors({
      origin: isWildcardCors ? true : allowedOrigins,
      credentials: !isWildcardCors,
    })
  );
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));
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
        res.sendFile(abs);
      };
    };
    /** Jedna obsługa — bez przekierowania 301 (unika pętli / konfliktu z trailing slash). */
    app.get(['/app', '/app/', '/app/index.html'], sendPanelFile('index.html'));
    app.get('/app/styles.css', sendPanelFile('styles.css'));
    app.get('/app/app.js', sendPanelFile('app.js'));
    app.use('/app', express.static(webAppDir, { index: false }));
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
  app.use('/api/sms', costlyApiLimiter, smsRoutes);
  app.use('/api/telefon/webhooks', telefonWebhooksRoutes);
  app.use('/api/telefon', costlyApiLimiter, telefonRoutes);
  app.use('/api/pdf', costlyApiLimiter, pdfRoutes);
  app.use('/api/cmr', cmrRoutes);
  app.use('/api/mobile', mobileRoutes);
  app.use('/api/raporty-dzienne', raportyDzienneRoutes);
  app.use('/api/audit', auditRoutes);
  app.use('/api/dashboard', dashboardRoutes);
  app.use('/api/automations', automationsRoutes);
  app.use('/api/ops', opsRoutes);
  app.use('/api/crm', crmRoutes);
  app.use('/api/public', quotationPublicRoutes);
  app.use('/api/webhooks', kommoQuotationWebhookRoutes);
  app.use('/api/quotations', quotationsRoutes);
  app.use('/api/payroll', payrollRoutes);

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
      wersja: '2.1.0',
      requestId: req.requestId,
    });
  });

  app.get('/api/db-test', async (req, res, next) => {
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
    app.get('/api/metrics', async (req, res) => {
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

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};

module.exports = { createApp };
