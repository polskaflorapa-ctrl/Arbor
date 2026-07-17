const path = require("node:path");
const { createRepositoryAssertions } = require("./lib/repository-contract.cjs");

const root = path.resolve(__dirname, "..");

const requiredFiles = [
  "docs/BACKUP-RPO-RTO-RUNBOOK.md",
  "docs/backup-restore.md",
  "docs/PRODUCTION-INCIDENT-RUNBOOK.md",
  "docs/PRODUCTION-DEPLOY-DRY-RUN.md",
  "os/scripts/db-backup.js",
  "os/scripts/db-restore.js",
  "os/.env.example",
];

const requiredScripts = {
  "package.json": [
    "verify:backup-rpo",
    "backup:db",
    "backup:db:check",
    "restore:db",
    "restore:db:check",
    "deploy:prod:doctor",
    "smoke:render",
    "smoke:p95",
    "check",
  ],
  "os/package.json": ["backup:db", "backup:db:check", "restore:db", "restore:db:check"],
};

const runbookNeedles = [
  "RPO",
  "RTO",
  "24h",
  "4h",
  "15 min",
  "restore drill",
  "replaceable",
  "backup:db:check",
  "backup:db",
  "restore:db:check",
  "restore:db",
  "smoke:p95",
  "CONFIRM_RESTORE=YES",
  "RESTORE_CLEAN",
  "BACKUP_RETAIN_DAYS",
  "BACKUP_ENCRYPT_KEY",
  "PG_DUMP_BIN",
  "PG_RESTORE_BIN",
  "latest.dump",
  "latest.dump.enc",
  "GO",
  "NO-GO",
];

const docsNeedles = {
  "docs/backup-restore.md": ["RPO", "RTO", "docs/BACKUP-RPO-RTO-RUNBOOK.md", "restore drill"],
  "docs/PRODUCTION-DEPLOY-DRY-RUN.md": ["verify:backup-rpo", "docs/BACKUP-RPO-RTO-RUNBOOK.md"],
  "docs/PRODUCTION-INCIDENT-RUNBOOK.md": ["docs/BACKUP-RPO-RTO-RUNBOOK.md", "RPO", "RTO", "smoke:p95"],
};

const codeNeedles = {
  "os/scripts/db-backup.js": [
    "BACKUP_RETAIN_DAYS",
    "BACKUP_ENCRYPT_KEY",
    "latest.dump",
    "rotateOldBackups",
    "pg_dump",
    "dry_run=1",
  ],
  "os/scripts/db-restore.js": ["CONFIRM_RESTORE", "RESTORE_CLEAN", "latest.dump.enc", "BACKUP_ENCRYPT_KEY", "dry_run=1", "pg_restore"],
  "os/.env.example": ["BACKUP_RETAIN_DAYS", "BACKUP_ENCRYPT_KEY", "PG_DUMP_BIN", "PG_RESTORE_BIN", "CONFIRM_RESTORE"],
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
  missingFilesLabel: "Missing backup RPO/RTO files",
});

function runBackupRpoCheck(options = {}) {
  const baseDir = options.root || root;
  assertFilesExist(options.requiredFiles || requiredFiles, baseDir);
  assertPackageScripts(options.requiredScripts || requiredScripts, baseDir);
  assertTextIncludes("docs/BACKUP-RPO-RTO-RUNBOOK.md", options.runbookNeedles || runbookNeedles, baseDir);
  assertNeedleMap(options.docsNeedles || docsNeedles, baseDir);
  assertNeedleMap(options.codeNeedles || codeNeedles, baseDir);

  return {
    ok: true,
    checkedFiles: (options.requiredFiles || requiredFiles).length,
    checkedPackages: Object.keys(options.requiredScripts || requiredScripts).length,
  };
}

if (require.main === module) {
  try {
    const result = runBackupRpoCheck();
    console.log(`[backup-rpo-check] OK (${result.checkedFiles} files, ${result.checkedPackages} package files)`);
  } catch (error) {
    console.error(`[backup-rpo-check] FAILED: ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  runBackupRpoCheck,
  assertFilesExist,
  assertPackageScripts,
  assertTextIncludes,
  assertNeedleMap,
};
