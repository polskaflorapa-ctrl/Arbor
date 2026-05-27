const { spawnSync } = require("node:child_process");
const { checkApiHealth, getProxyTarget, httpPostJson } = require("./lib/stack-utils.cjs");

function buildStepInvocation(command, args, platform = process.platform) {
  if (platform === "win32") {
    return { command: process.env.ComSpec || "cmd.exe", args: ["/d", "/s", "/c", command, ...args] };
  }
  return { command, args };
}

function runStep(command, args, deps = {}) {
  const spawnSyncImpl = deps.spawnSync || spawnSync;
  const invocation = buildStepInvocation(command, args, deps.platform || process.platform);
  const res = spawnSyncImpl(invocation.command, invocation.args, { stdio: "inherit" });
  if (res.error) {
    throw new Error(`Step failed: ${command} ${args.join(" ")} (${res.error.message})`);
  }
  if (res.status !== 0) {
    throw new Error(`Step failed: ${command} ${args.join(" ")}`);
  }
}

async function smokeLogin(proxyTarget, deps = {}) {
  const httpPostJsonImpl = deps.httpPostJson || httpPostJson;
  const loginUrl = new URL("/api/auth/login", proxyTarget).toString();
  const response = await httpPostJsonImpl(loginUrl, { login: "oleg", haslo: "oleg" }, 3000);

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

async function main(deps = {}) {
  const runStepImpl = deps.runStep || runStep;
  const getProxyTargetImpl = deps.getProxyTarget || getProxyTarget;
  const checkApiHealthImpl = deps.checkApiHealth || checkApiHealth;
  const smokeLoginImpl = deps.smokeLogin || smokeLogin;

  console.info("[ci:check] Step 1/3: status strict");
  runStepImpl("npm", ["run", "status:json:strict"]);

  console.info("[ci:check] Step 2/3: health");
  runStepImpl("npm", ["run", "health"]);

  console.info("[ci:check] Step 3/3: api smoke");
  const proxyTarget = getProxyTargetImpl();
  const health = await checkApiHealthImpl(proxyTarget);
  if (!health.ok) {
    throw new Error(`Health smoke failed with status ${health.status}: ${health.note}${health.body ? ` ${health.body}` : ""}`);
  }
  await smokeLoginImpl(proxyTarget);

  console.info("[ci:check] OK");
}

if (require.main === module) {
  main().catch((error) => {
    console.error("[ci:check] FAILED:", error.message);
    process.exit(1);
  });
}

module.exports = {
  buildStepInvocation,
  runStep,
  smokeLogin,
  main,
};
