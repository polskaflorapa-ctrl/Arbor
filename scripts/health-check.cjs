const { getProxyTarget, httpGet } = require("./lib/stack-utils.cjs");

async function main() {
  const target = getProxyTarget();
  const healthUrl = new URL("/api/health", target).toString();

  console.info(`[health] proxy target: ${target}`);
  console.info(`[health] checking: ${healthUrl}`);

  const response = await httpGet(healthUrl);
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Health check failed with status ${response.status}: ${response.body}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(response.body);
  } catch {
    throw new Error(`Invalid JSON from health endpoint: ${response.body}`);
  }

  if (!parsed || parsed.ok !== true) {
    throw new Error(`Unexpected health payload: ${response.body}`);
  }

  console.info(`[health] OK (${parsed.service || "unknown-service"})`);
}

main().catch((error) => {
  console.error("[health] FAILED:", error.message);
  process.exit(1);
});
