const { checkApiHealth, getProxyTarget } = require("./lib/stack-utils.cjs");

async function main() {
  const target = getProxyTarget();
  const healthUrl = new URL("/api/health", target).toString();

  console.info(`[health] proxy target: ${target}`);
  console.info(`[health] checking: ${healthUrl}`);

  const result = await checkApiHealth(target);
  if (!result.ok) {
    const detail = result.payload ? JSON.stringify(result.payload) : result.body || result.note;
    throw new Error(`Health check failed with status ${result.status}: ${detail}`);
  }

  console.info(`[health] OK (${result.note})`);
}

main().catch((error) => {
  console.error("[health] FAILED:", error.message);
  process.exit(1);
});
