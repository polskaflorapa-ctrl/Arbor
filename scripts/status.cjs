const {
  getProxyTarget,
  getProxyPort,
  isLocalProxyTarget,
  isPortOpen,
  checkApiHealth,
  formatPortListeners,
  getPortListeners,
} = require("./lib/stack-utils.cjs");

function yesNo(flag) {
  return flag ? "YES" : "NO";
}

function computeSuggestions({ apiOpen, apiPort, healthOk, webRunning, apiPortListeners = [], localProxy = true }) {
  const suggestions = [];
  if (!localProxy && !healthOk) {
    suggestions.push("check remote ARBOR_API_PROXY_TARGET or switch web/.env.local back to a local API");
  } else if (!apiOpen) {
    suggestions.push(`start Arbor API on port ${apiPort} or update web/.env.local ARBOR_API_PROXY_TARGET`);
  } else if (!healthOk && apiPortListeners.length > 0) {
    suggestions.push(`free port ${apiPort} or set web/.env.local ARBOR_API_PROXY_TARGET to the running Arbor API`);
  } else if (!healthOk) {
    suggestions.push("npm run dev:api");
  }
  if (!webRunning) suggestions.push("npm run dev:web");
  if (webRunning && apiOpen && healthOk) suggestions.push("npm run dev:os (optional)");
  return suggestions;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const jsonMode = args.has("--json");
  const strictMode = args.has("--strict");

  const proxyTarget = getProxyTarget();
  const apiPort = getProxyPort(proxyTarget);
  const localProxy = isLocalProxyTarget(proxyTarget);
  const webOpen = await isPortOpen(3000);
  const apiOpen = localProxy ? await isPortOpen(apiPort) : true;
  const altWebOpen = await isPortOpen(3002);
  const webRunning = webOpen || altWebOpen;

  const health = await checkApiHealth(proxyTarget);
  const healthOk = health.ok;
  const healthNote = health.note;
  const healthy = webRunning && apiOpen && healthOk;
  const apiPortListeners = localProxy && apiOpen && !healthOk ? getPortListeners(apiPort) : [];
  const suggestions = computeSuggestions({ apiOpen, apiPort, healthOk, webRunning, apiPortListeners, localProxy });

  if (jsonMode) {
    const payload = {
      healthy,
      proxyTarget,
      proxyIsLocal: localProxy,
      ports: {
        web3000: webOpen,
        web3002: altWebOpen,
        [`api${apiPort}`]: apiOpen,
      },
      apiHealth: {
        ok: health.ok,
        status: health.status,
        note: health.note,
        portListeners: apiPortListeners,
      },
      suggestions,
    };
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    if (strictMode && !healthy) {
      process.exit(1);
    }
    return;
  }

  console.info("[status] Arbor stack");
  console.info("[status] -------------------------------");
  console.info(`[status] WEB port 3000 open : ${yesNo(webOpen)}`);
  console.info(`[status] WEB port 3002 open : ${yesNo(altWebOpen)} (Vite dev fallback)`);
  console.info(`[status] API port ${apiPort} open : ${yesNo(apiOpen)}`);
  if (apiPortListeners.length > 0) {
    console.info(`[status] API port listener : ${formatPortListeners(apiPortListeners)}`);
  }
  console.info(`[status] Proxy target       : ${proxyTarget}`);
  console.info(`[status] API health         : ${yesNo(healthOk)}${healthNote ? ` (${healthNote})` : ""}`);
  console.info("[status] -------------------------------");

  for (const suggestion of suggestions) {
    console.info(`[status] Suggested: ${suggestion}`);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error("[status] FAILED:", error.message);
    process.exit(1);
  });
}

module.exports = {
  computeSuggestions,
};
