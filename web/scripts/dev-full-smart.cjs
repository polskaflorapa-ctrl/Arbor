const { spawn } = require('node:child_process');
const net = require('node:net');

const CANDIDATE_PORTS = [3001, 3003, 3010];
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

async function isArborApiHealthy(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, { method: 'GET' });
    return res.ok;
  } catch {
    return false;
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

function spawnWithPrefix(command, options, prefix) {
  const child = spawn(command, { ...options, shell: true });
  if (child.stdout) {
    child.stdout.on('data', (chunk) => process.stdout.write(`[${prefix}] ${chunk}`));
  }
  if (child.stderr) {
    child.stderr.on('data', (chunk) => process.stderr.write(`[${prefix}] ${chunk}`));
  }
  return child;
}

async function chooseApiPlan() {
  for (const port of CANDIDATE_PORTS) {
    if (!(await isPortListening(port))) continue;
    if (await isArborApiHealthy(port)) {
      return { mode: 'reuse', port };
    }
  }

  for (const port of CANDIDATE_PORTS) {
    if (!(await isPortListening(port))) {
      return { mode: 'start', port };
    }
  }

  throw new Error(
    `No free fallback API ports. Checked: ${CANDIDATE_PORTS.join(', ')}.`
  );
}

async function chooseWebPlan() {
  for (const port of WEB_PORTS) {
    if (!(await isPortListening(port))) continue;
    if (await isWebHealthy(port)) {
      return { mode: 'reuse', port };
    }
  }
  for (const port of WEB_PORTS) {
    if (!(await isPortListening(port))) return { mode: 'start', port };
  }
  throw new Error(`No free fallback WEB ports. Checked: ${WEB_PORTS.join(', ')}.`);
}

async function main() {
  const plan = await chooseApiPlan();
  const webPlan = await chooseWebPlan();
  const apiTarget = `http://localhost:${plan.port}`;
  const children = [];
  let shuttingDown = false;

  const stopAll = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    for (const c of children) {
      if (!c.killed) c.kill();
    }
  };
  process.on('SIGINT', stopAll);
  process.on('SIGTERM', stopAll);

  if (plan.mode === 'reuse') {
    console.info(`[dev:full] Reusing API on ${apiTarget}`);
  } else {
    console.info(`[dev:full] Starting API on ${apiTarget}`);
    const apiEnv = { ...process.env, PORT: String(plan.port) };
    const api = spawnWithPrefix('npm --prefix server start', { cwd: process.cwd(), env: apiEnv }, 'API');
    children.push(api);
    api.on('exit', (code) => {
      if (shuttingDown) return;
      console.error(`[dev:full] API exited with code ${code ?? 0}`);
      stopAll();
      process.exit(code ?? 1);
    });
  }

  if (webPlan.mode === 'reuse') {
    console.info(`[dev:full] Reusing WEB on http://localhost:${webPlan.port}`);
    if (plan.mode === 'reuse') return;
  } else {
    const webEnv = {
      ...process.env,
      PORT: String(webPlan.port),
      ARBOR_API_PROXY_TARGET: apiTarget,
    };
    console.info(
      `[dev:full] Starting WEB on http://localhost:${webPlan.port} with proxy target ${apiTarget}`
    );
    const web = spawnWithPrefix('npm start', { cwd: process.cwd(), env: webEnv }, 'WEB');
    children.push(web);
    web.on('exit', (code) => {
      if (shuttingDown) return;
      console.error(`[dev:full] WEB exited with code ${code ?? 0}`);
      stopAll();
      process.exit(code ?? 1);
    });
  }
}

main().catch((err) => {
  console.error('[dev:full] Failed to start stack:', err.message || err);
  process.exit(1);
});
