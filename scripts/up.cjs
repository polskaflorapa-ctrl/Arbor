const { spawn } = require("node:child_process");
const { getProxyTarget, isPortOpen, checkApiHealth, killPortListeners } = require("./lib/stack-utils.cjs");

async function main() {
  const forceMode = process.argv.includes("--force");
  if (forceMode) {
    console.info("[up] Force mode enabled: cleaning ports 3000/3001/3002.");
    killPortListeners([3000, 3001, 3002], "up");
  }

  const proxyTarget = getProxyTarget();
  const apiOpen = await isPortOpen(3001);
  const webOpen = await isPortOpen(3000);
  const webFallbackOpen = await isPortOpen(3002);
  const webRunning = webOpen || webFallbackOpen;
  const health = await checkApiHealth(proxyTarget);
  const apiHealthy = health.ok;

  console.info("[up] Arbor bring-up");
  console.info(`[up] web:3000 ${webOpen ? "OPEN" : "CLOSED"}`);
  console.info(`[up] web:3002 ${webFallbackOpen ? "OPEN" : "CLOSED"} (CRA fallback)`);
  console.info(`[up] api:3001 ${apiOpen ? "OPEN" : "CLOSED"}`);
  console.info(`[up] api health via proxy target (${proxyTarget}): ${apiHealthy ? "OK" : "FAIL"} (${health.note})`);

  const commands = [];
  const names = [];

  if (!apiOpen) {
    commands.push("npm run dev:api");
    names.push("API");
  } else if (!apiHealthy) {
    console.info("[up] API port is open but health check fails. Skipping API start (port already occupied).");
  }

  if (!webRunning) {
    commands.push("npm run dev:web");
    names.push("WEB");
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

main().catch((error) => {
  console.error("[up] FAILED:", error.message);
  process.exit(1);
});
