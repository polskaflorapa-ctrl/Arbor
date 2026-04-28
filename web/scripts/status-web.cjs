const net = require('node:net');

const API_PORTS = [3001, 3003, 3010];
const WEB_PORTS = [3002, 3004, 3012];

function isPortListening(port, host = '127.0.0.1', timeoutMs = 700) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const done = (ok) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(port, host);
  });
}

async function isApiHealthy(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, { method: 'GET' });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    return data;
  } catch {
    return null;
  }
}

async function isWebHealthy(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}`, { method: 'GET' });
    return res.ok;
  } catch {
    return false;
  }
}

async function detectApi() {
  for (const port of API_PORTS) {
    if (!(await isPortListening(port))) continue;
    const health = await isApiHealthy(port);
    if (health) return { running: true, port, url: `http://localhost:${port}/api`, health };
  }
  return { running: false, port: null, url: null, health: null };
}

async function detectWeb() {
  for (const port of WEB_PORTS) {
    if (!(await isPortListening(port))) continue;
    const ok = await isWebHealthy(port);
    if (ok) return { running: true, port, url: `http://localhost:${port}` };
  }
  return { running: false, port: null, url: null };
}

async function main() {
  const api = await detectApi();
  const web = await detectWeb();

  const status = {
    timestamp: new Date().toISOString(),
    api,
    web,
    proxyTargetHint: api.running ? api.url : null,
  };

  const jsonMode = process.argv.includes('--json');
  if (jsonMode) {
    process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
    process.exit(api.running && web.running ? 0 : 1);
    return;
  }

  console.log('[status:web]');
  if (api.running) {
    console.log(`- API: OK (${api.url})`);
  } else {
    console.log(`- API: DOWN (checked ports: ${API_PORTS.join(', ')})`);
  }
  if (web.running) {
    console.log(`- WEB: OK (${web.url})`);
  } else {
    console.log(`- WEB: DOWN (checked ports: ${WEB_PORTS.join(', ')})`);
  }
  if (api.running) {
    console.log(`- Proxy target hint: ${api.url}`);
  }

  process.exit(api.running && web.running ? 0 : 1);
}

main().catch((err) => {
  console.error('[status:web] Failed:', err.message || err);
  process.exit(1);
});
