const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const BASE = process.env.ARBOR_WEB_SMOKE_BASE || 'http://localhost:5174';
const PORT = Number(process.env.ARBOR_WEB_SMOKE_CDP_PORT || (9200 + (process.pid % 500)));
const chromePath = process.env.CHROME_PATH ||
  path.join(process.env.LOCALAPPDATA || '', 'ms-playwright', 'chromium-1223', 'chrome-win64', 'chrome.exe');

const routes = [
  '/dashboard',
  '/eksploruj',
  '/zlecenia',
  '/harmonogram',
  '/kierownik',
  '/auto-dispatch',
  '/mapa-live',
  '/ekipy',
  '/potwierdzenia-ekip',
  '/flota',
  '/magazyn',
  '/rezerwacje-sprzetu',
  '/kalendarz-zasobow',
  '/crm',
  '/crm/dashboard',
  '/crm/pipeline',
  '/crm/inbox',
  '/klienci',
  '/telefonia',
  '/integracje',
  '/wyceniajacy-hub',
  '/wycena-kalendarz',
  '/wyceny-terenowe',
  '/zatwierdz-wyceny',
  '/ogledziny',
  '/ogledziny-dokumentacja',
  '/raporty',
  '/raporty/analityka',
  '/raporty/dzienny',
  '/raporty/mobilne',
  '/raporty/kpi-tydzien',
  '/misja-dnia',
  '/autoplan-dnia',
  '/bi',
  '/hr',
  '/kadry-dokumenty',
  '/rozliczenia-ekip',
  '/rozliczenia-polowe',
  '/wynagrodzenie-wyceniajacych',
  '/ksiegowosc',
  '/uzytkownicy',
  '/oddzialy',
  '/zarzadzaj-rolami',
  '/profil',
  '/powiadomienia',
  '/zadania',
  '/arbor-os-spec',
];

const criticalMobileRoutes = [
  '/dashboard',
  '/crm/inbox',
  '/zlecenia',
  '/mapa-live',
  '/telefonia',
  '/rozliczenia-polowe',
  '/rozliczenia-ekip',
];

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

async function main() {
  if (!fs.existsSync(chromePath)) {
    throw new Error(`Chrome not found. Run "npx playwright install chromium" or set CHROME_PATH. Looked at: ${chromePath}`);
  }

  await fetch(BASE).catch((error) => {
    throw new Error(`Web app is not reachable at ${BASE}: ${error.message}`);
  });

  const userDataDir = path.join(__dirname, '..', '..', 'output', 'playwright', `web-route-smoke-${Date.now()}`);
  const chrome = spawn(chromePath, [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${userDataDir}`,
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `${BASE}/`,
  ], { stdio: 'ignore' });

  let ws;
  try {
    await getJson(`http://127.0.0.1:${PORT}/json/version`);
    const targets = await getJson(`http://127.0.0.1:${PORT}/json/list`);
    const pageTarget = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl);
    if (!pageTarget) throw new Error('No page target found in Chrome CDP');

    ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
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

    await new Promise((resolve) => { ws.onopen = resolve; });

    function send(method, params = {}) {
      const callId = ++id;
      return new Promise((resolve, reject) => {
        pending.set(callId, { resolve, reject });
        ws.send(JSON.stringify({ id: callId, method, params }));
        setTimeout(() => {
          if (pending.has(callId)) {
            pending.delete(callId);
            reject(new Error(`CDP timeout: ${method}`));
          }
        }, 15000);
      });
    }

    async function evaluateRoute(route) {
      const evaluated = await send('Runtime.evaluate', {
        awaitPromise: true,
        returnByValue: true,
        expression: `(() => {
          const text = document.body?.innerText || '';
          const frameText = [...document.querySelectorAll('iframe')]
            .map((frame) => {
              try { return frame.contentDocument?.body?.innerText || ''; } catch { return ''; }
            }).join(' ');
          const allText = [text, frameText].join(' ').trim();
          return {
            route: ${JSON.stringify(route)},
            hash: location.hash,
            href: location.href,
            heading: document.querySelector('h1,h2,[role="heading"]')?.textContent?.trim() || '',
            textLength: allText.length,
            login: /Zaloguj|Login|Password|Haslo/.test(allText),
            loading: /Ładowanie|Ladowanie|Loading/i.test(allText),
            overflowX: document.body ? document.body.scrollWidth > window.innerWidth + 2 : false,
            snippet: allText.replace(/\\s+/g, ' ').slice(0, 180),
          };
        })()`,
      });
      return evaluated.result.value;
    }

    await send('Runtime.enable');
    await send('Log.enable');
    await send('Page.enable');
    await send('Network.enable');
    async function setViewport({ mobile = false } = {}) {
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

    const authScript = `
      localStorage.setItem('arbor-test-mode', 'true');
      localStorage.setItem('token', 'test_token_route_smoke');
      localStorage.setItem('user', ${JSON.stringify(JSON.stringify(user))});
      localStorage.setItem('permissions', ${JSON.stringify(JSON.stringify(permissions))});
    `;
    await send('Page.addScriptToEvaluateOnNewDocument', { source: authScript });
    await send('Runtime.evaluate', { expression: authScript, awaitPromise: true });

    await setViewport();

    const results = [];
    const failures = [];

    async function checkRoute(route, { mobile = false } = {}) {
      const beforeEvents = events.length;
      await send('Runtime.evaluate', { expression: authScript, awaitPromise: true }).catch(() => {});
      await send('Page.navigate', { url: `${BASE}/#${route}` });

      await sleep(700);
      let result = await evaluateRoute(route);
      for (let i = 0; i < 20; i += 1) {
        if (result.login || (result.textLength >= 40 && !result.loading)) break;
        await sleep(500);
        result = await evaluateRoute(route);
      }

      const routeEvents = events.slice(beforeEvents)
        .map((event) => {
          if (event.method === 'Network.responseReceived') {
            const response = event.params?.response;
            if (response?.status >= 400) return `${response.status} ${response.url}`;
            return '';
          }
          return event.params?.exceptionDetails?.exception?.description || event.params?.entry?.text || '';
        })
        .filter(Boolean)
        .filter((entry) => !entry.includes('[api:test-mode] generic mock fallback'));

      const enriched = {
        ...result,
        viewport: mobile ? 'mobile' : 'desktop',
        consoleEvents: routeEvents.slice(0, 5),
      };
      results.push(enriched);

      if (result.login || result.textLength < 40 || result.overflowX || routeEvents.some((entry) => !entry.includes('favicon'))) {
        failures.push(enriched);
      }
    }

    await setViewport();
    for (const route of routes) {
      await checkRoute(route);
    }

    await setViewport({ mobile: true });
    for (const route of criticalMobileRoutes) {
      await checkRoute(route, { mobile: true });
    }

    const report = {
      base: BASE,
      checked: results.length,
      desktopRoutes: routes.length,
      mobileRoutes: criticalMobileRoutes.length,
      failures,
      results,
    };
    const outPath = path.join(__dirname, '..', '..', 'output', 'playwright', 'web-route-smoke-results.json');
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));

    if (failures.length > 0) {
      process.exitCode = 1;
    }
  } finally {
    if (ws) ws.close();
    chrome.kill();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
