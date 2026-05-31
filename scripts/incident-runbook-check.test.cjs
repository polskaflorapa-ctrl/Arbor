const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  runIncidentRunbookCheck,
  assertCodeNeedles,
  assertPackageScripts,
  assertTextIncludes,
} = require("./incident-runbook-check.cjs");

function writeFixtureFile(root, relPath, contents) {
  const fullPath = path.join(root, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, contents);
}

function withFixture(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "incident-runbook-"));
  try {
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("incident runbook check validates files, scripts, scenarios, and code hooks", () => {
  withFixture((root) => {
    const files = ["docs/PRODUCTION-INCIDENT-RUNBOOK.md", "os/scripts/db-restore.js", "os/src/routes/tasks.js"];
    for (const file of files) writeFixtureFile(root, file, "placeholder");

    writeFixtureFile(
      root,
      "docs/PRODUCTION-INCIDENT-RUNBOOK.md",
      "API down /api/ready p95 5xx arbor_db_pool_waiting storage-smoke Kommo dead_letter kommo-sync/diagnostics kommo-retry SMS sms_history sms_delivery_events Zadarma restore:db:check restore:db CONFIRM_RESTORE=YES RESTORE_CLEAN GO NO-GO",
    );
    writeFixtureFile(root, "os/scripts/db-restore.js", "CONFIRM_RESTORE RESTORE_CLEAN restore:db:check dry_run=1");
    writeFixtureFile(root, "os/src/routes/tasks.js", "kommo-sync/diagnostics kommo-retry dead_letter");
    writeFixtureFile(
      root,
      "package.json",
      JSON.stringify({ scripts: { "verify:incident-runbook": "node script", "restore:db:check": "node restore" } }),
    );

    const result = runIncidentRunbookCheck({
      root,
      requiredFiles: files,
      requiredScripts: { "package.json": ["verify:incident-runbook", "restore:db:check"] },
      codeNeedles: {
        "os/scripts/db-restore.js": ["CONFIRM_RESTORE", "RESTORE_CLEAN"],
        "os/src/routes/tasks.js": ["kommo-sync/diagnostics", "dead_letter"],
      },
    });

    assert.deepEqual(result, { ok: true, checkedFiles: 3, checkedPackages: 1 });
  });
});

test("incident runbook package assertion reports missing script name", () => {
  withFixture((root) => {
    writeFixtureFile(root, "package.json", JSON.stringify({ scripts: { check: "node ok" } }));

    assert.throws(
      () => assertPackageScripts({ "package.json": ["check", "verify:incident-runbook"] }, root),
      /verify:incident-runbook/,
    );
  });
});

test("incident runbook text assertion reports missing incident scenario", () => {
  withFixture((root) => {
    writeFixtureFile(root, "docs/PRODUCTION-INCIDENT-RUNBOOK.md", "API down /api/ready");

    assert.throws(
      () => assertTextIncludes("docs/PRODUCTION-INCIDENT-RUNBOOK.md", ["API down", "storage-smoke"], root),
      /storage-smoke/,
    );
  });
});

test("incident runbook code assertion reports missing safety guard", () => {
  withFixture((root) => {
    writeFixtureFile(root, "os/scripts/db-restore.js", "RESTORE_CLEAN");

    assert.throws(
      () => assertCodeNeedles({ "os/scripts/db-restore.js": ["RESTORE_CLEAN", "CONFIRM_RESTORE"] }, root),
      /CONFIRM_RESTORE/,
    );
  });
});
