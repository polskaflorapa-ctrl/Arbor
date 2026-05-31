const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

const requiredFiles = [
  "docs/HORIZONTAL-SCALING-READINESS.md",
  "docs/ENVIRONMENT-RUNBOOK.md",
  "docs/PRODUCTION-DEPLOY-DRY-RUN.md",
  "docs/OBSERVABILITY-SLO-RUNBOOK.md",
  "docs/PILOT-ONE-BRANCH-CHECKLIST.md",
  "os/src/middleware/auth.js",
  "os/src/middleware/rate-limit.js",
  "os/src/services/upload-storage.js",
  "os/src/routes/notifications.js",
  "os/src/routes/dispatch.js",
  "os/src/config/env.js",
  "deploy/local-production-doctor.env.example",
  "deploy/render-arbor-os.env.example",
];

const requiredScripts = {
  "package.json": [
    "verify:scale-readiness",
    "deploy:prod:doctor",
    "smoke:render",
    "smoke:p95",
    "smoke:web:tti",
    "check",
  ],
  "os/package.json": ["prod:doctor", "smoke:prod", "smoke:p95"],
};

const runbookNeedles = [
  "JWT_SECRET",
  "stateless",
  "UPLOAD_STORAGE=s3",
  "LOGIN_RATE_LIMIT_STORE=redis",
  "LOGIN_RATE_LIMIT_REDIS_URL",
  "DB_POOL_MAX",
  "OPS_CRON_SECRET",
  "CRM_MESSAGE_QUEUE_WORKER_ENABLED",
  "SSE",
  "sticky sessions",
  "Redis pub/sub",
  "DISPATCH_SOLVER_TARGET_MS",
  "arbor_db_pool_waiting",
  "smoke:render",
  "smoke:p95",
  "smoke:web:tti",
  "GO",
  "NO-GO",
];

const codeNeedles = {
  "os/src/middleware/auth.js": ["jwt.verify", "env.JWT_SECRET", "Bearer"],
  "os/src/middleware/rate-limit.js": ["LOGIN_RATE_LIMIT_STORE", "LOGIN_RATE_LIMIT_REDIS_URL", "rate-limit-redis", "MemoryStore"],
  "os/src/services/upload-storage.js": ["UPLOAD_STORAGE", "s3", "S3_PUBLIC_BASE_URL", "runUploadStorageSelfTest"],
  "os/src/routes/notifications.js": ["_sseClients", "Single-process in-memory bus", "Redis pub/sub", "pushToUser"],
  "os/src/routes/dispatch.js": ["DISPATCH_SOLVER_TARGET_MS", "solver_target_ms", "solver_sla_ok"],
  "os/src/config/env.js": ["LOGIN_RATE_LIMIT_STORE", "LOGIN_RATE_LIMIT_REDIS_URL", "CRM_MESSAGE_QUEUE_WORKER_ENABLED"],
};

const docsNeedles = {
  "docs/ENVIRONMENT-RUNBOOK.md": ["verify:scale-readiness", "LOGIN_RATE_LIMIT_STORE=redis", "UPLOAD_STORAGE=s3"],
  "docs/PRODUCTION-DEPLOY-DRY-RUN.md": ["verify:scale-readiness", "LOGIN_RATE_LIMIT_STORE=redis", "DB_POOL_MAX"],
  "docs/OBSERVABILITY-SLO-RUNBOOK.md": ["horizontal scaling", "arbor_db_pool_waiting", "LOGIN_RATE_LIMIT_STORE=redis"],
  "docs/PILOT-ONE-BRANCH-CHECKLIST.md": ["verify:scale-readiness", "horizontal scaling"],
};

const envNeedles = {
  "deploy/local-production-doctor.env.example": ["LOGIN_RATE_LIMIT_STORE=redis", "LOGIN_RATE_LIMIT_REDIS_URL", "UPLOAD_STORAGE=s3", "DB_POOL_MAX=5"],
  "deploy/render-arbor-os.env.example": ["LOGIN_RATE_LIMIT_STORE=redis", "LOGIN_RATE_LIMIT_REDIS_URL", "UPLOAD_STORAGE=s3", "DB_POOL_MAX=5"],
};

function readJson(relPath, baseDir = root) {
  return JSON.parse(fs.readFileSync(path.join(baseDir, relPath), "utf8"));
}

function assertFilesExist(files = requiredFiles, baseDir = root) {
  const missing = files.filter((file) => !fs.existsSync(path.join(baseDir, file)));
  if (missing.length) {
    throw new Error(`Missing scale readiness files: ${missing.join(", ")}`);
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

function assertNeedleMap(needlesByFile, baseDir = root) {
  for (const [file, needles] of Object.entries(needlesByFile)) {
    assertTextIncludes(file, needles, baseDir);
  }
}

function runScaleReadinessCheck(options = {}) {
  const baseDir = options.root || root;
  assertFilesExist(options.requiredFiles || requiredFiles, baseDir);
  assertPackageScripts(options.requiredScripts || requiredScripts, baseDir);
  assertTextIncludes("docs/HORIZONTAL-SCALING-READINESS.md", options.runbookNeedles || runbookNeedles, baseDir);
  assertNeedleMap(options.codeNeedles || codeNeedles, baseDir);
  assertNeedleMap(options.docsNeedles || docsNeedles, baseDir);
  assertNeedleMap(options.envNeedles || envNeedles, baseDir);

  return {
    ok: true,
    checkedFiles: (options.requiredFiles || requiredFiles).length,
    checkedPackages: Object.keys(options.requiredScripts || requiredScripts).length,
  };
}

if (require.main === module) {
  try {
    const result = runScaleReadinessCheck();
    console.log(`[scale-readiness-check] OK (${result.checkedFiles} files, ${result.checkedPackages} package files)`);
  } catch (error) {
    console.error(`[scale-readiness-check] FAILED: ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  runScaleReadinessCheck,
  assertFilesExist,
  assertPackageScripts,
  assertTextIncludes,
  assertNeedleMap,
};
