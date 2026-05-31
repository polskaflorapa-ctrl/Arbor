const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_BASE = process.env.ARBOR_WEB_TTI_BASE || process.env.ARBOR_WEB_SMOKE_BASE || 'http://localhost:5174';
const DEFAULT_THRESHOLD_MS = 3000;
const DEFAULT_ROUTES = ['/dashboard', '/zlecenia', '/kierownik', '/harmonogram', '/bi', '/telefonia', '/integracje'];
const DEFAULT_MOBILE_ROUTES = ['/dashboard', '/zlecenia', '/kierownik'];

function defaultChromePath(env = process.env) {
  return env.CHROME_PATH ||
    path.join(env.LOCALAPPDATA || '', 'ms-playwright', 'chromium-1223', 'chrome-win64', 'chrome.exe');
}

function parseArgs(argv = process.argv.slice(2), env = process.env) {
  const options = {
    baseUrl: env.ARBOR_WEB_TTI_BASE || env.ARBOR_WEB_SMOKE_BASE || DEFAULT_BASE,
    thresholdMs: Number(env.ARBOR_WEB_TTI_THRESHOLD_MS || DEFAULT_THRESHOLD_MS),
    routes: [...DEFAULT_ROUTES],
    mobile: false,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) continue;
    if (arg.startsWith('http://') || arg.startsWith('https://')) {
      options.baseUrl = arg.replace(/\/+$/, '');
    } else if (arg === '--threshold') {
      options.thresholdMs = Number(argv[++index]);
    } else if (arg.startsWith('--threshold=')) {
      options.thresholdMs = Number(arg.split('=')[1]);
    } else if (arg === '--routes') {
      options.routes = splitRoutes(argv[++index]);
    } else if (arg.startsWith('--routes=')) {
      options.routes = splitRoutes(arg.slice('--routes='.length));
    } else if (arg === '--mobile') {
      options.mobile = true;
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isFinite(options.thresholdMs) || options.thresholdMs <= 0) {
    throw new Error('--threshold must be a positive number of milliseconds');
  }
  if (!options.routes.length) {
    throw new Error('--routes must include at least one route');
  }
  options.routes = options.routes.map(normalizeRoute);
  return options;
}

function splitRoutes(value = '') {
  return String(value).split(',').map((route) => route.trim()).filter(Boolean);
}

function normalizeRoute(route) {
  const trimmed = String(route || '').trim();
  if (!trimmed) throw new Error('Route cannot be empty');
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getJson(url, tries = 40) {
  let lastError;
  for (let i = 0; i < tries; i += 1) {
    try {
      const res = await fetch(url);
      if (res.ok) return res.json();
      lastError = new Error(`${res.status} ${res.statusText}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(250);
  }
  throw lastError;
}

function createCdpClient(ws) {
  let id = 0;
  const pending = new Map();
  const events = [];

  ws.onmessage = (message) => {
    const data = JSON.parse(message.data);
    if (data.id && pending.has(data.id)) {
      const { resolve, reject } = pending.get(data.id);
      pending.delete(data.id);
      if (data.error) reject(new Error(data.error.message));
      else resolve(data.result);
      return;
    }
    if (
      data.method === 'Runtime.exceptionThrown' ||
      data.method === 'Log.entryAdded' ||
      data.method === 'Network.responseReceived'
    ) {
      events.push(data);
    }
  };

  function send(method, params = {}, timeoutMs = 15000) {
    const callId = ++id;
    return new Promise((resolve, reject) => {
      pending.set(callId, { resolve, reject });
      ws.send(JSON.stringify({ id: callId, method, params }));
      setTimeout(() => {
        if (pending.has(callId)) {
          pending.delete(callId);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, timeoutMs);
    });
  }

  return { send, events };
}

async function setViewport(send, mobile = false) {
  await send('Emulation.setDeviceMetricsOverride', mobile
    ? {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true,
      screenWidth: 390,
      screenHeight: 844,
    }
    : {
      width: 1440,
      height: 1100,
      deviceScaleFactor: 1,
      mobile: false,
    });
}

function buildAuthScript() {
  const user = {
    id: 9001,
    imie: 'Test',
    nazwisko: 'Dyrektor',
    email: 'dyrektor@test.local',
    rola: 'Dyrektor',
    oddzial_id: 1,
  };
  const permissions = {
    policyVersion: 1,
    taskScope: 'all',
    canViewFinance: true,
    canManageUsers: true,
    canManageBranches: true,
    canViewReports: true,
    canViewAllTasks: true,
    canViewCRM: true,
    canViewHR: true,
    canViewFleet: true,
    canCreateTasks: true,
    canAssignTeams: true,
    canManageTeams: true,
    canViewSettlementModule: true,
    canViewPayrollSettlements: true,
    canManagePayrollSettlements: true,
  };
  return `
    localStorage.setItem('arbor-test-mode', 'true');
    localStorage.setItem('token', 'test_token_tti_smoke');
    localStorage.setItem('user', ${JSON.stringify(JSON.stringify(user))});
    localStorage.setItem('permissions', ${JSON.stringify(JSON.stringify(permissions))});
  `;
}

async function evaluateRoute(send, route) {
  const evaluated = await send('Runtime.evaluate', {
    awaitPromise: true,
    returnByValue: true,
    expression: `(() => {
      const text = document.body?.innerText || '';
      const allText = text.trim();
      const loading = /Ladowanie|Loading/.test(allText);
      const login = /Zaloguj|Login|Password|Haslo/.test(allText);
      const overlay = /Failed to load|Error:|Unhandled Runtime Error|Vite|webpack/i.test(allText);
      return {
        route: ${JSON.stringify(route)},
        hash: location.hash,
        href: location.href,
        heading: document.querySelector('h1,h2,[role="heading"]')?.textContent?.trim() || '',
        textLength: allText.length,
        loading,
        login,
        overlay,
        overflowX: document.body ? document.body.scrollWidth > window.innerWidth + 2 : false,
        tti_ms: Math.round(performance.now()),
        snippet: allText.replace(/\\s+/g, ' ').slice(0, 180),
      };
    })()`,
  });
  return evaluated.result.value;
}

function eventMessages(events) {
  return events
    .map((event) => {
      if (event.method === 'Network.responseReceived') {
        const response = event.params?.response;
        if (response?.status >= 400) return `${response.status} ${response.url}`;
        return '';
      }
      return event.params?.exceptionDetails?.exception?.description || event.params?.entry?.text || '';
    })
    .filter(Boolean)
    .filter((entry) => !entry.includes('[api:test-mode] generic mock fallback'))
    .filter((entry) => !entry.includes('favicon'));
}

async function measureRoute({ send, events, baseUrl, route, thresholdMs, mobile = false, authScript }) {
  const beforeEvents = events.length;
  await send('Runtime.evaluate', { expression: authScript, awaitPromise: true }).catch(() => {});
  await send('Page.navigate', { url: `${baseUrl}/?__tti=${Date.now()}#${route}` });

  let result = await evaluateRoute(send, route);
  const deadline = Date.now() + thresholdMs + 2500;
  while (Date.now() < deadline) {
    if (!result.login && !result.loading && result.textLength >= 40 && !result.overlay) break;
    await sleep(150);
    result = await evaluateRoute(send, route);
  }

  const consoleEvents = eventMessages(events.slice(beforeEvents));
  const failureReasons = [];
  if (result.tti_ms > thresholdMs) failureReasons.push(`tti>${thresholdMs}ms`);
  if (result.login) failureReasons.push('login_screen');
  if (result.loading) failureReasons.push('stuck_loading');
  if (result.textLength < 40) failureReasons.push('blank_or_too_short');
  if (result.overlay) failureReasons.push('framework_overlay');
  if (result.overflowX) failureReasons.push('overflow_x');
  if (consoleEvents.length) failureReasons.push('console_or_network_error');

  return {
    ...result,
    viewport: mobile ? 'mobile' : 'desktop',
    threshold_ms: thresholdMs,
    ok: failureReasons.length === 0,
    failureReasons,
    consoleEvents: consoleEvents.slice(0, 5),
  };
}

async function runTtiSmoke(options = {}, deps = {}) {
  const baseUrl = (options.baseUrl || DEFAULT_BASE).replace(/\/+$/, '');
  const thresholdMs = options.thresholdMs || DEFAULT_THRESHOLD_MS;
  const routes = options.routes || DEFAULT_ROUTES;
  const includeMobile = Boolean(options.mobile);
  const chromePath = deps.chromePath || defaultChromePath();
  const port = deps.port || Number(process.env.ARBOR_WEB_TTI_CDP_PORT || (9700 + (process.pid % 200)));
  const outputPath = deps.outputPath || path.join(__dirname, '..', '..', 'output', 'playwright', 'web-tti-smoke-results.json');

  if (!fs.existsSync(chromePath)) {
    throw new Error(`Chrome not found. Run "npx playwright install chromium" or set CHROME_PATH. Looked at: ${chromePath}`);
  }
  await fetch(baseUrl).catch((error) => {
    throw new Error(`Web app is not reachable at ${baseUrl}: ${error.message}`);
  });

  const userDataDir = path.join(__dirname, '..', '..', 'output', 'playwright', `web-tti-smoke-${Date.now()}`);
  const chrome = spawn(chromePath, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `${baseUrl}/`,
  ], { stdio: 'ignore' });

  let ws;
  try {
    await getJson(`http://127.0.0.1:${port}/json/version`);
    const targets = await getJson(`http://127.0.0.1:${port}/json/list`);
    const pageTarget = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl);
    if (!pageTarget) throw new Error('No page target found in Chrome CDP');

    ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
    await new Promise((resolve) => { ws.onopen = resolve; });
    const { send, events } = createCdpClient(ws);
    const authScript = buildAuthScript();

    await send('Runtime.enable');
    await send('Log.enable');
    await send('Page.enable');
    await send('Network.enable');
    await send('Page.addScriptToEvaluateOnNewDocument', { source: authScript });
    await send('Runtime.evaluate', { expression: authScript, awaitPromise: true });

    const results = [];
    await setViewport(send, false);
    for (const route of routes) {
      results.push(await measureRoute({ send, events, baseUrl, route, thresholdMs, authScript }));
    }

    if (includeMobile) {
      await setViewport(send, true);
      for (const route of DEFAULT_MOBILE_ROUTES) {
        results.push(await measureRoute({ send, events, baseUrl, route, thresholdMs, mobile: true, authScript }));
      }
    }

    const failures = results.filter((result) => !result.ok);
    const slowest = [...results].sort((a, b) => b.tti_ms - a.tti_ms)[0] || null;
    const report = {
      ok: failures.length === 0,
      baseUrl,
      threshold_ms: thresholdMs,
      checked: results.length,
      slowest,
      failures,
      results,
    };

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
    return report;
  } finally {
    if (ws) ws.close();
    chrome.kill();
  }
}

function printUsage() {
  console.log('Usage: npm run smoke:web:tti -- [baseUrl] [--threshold 3000] [--routes /dashboard,/zlecenia] [--mobile] [--json]');
}

if (require.main === module) {
  let options;
  try {
    options = parseArgs();
  } catch (error) {
    console.error(`[smoke-web-tti] FAILED: ${error.message}`);
    printUsage();
    process.exit(1);
  }

  if (options.help) {
    printUsage();
    process.exit(0);
  }

  runTtiSmoke(options)
    .then((report) => {
      if (options.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        console.log(`[smoke-web-tti] base=${report.baseUrl} threshold=${report.threshold_ms}ms checked=${report.checked}`);
        for (const result of report.results) {
          console.log(`[smoke-web-tti] ${result.ok ? 'OK' : 'FAIL'} ${result.viewport} ${result.route} tti=${result.tti_ms}ms heading="${result.heading}"`);
        }
        if (report.slowest) {
          console.log(`[smoke-web-tti] slowest ${report.slowest.viewport} ${report.slowest.route} ${report.slowest.tti_ms}ms`);
        }
        console.log(`[smoke-web-tti] ${report.ok ? 'OK' : 'FAILED'}`);
      }
      if (!report.ok) process.exitCode = 1;
    })
    .catch((error) => {
      console.error(`[smoke-web-tti] FAILED: ${error.message}`);
      process.exit(1);
    });
}

module.exports = {
  DEFAULT_ROUTES,
  DEFAULT_THRESHOLD_MS,
  parseArgs,
  splitRoutes,
  normalizeRoute,
  eventMessages,
  measureRoute,
  runTtiSmoke,
};
