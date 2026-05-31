const fs = require("node:fs");
const path = require("node:path");

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
  "docs/PRODUCTION-INCIDENT-RUNBOOK.md": ["docs/BACKUP-RPO-RTO-RUNBOOK.md", "RPO", "RTO"],
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

function readJson(relPath, baseDir = root) {
  return JSON.parse(fs.readFileSync(path.join(baseDir, relPath), "utf8"));
}

function assertFilesExist(files = requiredFiles, baseDir = root) {
  const missing = files.filter((file) => !fs.existsSync(path.join(baseDir, file)));
  if (missing.length) {
    throw new Error(`Missing backup RPO/RTO files: ${missing.join(", ")}`);
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
