const { getProxyTarget, isPortOpen, checkApiHealth, formatPortListeners, getPortListeners } = require("./lib/stack-utils.cjs");

async function main() {
  const proxyTarget = getProxyTarget();
  const apiPortOpen = await isPortOpen(3001);
  const webPortOpen = await isPortOpen(3000);
  const webFallbackPortOpen = await isPortOpen(3002);
  const webRunning = webPortOpen || webFallbackPortOpen;

  console.info("[doctor] Arbor local diagnostics");
  console.info(`[doctor] web:3000 ${webPortOpen ? "OPEN" : "CLOSED"}`);
  console.info(`[doctor] web:3002 ${webFallbackPortOpen ? "OPEN" : "CLOSED"} (Vite dev fallback)`);
  console.info(`[doctor] api:3001 ${apiPortOpen ? "OPEN" : "CLOSED"}`);
  console.info(`[doctor] proxy target: ${proxyTarget}`);

  const health = await checkApiHealth(proxyTarget);
  const healthOk = health.ok;
  console.info(`[doctor] api health: ${healthOk ? "OK" : "FAIL"} (${health.note})`);
  const apiPortListeners = apiPortOpen && !healthOk ? getPortListeners(3001) : [];
  if (apiPortListeners.length > 0) {
    console.info(`[doctor] api:3001 listener: ${formatPortListeners(apiPortListeners)}`);
  }

  console.info("");
  if (!apiPortOpen) {
    console.info("[doctor] Next: npm run dev:api");
  } else if (!healthOk && apiPortListeners.length > 0) {
    console.info("[doctor] Next: free port 3001 or set web/.env.local ARBOR_API_PROXY_TARGET to the running Arbor API");
  } else if (!healthOk) {
    console.info("[doctor] Next: npm run dev:api");
  }
  if (!webRunning) {
    console.info("[doctor] Next: npm run dev:web");
  }
  if (apiPortOpen && webRunning && healthOk) {
    console.info("[doctor] Everything looks healthy. Next: npm run dev:os (optional)");
  }
}

main().catch((error) => {
  console.error("[doctor] FAILED:", error.message);
  process.exit(1);
});
