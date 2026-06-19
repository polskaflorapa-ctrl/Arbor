const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  runMoneyFlowReadinessCheck,
  assertPackageScripts,
  assertTextIncludes,
  assertNeedleMap,
} = require("./money-flow-readiness-check.cjs");

function writeFixtureFile(root, relPath, contents) {
  const fullPath = path.join(root, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, contents);
}

function withFixture(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "money-flow-"));
  try {
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("money-flow readiness check validates scripts, docs, code guards, and tests", () => {
  withFixture((root) => {
    const files = [
      "docs/MONEY-FLOW-READINESS.md",
      "os/src/routes/demoRequests.js",
      "os/src/routes/ksiegowosc.js",
      "os/src/routes/tasks.js",
      "os/tests/tasks.test.js",
    ];
    for (const file of files) writeFixtureFile(root, file, "placeholder");
    writeFixtureFile(
      root,
      "docs/MONEY-FLOW-READINESS.md",
      "landing demo CRM lead crm_lead_id pg_advisory_xact_lock PAYMENT_MISSING_REASON_REQUIRED VALIDATION_FAILED GO NO-GO",
    );
    writeFixtureFile(root, "os/src/routes/demoRequests.js", "ensureDemoCrmLead crm_lead_id INSERT INTO crm_leads landing-demo");
    writeFixtureFile(root, "os/src/routes/ksiegowosc.js", "pg_advisory_xact_lock invoiceIdScope ROLLBACK INSERT INTO invoice_items");
    writeFixtureFile(root, "os/src/routes/tasks.js", "PAYMENT_MISSING_REASON_REQUIRED isNoPaymentReasonMissing");
    writeFixtureFile(root, "os/tests/tasks.test.js", "PAYMENT_MISSING_REASON_REQUIRED");
    writeFixtureFile(root, "package.json", JSON.stringify({ scripts: { "verify:money-flow": "node check", check: "npm test" } }));

    const result = runMoneyFlowReadinessCheck({
      root,
      requiredFiles: files,
      requiredScripts: { "package.json": ["verify:money-flow", "check"] },
      readinessNeedles: {
        "docs/MONEY-FLOW-READINESS.md": ["landing demo", "GO"],
        "os/src/routes/demoRequests.js": ["ensureDemoCrmLead", "crm_lead_id"],
        "os/src/routes/ksiegowosc.js": ["pg_advisory_xact_lock"],
        "os/src/routes/tasks.js": ["PAYMENT_MISSING_REASON_REQUIRED"],
        "os/tests/tasks.test.js": ["PAYMENT_MISSING_REASON_REQUIRED"],
      },
    });

    assert.deepEqual(result, { ok: true, checkedFiles: 5, checkedPackages: 1 });
  });
});

test("money-flow package assertion reports missing verifier", () => {
  withFixture((root) => {
    writeFixtureFile(root, "package.json", JSON.stringify({ scripts: { check: "npm test" } }));

    assert.throws(
      () => assertPackageScripts({ "package.json": ["verify:money-flow"] }, root),
      /verify:money-flow/,
    );
  });
});

test("money-flow text assertion reports missing CRM lead contract", () => {
  withFixture((root) => {
    writeFixtureFile(root, "docs/MONEY-FLOW-READINESS.md", "landing demo");

    assert.throws(
      () => assertTextIncludes("docs/MONEY-FLOW-READINESS.md", ["landing demo", "CRM lead"], root),
      /CRM lead/,
    );
  });
});

test("money-flow needle map reports missing payment guard", () => {
  withFixture((root) => {
    writeFixtureFile(root, "os/src/routes/tasks.js", "finish");

    assert.throws(
      () => assertNeedleMap({ "os/src/routes/tasks.js": ["PAYMENT_MISSING_REASON_REQUIRED"] }, root),
      /PAYMENT_MISSING_REASON_REQUIRED/,
    );
  });
});
