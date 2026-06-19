const { resolveCurrentGitBuild, runRenderUnifiedLiveSmoke } = require("./render-unified-live-smoke.cjs");

const VALUE_ARGS = new Set(["--timeout-ms", "--wait-attempts", "--wait-interval-ms", "--expected-build"]);
const BOOLEAN_ARGS = new Set(["--dry-run", "--wait", "--any-build", "--help", "-h"]);

function validateArgs(argv = []) {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!String(arg).startsWith("-")) continue;
    if (VALUE_ARGS.has(arg)) {
      const value = argv[index + 1];
      if (!value || String(value).startsWith("-")) {
        throw new Error(`Missing value for ${arg}`);
      }
      index += 1;
      continue;
    }
    const eqIndex = String(arg).indexOf("=");
    if (eqIndex > 0 && VALUE_ARGS.has(String(arg).slice(0, eqIndex))) continue;
    if (BOOLEAN_ARGS.has(arg)) continue;
    throw new Error(`Unknown argument: ${arg}`);
  }
}

function parseArgs(argv = process.argv.slice(2)) {
  validateArgs(argv);
  const valueAfter = (flag, fallback) => {
    const equalsArg = argv.find((arg) => arg.startsWith(`${flag}=`));
    if (equalsArg) return equalsArg.slice(flag.length + 1);
    const index = argv.indexOf(flag);
    return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
  };

  return {
    dryRun: argv.includes("--dry-run"),
    wait: argv.includes("--wait"),
    timeoutMs: Number(valueAfter("--timeout-ms", 30000)),
    waitAttempts: Number(valueAfter("--wait-attempts", 12)),
    waitIntervalMs: Number(valueAfter("--wait-interval-ms", 10000)),
    expectedBuild: argv.includes("--any-build") ? "" : valueAfter("--expected-build", resolveCurrentGitBuild()),
    anyBuild: argv.includes("--any-build"),
    help: argv.includes("--help") || argv.includes("-h"),
  };
}

function printHelp() {
  console.log(`Usage: node scripts/render-redeploy-web.cjs [options]

Options:
  --dry-run                 Validate the Render deploy hook without triggering it
  --wait                    Wait for live web/API smoke after triggering redeploy
  --expected-build <sha>    Require the live web build marker to match this value
  --any-build               Skip exact live web build marker matching
  --timeout-ms <ms>         HTTP timeout for deploy hook and live smoke checks
  --wait-attempts <count>   Number of live smoke polling attempts
  --wait-interval-ms <ms>   Delay between live smoke polling attempts
  --help, -h                Print this help
`);
}

function resolveDeployHookUrl(env = process.env) {
  const hookUrl = String(env.RENDER_WEB_DEPLOY_HOOK_URL || "").trim();
  if (!hookUrl) {
    throw new Error("Missing RENDER_WEB_DEPLOY_HOOK_URL. Copy the arbo-web deploy hook URL from Render -> Settings -> Deploy Hook.");
  }
  if (!/^https:\/\/api\.render\.com\/deploy\//.test(hookUrl)) {
    throw new Error("RENDER_WEB_DEPLOY_HOOK_URL must look like https://api.render.com/deploy/...");
  }
  return hookUrl;
}

async function fetchWithTimeout(url, { fetchImpl = fetch, timeoutMs = 30000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { method: "POST", signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function runRenderWebRedeploy(options = {}) {
  const hookUrl = resolveDeployHookUrl(options.env || process.env);
  if (options.dryRun) {
    return { ok: true, dryRun: true, hookUrl };
  }

  const response = await fetchWithTimeout(hookUrl, options);
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Render deploy hook failed: ${response.status} ${body.slice(0, 200)}`);
  }
  const result = { ok: true, status: response.status, body };
  if (!options.wait) return result;

  const waitResult = await waitForRenderUnifiedLiveSmoke(options);
  return { ...result, wait: waitResult };
}

async function waitForRenderUnifiedLiveSmoke(options = {}) {
  const attempts = Math.max(1, Number(options.waitAttempts || 12));
  const intervalMs = Math.max(0, Number(options.waitIntervalMs || 10000));
  const sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const smokeImpl = options.smokeImpl || runRenderUnifiedLiveSmoke;
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const smoke = await smokeImpl(options);
      return { ok: true, attempts: attempt, smoke };
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(intervalMs);
    }
  }

  throw new Error(`Render deploy did not become live after ${attempts} attempts: ${lastError?.message || "unknown error"}`);
}

if (require.main === module) {
  let options;
  try {
    options = parseArgs();
  } catch (error) {
    console.error(`[render-redeploy-web] FAILED: ${error.message}`);
    process.exitCode = 1;
    return;
  }
  if (options.help) {
    printHelp();
    return;
  }
  runRenderWebRedeploy(options)
    .then((result) => {
      if (result.dryRun) {
        console.log("[render-redeploy-web] OK dry run");
        console.log("[render-redeploy-web] Hook configured");
        return;
      }
      console.log(`[render-redeploy-web] Deploy triggered (${result.status})`);
      if (result.wait) {
        const build = result.wait.smoke?.web?.build || "unknown";
        console.log(`[render-redeploy-web] Live smoke passed after ${result.wait.attempts} attempt(s), build=${build}`);
      } else {
        console.log("[render-redeploy-web] After Render finishes, run: npm run smoke:render-unified:live");
        console.log("[render-redeploy-web] Or use: npm run deploy:render:web:wait");
      }
    })
    .catch((error) => {
      console.error(`[render-redeploy-web] FAILED: ${error.message}`);
      process.exitCode = 1;
    });
}

module.exports = {
  parseArgs,
  validateArgs,
  printHelp,
  resolveDeployHookUrl,
  fetchWithTimeout,
  runRenderWebRedeploy,
  waitForRenderUnifiedLiveSmoke,
};
