const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  runPilotHardeningCheck,
  assertPackageScripts,
  assertTextIncludes,
} = require("./pilot-hardening-check.cjs");

function writeFixtureFile(root, relPath, contents) {
  const fullPath = path.join(root, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, contents);
}

function withFixture(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pilot-hardening-"));
  try {
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("pilot hardening check validates required files, scripts, and role checklist text", () => {
  withFixture((root) => {
    const files = [
      "docs/PILOT-ONE-BRANCH-CHECKLIST.md",
      "docs/PILOT-HARDENING-KIEROWNIK-BRYGADZISTA.md",
      "docs/ENVIRONMENT-RUNBOOK.md",
      "docs/backup-restore.md",
      "docs/MOBILE-OFFLINE-CONTRACT.md",
      "mobile/docs/mobile-offline-field-flow-checklist.md",
    ];

    for (const file of files) {
      writeFixtureFile(root, file, "placeholder");
    }

    writeFixtureFile(
      root,
      "docs/PILOT-HARDENING-KIEROWNIK-BRYGADZISTA.md",
      "Kierownik Brygadzista canViewFinance offline Idempotency-Key Kommo SMS audit_log deploy:prod:dry-run smoke:p95 smoke:web:tti --threshold 500 --threshold 3000 GO NO-GO",
    );

    writeFixtureFile(
      root,
      "package.json",
      JSON.stringify({ scripts: { "verify:pilot-hardening": "node script", "smoke:p95": "node p95" } }),
    );

    const result = runPilotHardeningCheck({
      root,
      requiredFiles: files,
      requiredScripts: { "package.json": ["verify:pilot-hardening", "smoke:p95"] },
    });

    assert.deepEqual(result, { ok: true, checkedFiles: 6, checkedPackages: 1 });
  });
});

test("package script assertion reports the missing script name", () => {
  withFixture((root) => {
    writeFixtureFile(root, "package.json", JSON.stringify({ scripts: { check: "node ok" } }));

    assert.throws(
      () => assertPackageScripts({ "package.json": ["check", "verify:pilot-hardening"] }, root),
      /verify:pilot-hardening/,
    );
  });
});

test("text assertion reports missing pilot hardening keywords", () => {
  withFixture((root) => {
    writeFixtureFile(root, "docs/PILOT-HARDENING-KIEROWNIK-BRYGADZISTA.md", "Kierownik GO");

    assert.throws(
      () =>
        assertTextIncludes("docs/PILOT-HARDENING-KIEROWNIK-BRYGADZISTA.md", ["Kierownik", "NO-GO"], root),
      /NO-GO/,
    );
  });
});
