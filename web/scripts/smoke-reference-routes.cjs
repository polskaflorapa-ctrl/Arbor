const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const BASE = process.env.ARBOR_WEB_SMOKE_BASE || 'http://localhost:3004';
const PORT = Number(process.env.ARBOR_REFERENCE_SMOKE_CDP_PORT || (9700 + (process.pid % 300)));
const chromePath = process.env.CHROME_PATH ||
  path.join(process.env.LOCALAPPDATA || '', 'ms-playwright', 'chromium-1223', 'chrome-win64', 'chrome.exe');

const routes = [
  { path: '/reference', expect: 'Widoki referencyjne Arbor' },
  { path: '/reference/arbor-os', expect: 'Centrum operacyjne' },
  { path: '/reference/arbor-os-deck', expect: 'Arbor OS porządkuje' },
  { path: '/reference/portal-klienta', expect: 'Pielęgnacja i wycinka' },
  { path: '/reference/gabinet-wyceniajacego', expect: 'Oferta gotowa' },
  { path: '/reference/arbor-mobile', expect: 'MISJA DNIA' },
];

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

function sanitize(name) {
  return name.replace(/^\/+/, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'root';
}

async function main() {
  if (!fs.existsSync(chromePath)) {
    throw new Error(`Chrome not found. Set CHROME_PATH or install bundled Chromium. Looked at: ${chromePath}`);
  }

  await fetch(BASE).catch((error) => {
    throw new Error(`Web app is not reachable at ${BASE}: ${error.message}`);
  });

  const outputDir = path.join(__dirname, '..', '..', 'output', 'reference-smoke');
  fs.mkdirSync(outputDir, { recursive: true });
  const userDataDir = path.join(outputDir, `chrome-${Date.now()}`);
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
      if (data.method === 'Runtime.exceptionThrown' || data.method === 'Log.entryAdded' || data.method === 'Network.responseReceived') {
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

    async function setViewport(viewport) {
      await send('Emulation.setDeviceMetricsOverride', viewport === 'mobile'
        ? { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenWidth: 390, screenHeight: 844 }
        : { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
    }

    async function evaluate(route, expected) {
      const expression = `(() => {
        const text = (document.body?.innerText || '').replace(/\\s+/g, ' ').trim();
        const heading = document.querySelector('h1,h2,[role="heading"]')?.textContent?.trim() || '';
        const clickTargets = [...document.querySelectorAll('button,a,[role="button"]')].map((el) => {
          const r = el.getBoundingClientRect();
          return { text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 80), w: Math.round(r.width), h: Math.round(r.height) };
        });
        const smallTargets = clickTargets.filter((t) => t.w > 0 && t.h > 0 && (t.w < 44 || t.h < 44));
        return {
          route: ${JSON.stringify(route)},
          expected: ${JSON.stringify(expected)},
          hash: location.hash,
          heading,
          textLength: text.length,
          hasExpected: text.includes(${JSON.stringify(expected)}),
          overflowX: document.documentElement.scrollWidth > window.innerWidth + 2,
          smallTargets,
          snippet: text.slice(0, 180),
        };
      })()`;
      const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      return result.result.value;
    }

    async function screenshot(name) {
      const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      const file = path.join(outputDir, `${name}.png`);
      fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
      return file;
    }

    await send('Runtime.enable');
    await send('Log.enable');
    await send('Page.enable');
    await send('Network.enable');

    const results = [];
    const failures = [];

    for (const viewport of ['desktop', 'mobile']) {
      await setViewport(viewport);
      for (const route of routes) {
        const beforeEvents = events.length;
        await send('Page.navigate', { url: `${BASE}/#${route.path}` });
        await sleep(900);
        let result = await evaluate(route.path, route.expect);
        for (let i = 0; i < 8 && (!result.hasExpected || result.textLength < 80); i += 1) {
          await sleep(400);
          result = await evaluate(route.path, route.expect);
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
          .filter((entry) => !entry.includes('favicon'));

        const shot = await screenshot(`${viewport}-${sanitize(route.path)}`);
        const enriched = { ...result, viewport, screenshot: shot, consoleEvents: routeEvents.slice(0, 5) };
        results.push(enriched);

        if (!result.hasExpected || result.textLength < 80 || result.overflowX || result.smallTargets.length > 0 || routeEvents.length > 0) {
          failures.push(enriched);
        }
      }
    }

    const report = { base: BASE, checked: results.length, failures, results };
    const reportPath = path.join(outputDir, 'reference-smoke-results.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));

    if (failures.length > 0) process.exitCode = 1;
  } finally {
    if (ws) ws.close();
    chrome.kill();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
