const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  runBackupRpoCheck,
  assertNeedleMap,
  assertPackageScripts,
  assertTextIncludes,
} = require("./backup-rpo-check.cjs");

function writeFixtureFile(root, relPath, contents) {
  const fullPath = path.join(root, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, contents);
}

function withFixture(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "backup-rpo-"));
  try {
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("backup RPO/RTO check validates files, scripts, runbook, docs, and backup code", () => {
  withFixture((root) => {
    const files = ["docs/BACKUP-RPO-RTO-RUNBOOK.md", "docs/backup-restore.md", "os/scripts/db-backup.js"];
    for (const file of files) writeFixtureFile(root, file, "placeholder");

    writeFixtureFile(
      root,
      "docs/BACKUP-RPO-RTO-RUNBOOK.md",
      "RPO RTO 24h 4h 15 min restore drill replaceable backup:db:check backup:db restore:db:check restore:db CONFIRM_RESTORE=YES RESTORE_CLEAN BACKUP_RETAIN_DAYS BACKUP_ENCRYPT_KEY PG_DUMP_BIN PG_RESTORE_BIN latest.dump latest.dump.enc GO NO-GO",
    );
    writeFixtureFile(root, "docs/backup-restore.md", "RPO RTO docs/BACKUP-RPO-RTO-RUNBOOK.md restore drill");
    writeFixtureFile(root, "os/scripts/db-backup.js", "BACKUP_RETAIN_DAYS BACKUP_ENCRYPT_KEY latest.dump rotateOldBackups pg_dump dry_run=1");
    writeFixtureFile(
      root,
      "package.json",
      JSON.stringify({ scripts: { "verify:backup-rpo": "node script", "backup:db": "node backup", check: "npm test" } }),
    );

    const result = runBackupRpoCheck({
      root,
      requiredFiles: files,
      requiredScripts: { "package.json": ["verify:backup-rpo", "backup:db", "check"] },
      docsNeedles: { "docs/backup-restore.md": ["RPO", "restore drill"] },
      codeNeedles: { "os/scripts/db-backup.js": ["BACKUP_RETAIN_DAYS", "pg_dump"] },
    });

    assert.deepEqual(result, { ok: true, checkedFiles: 3, checkedPackages: 1 });
  });
});

test("backup RPO/RTO package assertion reports missing script name", () => {
  withFixture((root) => {
    writeFixtureFile(root, "package.json", JSON.stringify({ scripts: { check: "node ok" } }));

    assert.throws(
      () => assertPackageScripts({ "package.json": ["check", "verify:backup-rpo"] }, root),
      /verify:backup-rpo/,
    );
  });
});

test("backup RPO/RTO text assertion reports missing restore drill", () => {
  withFixture((root) => {
    writeFixtureFile(root, "docs/BACKUP-RPO-RTO-RUNBOOK.md", "RPO RTO");

    assert.throws(
      () => assertTextIncludes("docs/BACKUP-RPO-RTO-RUNBOOK.md", ["RPO", "restore drill"], root),
      /restore drill/,
    );
  });
});

test("backup RPO/RTO needle map reports missing backup retention guard", () => {
  withFixture((root) => {
    writeFixtureFile(root, "os/scripts/db-backup.js", "pg_dump");

    assert.throws(
      () => assertNeedleMap({ "os/scripts/db-backup.js": ["pg_dump", "BACKUP_RETAIN_DAYS"] }, root),
      /BACKUP_RETAIN_DAYS/,
    );
  });
});
