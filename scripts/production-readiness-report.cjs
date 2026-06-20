const { execSync, spawnSync } = require("node:child_process");
const {
  assertWebLooksCurrent,
  DEFAULT_API_BASE_URL,
  DEFAULT_WEB_URL,
  parseArgs: parseLiveSmokeArgs,
  runRenderUnifiedLiveSmoke,
} = require("./render-unified-live-smoke.cjs");

const DEFAULT_CUSTOM_WEB_URL = "https://arbo-os.com";

const LOCAL_GATES = [
  { name: "render-unified-config", command: "npm", args: ["run", "verify:render-unified"] },
  { name: "polska-flora-contract", command: "npm", args: ["run", "verify:polska-flora-ready"] },
];

const WEB_BUILD_PATHS = [
  "web",
  "package-lock.json",
  "render.yaml",
  "web/render.yaml",
  "deploy/web-production.env.example",
];

const VALUE_ARGS = new Set(["--web", "--api", "--custom-web", "--timeout-ms", "--expected-build"]);
const BOOLEAN_ARGS = new Set([
  "--any-build",
  "--skip-local",
  "--skip-slow-local",
  "--skip-remote",
  "--skip-live",
  "--skip-remote-smoke",
  "--skip-custom-domain",
  "--json",
  "--help",
  "-h",
]);

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

function extractLiveSmokeArgs(argv = []) {
  const liveArgs = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--custom-web") {
      index += 1;
      continue;
    }
    if (VALUE_ARGS.has(arg)) {
      liveArgs.push(arg, argv[index + 1]);
      index += 1;
      continue;
    }
    const eqIndex = String(arg).indexOf("=");
    if (eqIndex > 0 && String(arg).slice(0, eqIndex) === "--custom-web") continue;
    if ((eqIndex > 0 && VALUE_ARGS.has(String(arg).slice(0, eqIndex))) || arg === "--any-build") {
      liveArgs.push(arg);
    }
  }
  return liveArgs;
}

function extractValueArg(argv = [], flag, fallback = "") {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index]);
    if (arg === flag) return argv[index + 1] || fallback;
    if (arg.startsWith(`${flag}=`)) return arg.slice(flag.length + 1);
  }
  return fallback;
}

function hasValueArg(argv = [], flag) {
  return argv.some((arg) => String(arg) === flag || String(arg).startsWith(`${flag}=`));
}

function resolveExpectedWebBuild({ execImpl = execSync } = {}) {
  const pathspec = WEB_BUILD_PATHS.join(" ");
  try {
    const output = execImpl(`git log -1 --format=%h -- ${pathspec}`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (output) return output;
  } catch {}
  try {
    return execImpl("git rev-parse --short HEAD", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function parseArgs(argv = process.argv.slice(2)) {
  validateArgs(argv);
  const liveOptions = parseLiveSmokeArgs(extractLiveSmokeArgs(argv));
  if (!argv.includes("--any-build") && !hasValueArg(argv, "--expected-build")) {
    liveOptions.expectedBuild = resolveExpectedWebBuild();
  }
  return {
    ...liveOptions,
    skipLocal: argv.includes("--skip-local") || argv.includes("--skip-slow-local"),
    skipRemote: argv.includes("--skip-remote") || argv.includes("--skip-live") || argv.includes("--skip-remote-smoke"),
    skipCustomDomain: argv.includes("--skip-custom-domain"),
    customWebUrl: extractValueArg(argv, "--custom-web", DEFAULT_CUSTOM_WEB_URL),
    json: argv.includes("--json"),
    help: argv.includes("--help") || argv.includes("-h"),
  };
}

function printHelp() {
  console.log(`Usage: node scripts/production-readiness-report.cjs [options]

Options:
  --web <url>              Public web URL to check
  --custom-web <url>       Custom production domain to check (default: ${DEFAULT_CUSTOM_WEB_URL})
  --api <url>              Public API base URL to check
  --expected-build <sha>   Require the live web build marker to match this value (default: latest web-impacting commit)
  --any-build              Skip exact live web build marker matching
  --timeout-ms <ms>        HTTP timeout for live smoke checks
  --skip-local             Skip local contract gates
  --skip-slow-local        Alias for --skip-local
  --skip-remote            Skip Render deploy hook and live web/API smoke gates
  --skip-live              Alias for --skip-remote
  --skip-remote-smoke      Alias for --skip-remote
  --skip-custom-domain     Skip custom production domain smoke gate
  --json                   Print JSON report
  --help, -h               Print this help
`);
}

function summarizeReadiness(gates) {
  const failed = gates.filter((gate) => gate.status === "fail");
  const warnings = gates.filter((gate) => gate.status === "warn");
  if (failed.length) return { status: "blocked", failed: failed.length, warnings: warnings.length };
  if (warnings.length) return { status: "ready-with-warnings", failed: 0, warnings: warnings.length };
  return { status: "ready", failed: 0, warnings: 0 };
}

function buildRecommendedActions(reportLike) {
  const gates = reportLike.gates || [];
  const actions = [];
  const hookGate = gates.find((gate) => gate.name === "render-web-deploy-hook");
  const liveGate = gates.find((gate) => gate.name === "render-live-smoke");
  const customDomainGate = gates.find((gate) => gate.name === "custom-domain-live-smoke");
  const expectedBuild = reportLike.expectedBuild;

  if (hookGate?.status === "warn") {
    actions.push(
      "Set GitHub secret RENDER_WEB_DEPLOY_HOOK_URL from Render arbo-web Settings -> Deploy Hook, or export it locally before redeploy.",
    );
  }

  if (liveGate?.status === "fail") {
    if (/build marker mismatch/i.test(liveGate.detail || "")) {
      const expectedFlag = expectedBuild ? ` -- --expected-build ${expectedBuild}` : "";
      actions.push(`Trigger latest web redeploy: npm run deploy:render:web:wait${expectedFlag}`);
    }
    actions.push("After Render finishes, rerun: npm run status:production -- --skip-local");
  }

  if (customDomainGate?.status === "fail") {
    if (/build marker mismatch|old ARBOR-OS build/i.test(customDomainGate.detail || "")) {
      actions.push("After Render redeploy, purge/refresh the custom domain cache and verify arbo-os.com serves the same build marker.");
    }
    actions.push("Rerun custom-domain smoke: npm run status:production -- --skip-local");
  }

  return actions;
}

function runCommandGate(gate, { spawnImpl = spawnSync, cwd = process.cwd() } = {}) {
  const executable = process.platform === "win32" && gate.command === "npm" ? "cmd.exe" : gate.command;
  const args =
    process.platform === "win32" && gate.command === "npm"
      ? ["/d", "/s", "/c", ["npm", ...gate.args].join(" ")]
      : gate.args;
  const result = spawnImpl(executable, args, { cwd, stdio: "pipe", encoding: "utf8" });
  return {
    name: gate.name,
    status: result.status === 0 ? "ok" : "fail",
    command: [gate.command, ...gate.args].join(" "),
    detail: result.status === 0 ? "OK" : (result.stderr || result.stdout || "command failed").trim(),
  };
}

function deployHookGate(env = process.env) {
  const present = Boolean(String(env.RENDER_WEB_DEPLOY_HOOK_URL || "").trim());
  return {
    name: "render-web-deploy-hook",
    status: present ? "ok" : "warn",
    detail: present
      ? "RENDER_WEB_DEPLOY_HOOK_URL is configured."
      : "RENDER_WEB_DEPLOY_HOOK_URL is missing; live web redeploy must be triggered manually.",
  };
}

function formatBuildDetail(result = {}, expectedBuild = "") {
  const actualBuild = result.build || "unknown";
  if (!expectedBuild) return `build=${actualBuild}`;
  if (actualBuild === expectedBuild) return `build=${actualBuild}`;
  return `build=${actualBuild}, compatible with expected ${expectedBuild}`;
}

async function liveRenderGate(options = {}) {
  try {
    const result = await runRenderUnifiedLiveSmoke(options);
    return {
      name: "render-live-smoke",
      status: "ok",
      detail: `Web ${options.webUrl || DEFAULT_WEB_URL} and API ${options.apiBaseUrl || DEFAULT_API_BASE_URL} are live (${formatBuildDetail(result.web, options.expectedBuild)}).`,
      result,
    };
  } catch (error) {
    return {
      name: "render-live-smoke",
      status: "fail",
      detail: error.message,
    };
  }
}

async function customDomainGate(options = {}) {
  const customWebUrl = options.customWebUrl || DEFAULT_CUSTOM_WEB_URL;
  try {
    const result = await assertWebLooksCurrent({
      ...options,
      webUrl: customWebUrl,
    });
    return {
      name: "custom-domain-live-smoke",
      status: "ok",
      detail: `Custom domain ${customWebUrl} is live (${formatBuildDetail(result, options.expectedBuild)}).`,
      result,
    };
  } catch (error) {
    return {
      name: "custom-domain-live-smoke",
      status: "fail",
      detail: error.message,
    };
  }
}

async function buildProductionReadinessReport(options = {}) {
  const gates = [];
  if (!options.skipLocal) {
    for (const gate of LOCAL_GATES) {
      gates.push(runCommandGate(gate, options));
    }
  }
  if (!options.skipRemote) {
    gates.push(deployHookGate(options.env || process.env));
    gates.push(await liveRenderGate(options));
    if (!options.skipCustomDomain) {
      gates.push(await customDomainGate(options));
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    webUrl: options.webUrl || DEFAULT_WEB_URL,
    customWebUrl: options.skipCustomDomain ? null : options.customWebUrl || DEFAULT_CUSTOM_WEB_URL,
    apiBaseUrl: options.apiBaseUrl || DEFAULT_API_BASE_URL,
    expectedBuild: options.expectedBuild || null,
    summary: summarizeReadiness(gates),
    gates,
  };
  report.actions = buildRecommendedActions(report);
  return report;
}

function printTextReport(report) {
  console.log(`[production-readiness] ${report.summary.status}`);
  console.log(`[production-readiness] Web: ${report.webUrl}`);
  if (report.customWebUrl) console.log(`[production-readiness] Custom web: ${report.customWebUrl}`);
  console.log(`[production-readiness] API: ${report.apiBaseUrl}`);
  if (report.expectedBuild) console.log(`[production-readiness] Expected web build: ${report.expectedBuild}`);
  for (const gate of report.gates) {
    console.log(`[production-readiness] ${gate.status.toUpperCase()} ${gate.name}: ${gate.detail}`);
  }
  for (const action of report.actions || []) {
    console.log(`[production-readiness] NEXT ${action}`);
  }
}

if (require.main === module) {
  let options;
  try {
    options = parseArgs();
  } catch (error) {
    console.error(`[production-readiness] FAILED: ${error.message}`);
    process.exitCode = 1;
    return;
  }
  if (options.help) {
    printHelp();
    return;
  }
  buildProductionReadinessReport(options)
    .then((report) => {
      if (options.json) console.log(JSON.stringify(report, null, 2));
      else printTextReport(report);
      if (report.summary.status === "blocked") process.exitCode = 1;
    })
    .catch((error) => {
      console.error(`[production-readiness] FAILED: ${error.message}`);
      process.exitCode = 1;
    });
}

module.exports = {
  LOCAL_GATES,
  DEFAULT_CUSTOM_WEB_URL,
  WEB_BUILD_PATHS,
  parseArgs,
  extractLiveSmokeArgs,
  extractValueArg,
  hasValueArg,
  resolveExpectedWebBuild,
  summarizeReadiness,
  buildRecommendedActions,
  runCommandGate,
  deployHookGate,
  formatBuildDetail,
  liveRenderGate,
  customDomainGate,
  buildProductionReadinessReport,
  printHelp,
};
