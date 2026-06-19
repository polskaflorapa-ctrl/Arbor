const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

const requiredFiles = [
  "docs/MONEY-FLOW-READINESS.md",
  "os/src/routes/demoRequests.js",
  "os/src/routes/ksiegowosc.js",
  "os/src/routes/tasks.js",
  "os/src/schemas/invoice.js",
  "os/src/services/taskSettlement.js",
  "os/tests/demoRequests.test.js",
  "os/tests/ksiegowosc.test.js",
  "os/tests/tasks.test.js",
  "os/tests/taskSettlement.test.js",
  "web/src/pages/DemoRequests.js",
];

const requiredScripts = {
  "package.json": ["verify:money-flow", "check"],
};

const readinessNeedles = {
  "docs/MONEY-FLOW-READINESS.md": [
    "landing demo",
    "CRM lead",
    "crm_lead_id",
    "pg_advisory_xact_lock",
    "PAYMENT_MISSING_REASON_REQUIRED",
    "VALIDATION_FAILED",
    "GO",
    "NO-GO",
  ],
  "os/src/routes/demoRequests.js": [
    "ensureDemoCrmLead",
    "crm_lead_id",
    "INSERT INTO crm_leads",
    "landing-demo",
  ],
  "web/src/pages/DemoRequests.js": [
    "crm_lead_id",
    "/crm/pipeline?lead_id=",
    "Szansa #",
  ],
  "os/src/routes/ksiegowosc.js": [
    "pg_advisory_xact_lock",
    "invoiceIdScope",
    "ROLLBACK",
    "INSERT INTO invoice_items",
  ],
  "os/src/schemas/invoice.js": [
    "Cena netto nie moze byc ujemna",
    "Stawka VAT nie moze przekraczac 100%",
  ],
  "os/src/routes/tasks.js": [
    "PAYMENT_MISSING_REASON_REQUIRED",
    "isNoPaymentReasonMissing",
    "INSERT INTO task_client_payments",
    "task_calc_log",
  ],
  "os/src/services/taskSettlement.js": [
    "isNoPaymentReasonMissing",
    "isCashCollectionNoteMissing",
    "settlementCalcDetail",
  ],
  "os/tests/demoRequests.test.js": [
    "crm_lead_id",
    "INSERT INTO crm_leads",
  ],
  "os/tests/ksiegowosc.test.js": [
    "pg_advisory_xact_lock",
    "rejects invoice items with a negative net price",
    "scopes invoice detail access to the manager branch",
  ],
  "os/tests/tasks.test.js": [
    "PAYMENT_MISSING_REASON_REQUIRED",
    "requires a reason when a paid task is closed with no payment",
  ],
  "os/tests/taskSettlement.test.js": [
    "isNoPaymentReasonMissing",
  ],
};

function readJson(relPath, baseDir = root) {
  return JSON.parse(fs.readFileSync(path.join(baseDir, relPath), "utf8"));
}

function assertFilesExist(files = requiredFiles, baseDir = root) {
  const missing = files.filter((file) => !fs.existsSync(path.join(baseDir, file)));
  if (missing.length) throw new Error(`Missing money-flow readiness files: ${missing.join(", ")}`);
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
  if (missing.length) throw new Error(`${relPath} is missing: ${missing.join(", ")}`);
}

function assertNeedleMap(needlesByFile = readinessNeedles, baseDir = root) {
  for (const [file, needles] of Object.entries(needlesByFile)) {
    assertTextIncludes(file, needles, baseDir);
  }
}

function runMoneyFlowReadinessCheck(options = {}) {
  const baseDir = options.root || root;
  const files = options.requiredFiles || requiredFiles;
  assertFilesExist(files, baseDir);
  assertPackageScripts(options.requiredScripts || requiredScripts, baseDir);
  assertNeedleMap(options.readinessNeedles || readinessNeedles, baseDir);
  return {
    ok: true,
    checkedFiles: files.length,
    checkedPackages: Object.keys(options.requiredScripts || requiredScripts).length,
  };
}

if (require.main === module) {
  try {
    const result = runMoneyFlowReadinessCheck();
    console.log(`[money-flow-readiness-check] OK (${result.checkedFiles} files, ${result.checkedPackages} package files)`);
  } catch (error) {
    console.error(`[money-flow-readiness-check] FAILED: ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  runMoneyFlowReadinessCheck,
  assertFilesExist,
  assertPackageScripts,
  assertTextIncludes,
  assertNeedleMap,
};
