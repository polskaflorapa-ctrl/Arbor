const { spawn } = require("node:child_process");
const {
  getProxyTarget,
  getProxyPort,
  isLocalProxyTarget,
  isPortOpen,
  checkApiHealth,
  killPortListeners,
} = require("./lib/stack-utils.cjs");

function getForceCleanupPorts(apiPort, localProxy = true) {
  return [...new Set(localProxy ? [3000, 3002, apiPort] : [3000, 3002])];
}

function buildApiStartCommand(apiPort, platform = process.platform) {
  if (apiPort === 3001) return { name: "API", command: "npm run dev:api" };
  return {
    name: "OS",
    command: platform === "win32"
      ? `set PORT=${apiPort}&& npm run dev -w arbor-os`
      : `PORT=${apiPort} npm run dev -w arbor-os`,
  };
}

function buildWebStartCommand() {
  return { name: "WEB", command: "npm run start -w arbor-web -- --port 3002" };
}

async function main() {
  const forceMode = process.argv.includes("--force");
  const proxyTarget = getProxyTarget();
  const apiPort = getProxyPort(proxyTarget);
  const localProxy = isLocalProxyTarget(proxyTarget);
  if (forceMode) {
    const ports = getForceCleanupPorts(apiPort, localProxy);
    console.info(`[up] Force mode enabled: cleaning ports ${ports.join("/")}.`);
    killPortListeners(ports, "up");
  }

  const apiOpen = localProxy ? await isPortOpen(apiPort) : true;
  const webOpen = await isPortOpen(3000);
  const webFallbackOpen = await isPortOpen(3002);
  const webRunning = webOpen || webFallbackOpen;
  const health = await checkApiHealth(proxyTarget);
  const apiHealthy = health.ok;

  console.info("[up] Arbor bring-up");
  console.info(`[up] web:3000 ${webOpen ? "OPEN" : "CLOSED"}`);
  console.info(`[up] web:3002 ${webFallbackOpen ? "OPEN" : "CLOSED"} (Vite dev fallback)`);
  console.info(`[up] api:${apiPort} ${localProxy ? (apiOpen ? "OPEN" : "CLOSED") : "REMOTE"}`);
  console.info(`[up] api health via proxy target (${proxyTarget}): ${apiHealthy ? "OK" : "FAIL"} (${health.note})`);

  const commands = [];
  const names = [];

  if (!localProxy && !apiHealthy) {
    console.info("[up] Remote API target is not healthy. Fix ARBOR_API_PROXY_TARGET or remote backend before starting local stack.");
  } else if (!apiOpen) {
    const apiStart = buildApiStartCommand(apiPort);
    commands.push(apiStart.command);
    names.push(apiStart.name);
  } else if (!apiHealthy) {
    console.info("[up] API port is open but health check fails. Skipping API start (port already occupied).");
  }

  if (!webRunning) {
    const webStart = buildWebStartCommand();
    commands.push(webStart.command);
    names.push(webStart.name);
  }

  if (commands.length === 0) {
    console.info("[up] Nothing to start. Stack already running.");
    console.info("[up] Optional: npm run dev:os");
    return;
  }

  console.info(`[up] Starting: ${names.join(", ")}`);

  const cmd = `npx --yes concurrently -n ${names.join(",")} ${commands.map((c) => `"${c}"`).join(" ")}`;
  const child = spawn(cmd, {
    stdio: "inherit",
    shell: true,
  });

  child.on("exit", (code) => process.exit(code ?? 0));
}

if (require.main === module) {
  main().catch((error) => {
    console.error("[up] FAILED:", error.message);
    process.exit(1);
  });
}

module.exports = {
  buildApiStartCommand,
  buildWebStartCommand,
  getForceCleanupPorts,
};
