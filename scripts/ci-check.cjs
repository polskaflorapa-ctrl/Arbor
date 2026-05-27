const { spawnSync } = require("node:child_process");
const { checkApiHealth, getProxyTarget, httpPostJson } = require("./lib/stack-utils.cjs");

function runStep(command, args) {
  const res = spawnSync(command, args, { stdio: "inherit", shell: true });
  if (res.status !== 0) {
    throw new Error(`Step failed: ${command} ${args.join(" ")}`);
  }
}

async function smokeLogin(proxyTarget) {
  const loginUrl = new URL("/api/auth/login", proxyTarget).toString();
  const response = await httpPostJson(loginUrl, { login: "oleg", haslo: "oleg" }, 3000);

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Smoke login failed with status ${response.status}: ${response.body}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(response.body);
  } catch {
    throw new Error(`Smoke login returned non-JSON: ${response.body}`);
  }

  if (!parsed?.token) {
    throw new Error(`Smoke login missing token: ${response.body}`);
  }
}

async function main() {
  console.info("[ci:check] Step 1/3: status strict");
  runStep("npm", ["run", "status:json:strict"]);

  console.info("[ci:check] Step 2/3: health");
  runStep("npm", ["run", "health"]);

  console.info("[ci:check] Step 3/3: api smoke");
  const proxyTarget = getProxyTarget();
  const health = await checkApiHealth(proxyTarget);
  if (!health.ok) {
    throw new Error(`Health smoke failed with status ${health.status}: ${health.note}${health.body ? ` ${health.body}` : ""}`);
  }
  await smokeLogin(proxyTarget);

  console.info("[ci:check] OK");
}

main().catch((error) => {
  console.error("[ci:check] FAILED:", error.message);
  process.exit(1);
});
