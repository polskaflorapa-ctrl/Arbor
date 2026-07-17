import { spawn } from 'node:child_process';

const apiPort = process.env.ARBOR_API_PORT || '8790';
const webPort = process.env.ARBOR_WEB_PORT || '5175';
const apiUrl = process.env.VITE_ARBOR_API_URL || `http://127.0.0.1:${apiPort}`;

const commands = [
  ['api', 'node', ['server/index.mjs'], { ARBOR_API_PORT: apiPort }],
  ['web', 'npx', ['vite', '--host', '127.0.0.1', '--port', webPort], { VITE_ARBOR_API_URL: apiUrl }],
];

let shuttingDown = false;
const children = new Array(commands.length);

// Uruchamia proces i AUTO-RESTARTUJE go po nieoczekiwanym zakończeniu (odporność dev).
function start(index) {
  const [name, cmd, args, env] = commands[index];
  const child = spawn(cmd, args, { stdio: ['inherit', 'pipe', 'pipe'], shell: true, env: { ...process.env, ...env } });
  child.stdout.on('data', (chunk) => process.stdout.write(`[${name}] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[${name}] ${chunk}`));
  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    process.stderr.write(`[${name}] zakończony (code=${code}, signal=${signal}) — restart za 1s\n`);
    setTimeout(() => { if (!shuttingDown) children[index] = start(index); }, 1000);
  });
  children[index] = child;
  return child;
}

commands.forEach((_, index) => start(index));

function shutdown() {
  shuttingDown = true;
  children.forEach((child) => {
    try { child?.kill(); } catch { /* proces mógł już zniknąć */ }
  });
  process.exit();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
