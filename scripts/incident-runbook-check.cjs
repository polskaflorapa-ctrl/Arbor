const path = require("node:path");
const { createRepositoryAssertions } = require("./lib/repository-contract.cjs");

const root = path.resolve(__dirname, "..");

const requiredFiles = [
  "docs/PRODUCTION-INCIDENT-RUNBOOK.md",
  "docs/OBSERVABILITY-SLO-RUNBOOK.md",
  "docs/PRODUCTION-DEPLOY-DRY-RUN.md",
  "docs/backup-restore.md",
  "os/scripts/db-backup.js",
  "os/scripts/db-restore.js",
  "os/scripts/smoke-production-check.js",
  "os/src/routes/tasks.js",
  "os/src/routes/sms.js",
  "os/src/routes/sms-webhooks.js",
  "os/src/routes/ops.js",
  "web/src/pages/Integracje.js",
];

const requiredScripts = {
  "package.json": [
    "verify:incident-runbook",
    "verify:observability",
    "health",
    "status:json:strict",
    "deploy:prod:doctor",
    "smoke:render",
    "backup:db:check",
    "restore:db:check",
    "restore:db",
    "check",
  ],
  "os/package.json": ["prod:doctor", "smoke:prod", "backup:db:check", "restore:db:check", "restore:db"],
};

const runbookNeedles = [
  "API down",
  "/api/ready",
  "p95",
  "5xx",
  "arbor_db_pool_waiting",
  "storage-smoke",
  "Kommo",
  "dead_letter",
  "kommo-sync/diagnostics",
  "kommo-retry",
  "SMS",
  "sms_history",
  "sms_delivery_events",
  "Zadarma",
  "restore:db:check",
  "restore:db",
  "CONFIRM_RESTORE=YES",
  "RESTORE_CLEAN",
  "GO",
  "NO-GO",
];

const codeNeedles = {
  "os/scripts/db-restore.js": ["CONFIRM_RESTORE", "RESTORE_CLEAN", "dry_run=1"],
  "os/scripts/smoke-production-check.js": ["/api/ready", "/api/ops/smoke", "/api/ops/storage-smoke"],
  "os/src/routes/tasks.js": ["kommo-sync/diagnostics", "kommo-retry", "dead_letter"],
  "os/src/routes/sms-webhooks.js": ["sms_delivery_events", "delivery_error_code", "provider_status"],
  "os/src/routes/ops.js": ["storage-smoke", "sms_delivery"],
  "web/src/pages/Integracje.js": ["kommo-sync/diagnostics", "dead_letter", "Retry"],
};

const {
  assertFilesExist,
  assertNeedleMap,
  assertPackageScripts,
  assertTextIncludes,
} = createRepositoryAssertions({
  root,
  requiredFiles,
  requiredScripts,
  missingFilesLabel: "Missing incident runbook files",
});

function assertCodeNeedles(needlesByFile = codeNeedles, baseDir = root) {
  assertNeedleMap(needlesByFile, baseDir);
}

function runIncidentRunbookCheck(options = {}) {
  const baseDir = options.root || root;
  assertFilesExist(options.requiredFiles || requiredFiles, baseDir);
  assertPackageScripts(options.requiredScripts || requiredScripts, baseDir);
  assertTextIncludes(
    "docs/PRODUCTION-INCIDENT-RUNBOOK.md",
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
    const result = runIncidentRunbookCheck();
    console.log(
      `[incident-runbook-check] OK (${result.checkedFiles} files, ${result.checkedPackages} package files)`,
    );
  } catch (error) {
    console.error(`[incident-runbook-check] FAILED: ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  runIncidentRunbookCheck,
  assertFilesExist,
  assertPackageScripts,
  assertTextIncludes,
  assertCodeNeedles,
};
