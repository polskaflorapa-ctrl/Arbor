const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

const requiredFiles = [
  "docs/PRODUCTION-DEPLOY-DRY-RUN.md",
  "docs/PRODUCTION-READINESS-CHECKLIST.md",
  "docs/ENVIRONMENT-RUNBOOK.md",
  "docs/backup-restore.md",
  "docs/render-deploy.md",
  "deploy/local-production-doctor.env.example",
  "deploy/web-production.env.example",
  "deploy/mobile-production.env.example",
  "os/migrate.sql",
  "os/scripts/apply-migrate.js",
  "os/scripts/bootstrap-admin.js",
  "os/scripts/production-doctor.js",
  "os/scripts/db-backup.js",
  "os/scripts/db-restore.js",
  "os/scripts/smoke-production-check.js",
  "scripts/run-production-bootstrap.cjs",
  "scripts/deploy-ready-check.cjs",
  "scripts/production-readiness.cjs",
];

const requiredScripts = {
  "package.json": [
    "check",
    "prod:ready",
    "deploy:prod:dry-run",
    "deploy:ready:check",
    "deploy:env:print",
    "deploy:prod:doctor",
    "deploy:prod:bootstrap",
    "deploy:free:check",
    "backup:db",
    "backup:db:check",
    "restore:db",
    "restore:db:check",
    "smoke:render",
    "smoke:p95",
  ],
  "os/package.json": [
    "db:migrate",
    "bootstrap:admin",
    "prod:doctor",
    "backup:db",
    "backup:db:check",
    "restore:db",
    "restore:db:check",
    "smoke:prod",
  ],
};

const dryRunNeedles = [
  "deploy:prod:dry-run",
  "prod:ready",
  "deploy:ready:check",
  "deploy:env:print",
  "deploy:prod:doctor",
  "db:migrate",
  "bootstrap:admin",
  "backup:db:check",
  "backup:db",
  "restore:db:check",
  "smoke:render",
  "smoke:p95",
  "PUBLIC_BASE_URL",
  "CORS_ORIGINS",
  "VITE_API_URL",
  "EXPO_PUBLIC_API_URL",
  "UPLOAD_STORAGE=s3",
  "GO",
  "NO-GO",
  "PRODUCTION-READINESS-CHECKLIST.md",
];

const runbookNeedles = [
  "npm run deploy:prod:dry-run",
  "npm run backup:db",
  "npm run restore:db:check",
  "npm run smoke:render -- https://<arbor-os-url>",
  "npm run smoke:p95 -- https://<arbor-os-url>",
];

function readJson(relPath, baseDir = root) {
  return JSON.parse(fs.readFileSync(path.join(baseDir, relPath), "utf8"));
}

function assertFilesExist(files = requiredFiles, baseDir = root) {
  const missing = files.filter((file) => !fs.existsSync(path.join(baseDir, file)));
  if (missing.length) {
    throw new Error(`Missing production dry-run files: ${missing.join(", ")}`);
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

function runProductionDryRunCheck(options = {}) {
  const baseDir = options.root || root;
  assertFilesExist(options.requiredFiles || requiredFiles, baseDir);
  assertPackageScripts(options.requiredScripts || requiredScripts, baseDir);
  assertTextIncludes(
    "docs/PRODUCTION-DEPLOY-DRY-RUN.md",
    options.dryRunNeedles || dryRunNeedles,
    baseDir,
  );
  assertTextIncludes(
    "docs/ENVIRONMENT-RUNBOOK.md",
    options.runbookNeedles || runbookNeedles,
    baseDir,
  );

  return {
    ok: true,
    checkedFiles: (options.requiredFiles || requiredFiles).length,
    checkedPackages: Object.keys(options.requiredScripts || requiredScripts).length,
  };
}

if (require.main === module) {
  try {
    const result = runProductionDryRunCheck();
    console.log(
      `[production-dry-run-check] OK (${result.checkedFiles} files, ${result.checkedPackages} package files)`,
    );
  } catch (error) {
    console.error(`[production-dry-run-check] FAILED: ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  runProductionDryRunCheck,
  assertFilesExist,
  assertPackageScripts,
  assertTextIncludes,
};
