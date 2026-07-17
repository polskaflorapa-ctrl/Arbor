const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const EXPORT_DIR = process.env.ARBOR_DESIGN_EXPORT_DIR ||
  path.join(os.homedir(), 'OneDrive', 'Desktop', 'export');
const OUTPUT_DIR = process.env.ARBOR_DESIGN_BASELINE_DIR ||
  path.join(__dirname, '..', '..', 'output', 'design-export-baselines');
const PORT = Number(process.env.ARBOR_DESIGN_CDP_PORT || (9900 + (process.pid % 80)));
const CHROME_PATH = process.env.CHROME_PATH ||
  path.join(process.env.LOCALAPPDATA || '', 'ms-playwright', 'chromium-1223', 'chrome-win64', 'chrome.exe');

const exportsToCapture = [
  'Arbor OS.html',
  'Arbor Mobile.html',
  'Arbor OS Deck.html',
  'Gabinet Wyceniajacego.html',
  'Portal Klienta.html',
];

const viewports = {
  desktop: { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false },
  mobile: {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
    screenWidth: 390,
    screenHeight: 844,
  },
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getJson(url, tries = 60) {
  let lastError;
  for (let attempt = 0; attempt < tries; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
      lastError = new Error(String(response.status) + ' ' + response.statusText);
    } catch (error) {
      lastError = error;
    }
    await sleep(250);
  }
  throw lastError;
}

function slug(filename) {
  return path.basename(filename, path.extname(filename))
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

async function main() {
  if (!fs.existsSync(CHROME_PATH)) {
    throw new Error('Chromium not found: ' + CHROME_PATH);
  }

  const missing = exportsToCapture.filter((filename) =>
    !fs.existsSync(path.join(EXPORT_DIR, filename)));
  if (missing.length) {
    throw new Error('Missing design exports in ' + EXPORT_DIR + ': ' + missing.join(', '));
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const profileDir = path.join(OUTPUT_DIR, 'chrome-' + Date.now());
  const chrome = spawn(CHROME_PATH, [
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + profileDir,
    '--headless=new',
    '--disable-gpu',
    '--disable-background-networking',
    '--disable-extensions',
    '--allow-file-access-from-files',
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ], { stdio: 'ignore' });

  let socket;
  try {
    await getJson('http://127.0.0.1:' + PORT + '/json/version');
    const targets = await getJson('http://127.0.0.1:' + PORT + '/json/list');
    const page = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl);
    if (!page) throw new Error('No page target found');

    socket = new WebSocket(page.webSocketDebuggerUrl);
    const pending = new Map();
    let callId = 0;
    socket.onmessage = (message) => {
      const data = JSON.parse(message.data);
      if (!data.id || !pending.has(data.id)) return;
      const request = pending.get(data.id);
      pending.delete(data.id);
      if (data.error) request.reject(new Error(data.error.message));
      else request.resolve(data.result);
    };
    await new Promise((resolve) => { socket.onopen = resolve; });

    function send(method, params = {}) {
      const id = ++callId;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
        setTimeout(() => {
          if (!pending.has(id)) return;
          pending.delete(id);
          reject(new Error('CDP timeout: ' + method));
        }, 30000);
      });
    }

    await send('Page.enable');
    await send('Runtime.enable');

    const captures = [];
    for (const [viewportName, viewport] of Object.entries(viewports)) {
      await send('Emulation.setDeviceMetricsOverride', viewport);
      for (const filename of exportsToCapture) {
        const sourcePath = path.join(EXPORT_DIR, filename);
        await send('Page.navigate', { url: pathToFileURL(sourcePath).href });

        let state = null;
        for (let attempt = 0; attempt < 80; attempt += 1) {
          await sleep(250);
          const evaluation = await send('Runtime.evaluate', {
            expression: [
              '(() => ({',
              'ready: document.readyState,',
              'thumbnail: Boolean(document.querySelector("#__bundler_thumbnail")),',
              'loading: Boolean(document.querySelector("#__bundler_loading")),',
              'error: document.querySelector("#__bundler_err")?.textContent || "",',
              'textLength: (document.body?.innerText || "").trim().length,',
              'title: document.title',
              '}))()',
            ].join(''),
            returnByValue: true,
          });
          state = evaluation.result.value;
          if (!state.thumbnail && !state.loading && state.textLength > 120) break;
        }

        if (!state || state.thumbnail || state.loading || state.error) {
          throw new Error('Export did not render: ' + filename + ' ' + JSON.stringify(state));
        }

        await sleep(500);
        const shot = await send('Page.captureScreenshot', {
          format: 'png',
          captureBeyondViewport: false,
        });
        const screenshot = path.join(
          OUTPUT_DIR,
          viewportName + '-' + slug(filename) + '.png',
        );
        fs.writeFileSync(screenshot, Buffer.from(shot.data, 'base64'));
        captures.push({
          filename,
          viewport: viewportName,
          screenshot,
          textLength: state.textLength,
          title: state.title,
        });
      }
    }

    const reportPath = path.join(OUTPUT_DIR, 'report.json');
    fs.writeFileSync(reportPath, JSON.stringify({
      exportDir: EXPORT_DIR,
      generatedAt: new Date().toISOString(),
      captures,
    }, null, 2));
    console.log(JSON.stringify({ reportPath, captures }, null, 2));
  } finally {
    if (socket) socket.close();
    chrome.kill();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
