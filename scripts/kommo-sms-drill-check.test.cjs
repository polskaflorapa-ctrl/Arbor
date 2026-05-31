const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  runKommoSmsDrillCheck,
  assertCodeNeedles,
  assertPackageScripts,
  assertTextIncludes,
} = require("./kommo-sms-drill-check.cjs");

function writeFixtureFile(root, relPath, contents) {
  const fullPath = path.join(root, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, contents);
}

function withFixture(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kommo-sms-drill-"));
  try {
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("Kommo/SMS drill check validates files, scripts, drill text, and hooks", () => {
  withFixture((root) => {
    const files = ["docs/KOMMO-SMS-INCIDENT-DRILL.md", "os/src/routes/tasks.js", "os/src/routes/ops.js"];
    for (const file of files) writeFixtureFile(root, file, "placeholder");

    writeFixtureFile(
      root,
      "docs/KOMMO-SMS-INCIDENT-DRILL.md",
      "kommo-sync/diagnostics status=dead_letter kommo-retry force 409 queue_errors retry_count last_error sms_history sms_delivery_events delivery_error_code provider_status resend_zadarma_sms queue_zadarma_call ops_action_events PUBLIC_BASE_URL GO NO-GO",
    );
    writeFixtureFile(root, "os/src/routes/tasks.js", "kommo-sync/diagnostics kommo-retry dead_letter force queue_errors");
    writeFixtureFile(root, "os/src/routes/ops.js", "sms_delivery resend_zadarma_sms queue_zadarma_call ops_action_events");
    writeFixtureFile(
      root,
      "package.json",
      JSON.stringify({ scripts: { "verify:kommo-sms-drill": "node script", check: "npm test" } }),
    );

    const result = runKommoSmsDrillCheck({
      root,
      requiredFiles: files,
      requiredScripts: { "package.json": ["verify:kommo-sms-drill", "check"] },
      codeNeedles: {
        "os/src/routes/tasks.js": ["kommo-sync/diagnostics", "dead_letter"],
        "os/src/routes/ops.js": ["resend_zadarma_sms", "queue_zadarma_call"],
      },
    });

    assert.deepEqual(result, { ok: true, checkedFiles: 3, checkedPackages: 1 });
  });
});

test("Kommo/SMS drill package assertion reports missing script name", () => {
  withFixture((root) => {
    writeFixtureFile(root, "package.json", JSON.stringify({ scripts: { check: "node ok" } }));

    assert.throws(
      () => assertPackageScripts({ "package.json": ["check", "verify:kommo-sms-drill"] }, root),
      /verify:kommo-sms-drill/,
    );
  });
});

test("Kommo/SMS drill text assertion reports missing delivery hook", () => {
  withFixture((root) => {
    writeFixtureFile(root, "docs/KOMMO-SMS-INCIDENT-DRILL.md", "kommo-sync/diagnostics");

    assert.throws(
      () => assertTextIncludes("docs/KOMMO-SMS-INCIDENT-DRILL.md", ["kommo-sync/diagnostics", "sms_delivery_events"], root),
      /sms_delivery_events/,
    );
  });
});

test("Kommo/SMS drill code assertion reports missing force guard", () => {
  withFixture((root) => {
    writeFixtureFile(root, "os/src/routes/tasks.js", "kommo-sync/diagnostics");

    assert.throws(
      () => assertCodeNeedles({ "os/src/routes/tasks.js": ["kommo-sync/diagnostics", "force"] }, root),
      /force/,
    );
  });
});
