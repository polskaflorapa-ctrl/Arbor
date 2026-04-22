const { getProxyTarget, isPortOpen, checkApiHealth } = require("./lib/stack-utils.cjs");

function yesNo(flag) {
  return flag ? "YES" : "NO";
}

function computeSuggestions({ apiOpen, healthOk, webRunning }) {
  const suggestions = [];
  if (!apiOpen || !healthOk) suggestions.push("npm run dev:api");
  if (!webRunning) suggestions.push("npm run dev:web");
  if (webRunning && apiOpen && healthOk) suggestions.push("npm run dev:os (optional)");
  return suggestions;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const jsonMode = args.has("--json");
  const strictMode = args.has("--strict");

  const proxyTarget = getProxyTarget();
  const webOpen = await isPortOpen(3000);
  const apiOpen = await isPortOpen(3001);
  const altWebOpen = await isPortOpen(3002);
  const webRunning = webOpen || altWebOpen;

  const health = await checkApiHealth(proxyTarget);
  const healthOk = health.ok;
  const healthNote = health.note;
  const healthy = webRunning && apiOpen && healthOk;
  const suggestions = computeSuggestions({ apiOpen, healthOk, webRunning });

  if (jsonMode) {
    const payload = {
      healthy,
      proxyTarget,
      ports: {
        web3000: webOpen,
        web3002: altWebOpen,
        api3001: apiOpen,
      },
      apiHealth: {
        ok: health.ok,
        status: health.status,
        note: health.note,
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
  console.info(`[status] WEB port 3002 open : ${yesNo(altWebOpen)} (CRA fallback)`);
  console.info(`[status] API port 3001 open : ${yesNo(apiOpen)}`);
  console.info(`[status] Proxy target       : ${proxyTarget}`);
  console.info(`[status] API health         : ${yesNo(healthOk)}${healthNote ? ` (${healthNote})` : ""}`);
  console.info("[status] -------------------------------");

  for (const suggestion of suggestions) {
    console.info(`[status] Suggested: ${suggestion}`);
  }
}

main().catch((error) => {
  console.error("[status] FAILED:", error.message);
  process.exit(1);
});
