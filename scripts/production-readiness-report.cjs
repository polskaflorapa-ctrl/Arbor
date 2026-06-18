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

function parseArgs(argv = process.argv.slice(2)) {
  const liveOptions = parseLiveSmokeArgs(argv);
  return {
    ...liveOptions,
    skipLocal: argv.includes("--skip-local"),
    json: argv.includes("--json"),
  };
}

function summarizeReadiness(gates) {
  const failed = gates.filter((gate) => gate.status === "fail");
  const warnings = gates.filter((gate) => gate.status === "warn");
  if (failed.length) return { status: "blocked", failed: failed.length, warnings: warnings.length };
  if (warnings.length) return { status: "ready-with-warnings", failed: 0, warnings: warnings.length };
  return { status: "ready", failed: 0, warnings: 0 };
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
  gates.push(deployHookGate(options.env || process.env));
  gates.push(await liveRenderGate(options));

  return {
    generatedAt: new Date().toISOString(),
    webUrl: options.webUrl || DEFAULT_WEB_URL,
    apiBaseUrl: options.apiBaseUrl || DEFAULT_API_BASE_URL,
    summary: summarizeReadiness(gates),
    gates,
  };
}

function printTextReport(report) {
  console.log(`[production-readiness] ${report.summary.status}`);
  console.log(`[production-readiness] Web: ${report.webUrl}`);
  console.log(`[production-readiness] API: ${report.apiBaseUrl}`);
  for (const gate of report.gates) {
    console.log(`[production-readiness] ${gate.status.toUpperCase()} ${gate.name}: ${gate.detail}`);
  }
}

if (require.main === module) {
  const options = parseArgs();
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
  runCommandGate,
  deployHookGate,
  liveRenderGate,
  buildProductionReadinessReport,
};
