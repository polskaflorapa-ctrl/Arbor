const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

const requiredFiles = [
  "docs/OBSERVABILITY-SLO-RUNBOOK.md",
  "docs/ENVIRONMENT-RUNBOOK.md",
  "docs/PRODUCTION-DEPLOY-DRY-RUN.md",
  "os/src/app.js",
  "os/src/metrics.js",
  "os/src/config/env.js",
  "os/.env.example",
  "os/scripts/smoke-production-check.js",
  "os/scripts/production-doctor.js",
  "scripts/health-check.cjs",
];

const requiredScripts = {
  "package.json": [
    "health",
    "verify:observability",
    "deploy:prod:doctor",
    "smoke:render",
    "backup:db:check",
    "restore:db:check",
  ],
  "os/package.json": ["prod:doctor", "smoke:prod", "backup:db:check", "restore:db:check"],
};

const runbookNeedles = [
  "/api/health",
  "/api/ready",
  "/api/metrics",
  "/api/ops/smoke",
  "/api/ops/storage-smoke",
  "METRICS_ENABLED=true",
  "METRICS_TOKEN",
  "5xx",
  "p95",
  "500 ms",
  "arbor_http_requests_total",
  "arbor_http_duration_seconds_bucket",
  "arbor_db_pool_waiting",
  "restore:db:check",
  "GO",
  "NO-GO",
];

const codeNeedles = {
  "os/src/app.js": ["/api/health", "/api/ready", "/api/metrics", "METRICS_TOKEN"],
  "os/src/metrics.js": [
    "arbor_http_requests_total",
    "arbor_http_duration_seconds",
    "arbor_db_pool_waiting",
    "metricsMiddleware",
  ],
  "os/src/config/env.js": ["METRICS_ENABLED"],
  "os/.env.example": ["METRICS_ENABLED", "METRICS_TOKEN"],
  "os/scripts/smoke-production-check.js": ["/api/ops/smoke", "/api/ops/storage-smoke"],
};

function readJson(relPath, baseDir = root) {
  return JSON.parse(fs.readFileSync(path.join(baseDir, relPath), "utf8"));
}

function assertFilesExist(files = requiredFiles, baseDir = root) {
  const missing = files.filter((file) => !fs.existsSync(path.join(baseDir, file)));
  if (missing.length) {
    throw new Error(`Missing observability files: ${missing.join(", ")}`);
  }
}

function assertPackageScripts(scriptMap = requiredScripts, baseDir = root) {
  for (const [file, scripts] of Object.entries(scriptMap)) {
    const pkg = readJson(file, baseDir);
    for (const scriptName of scripts) {
      if (!pkg.scripts || !pkg.scripts[scriptName]) {
        throw new Error(`${file} is missing script ${scriptName}`);
      }
    }
  }
}

function assertTextIncludes(relPath, needles, baseDir = root) {
  const text = fs.readFileSync(path.join(baseDir, relPath), "utf8");
  const missing = needles.filter((needle) => !text.includes(needle));
  if (missing.length) {
    throw new Error(`${relPath} is missing: ${missing.join(", ")}`);
  }
}

function assertCodeNeedles(needlesByFile = codeNeedles, baseDir = root) {
  for (const [file, needles] of Object.entries(needlesByFile)) {
    assertTextIncludes(file, needles, baseDir);
  }
}

function runObservabilityCheck(options = {}) {
  const baseDir = options.root || root;
  assertFilesExist(options.requiredFiles || requiredFiles, baseDir);
  assertPackageScripts(options.requiredScripts || requiredScripts, baseDir);
  assertTextIncludes(
    "docs/OBSERVABILITY-SLO-RUNBOOK.md",
    options.runbookNeedles || runbookNeedles,
    baseDir,
  );
  assertCodeNeedles(options.codeNeedles || codeNeedles, baseDir);

  return {
    ok: true,
    checkedFiles: (options.requiredFiles || requiredFiles).length,
    checkedPackages: Object.keys(options.requiredScripts || requiredScripts).length,
  };
}

if (require.main === module) {
  try {
    const result = runObservabilityCheck();
    console.log(
      `[observability-check] OK (${result.checkedFiles} files, ${result.checkedPackages} package files)`,
    );
  } catch (error) {
    console.error(`[observability-check] FAILED: ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  runObservabilityCheck,
  assertFilesExist,
  assertPackageScripts,
  assertTextIncludes,
  assertCodeNeedles,
};
