const { spawnSync } = require("node:child_process");
const {
  DEFAULT_API_BASE_URL,
  DEFAULT_WEB_URL,
  parseArgs: parseLiveSmokeArgs,
  runRenderUnifiedLiveSmoke,
} = require("./render-unified-live-smoke.cjs");

const LOCAL_GATES = [
  { name: "render-unified-config", command: "npm", args: ["run", "verify:render-unified"] },
  { name: "polska-flora-contract", command: "npm", args: ["run", "verify:polska-flora-ready"] },
];

const VALUE_ARGS = new Set(["--web", "--api", "--timeout-ms", "--expected-build"]);
const BOOLEAN_ARGS = new Set([
  "--any-build",
  "--skip-local",
  "--skip-slow-local",
  "--skip-remote",
  "--skip-live",
  "--skip-remote-smoke",
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

function parseArgs(argv = process.argv.slice(2)) {
  validateArgs(argv);
  const liveOptions = parseLiveSmokeArgs(argv);
  return {
    ...liveOptions,
    skipLocal: argv.includes("--skip-local") || argv.includes("--skip-slow-local"),
    skipRemote: argv.includes("--skip-remote") || argv.includes("--skip-live") || argv.includes("--skip-remote-smoke"),
    json: argv.includes("--json"),
    help: argv.includes("--help") || argv.includes("-h"),
  };
}

function printHelp() {
  console.log(`Usage: node scripts/production-readiness-report.cjs [options]

Options:
  --web <url>              Public web URL to check
  --api <url>              Public API base URL to check
  --expected-build <sha>   Require the live web build marker to match this value
  --any-build              Skip exact live web build marker matching
  --timeout-ms <ms>        HTTP timeout for live smoke checks
  --skip-local             Skip local contract gates
  --skip-slow-local        Alias for --skip-local
  --skip-remote            Skip Render deploy hook and live web/API smoke gates
  --skip-live              Alias for --skip-remote
  --skip-remote-smoke      Alias for --skip-remote
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

async function liveRenderGate(options = {}) {
  try {
    const result = await runRenderUnifiedLiveSmoke(options);
    return {
      name: "render-live-smoke",
      status: "ok",
      detail: `Web ${options.webUrl || DEFAULT_WEB_URL} and API ${options.apiBaseUrl || DEFAULT_API_BASE_URL} are live.`,
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
  }

  const report = {
    generatedAt: new Date().toISOString(),
    webUrl: options.webUrl || DEFAULT_WEB_URL,
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
  parseArgs,
  summarizeReadiness,
  buildRecommendedActions,
  runCommandGate,
  deployHookGate,
  liveRenderGate,
  buildProductionReadinessReport,
  printHelp,
};
