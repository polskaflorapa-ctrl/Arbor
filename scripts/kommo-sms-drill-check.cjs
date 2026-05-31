const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

const requiredFiles = [
  "docs/KOMMO-SMS-INCIDENT-DRILL.md",
  "docs/PRODUCTION-INCIDENT-RUNBOOK.md",
  "docs/ENVIRONMENT-RUNBOOK.md",
  "os/src/routes/tasks.js",
  "os/src/routes/sms.js",
  "os/src/routes/sms-webhooks.js",
  "os/src/routes/ops.js",
  "os/src/services/smsGateway.js",
  "os/src/services/kommo.js",
  "web/src/pages/Integracje.js",
  "web/src/pages/Telefonia.js",
  "web/src/pages/Kierownik.js",
];

const requiredScripts = {
  "package.json": ["verify:kommo-sms-drill", "verify:incident-runbook", "check"],
};

const drillNeedles = [
  "kommo-sync/diagnostics",
  "status=dead_letter",
  "kommo-retry",
  "force",
  "409",
  "queue_errors",
  "retry_count",
  "last_error",
  "sms_history",
  "sms_delivery_events",
  "delivery_error_code",
  "provider_status",
  "resend_zadarma_sms",
  "queue_zadarma_call",
  "ops_action_events",
  "PUBLIC_BASE_URL",
  "GO",
  "NO-GO",
];

const codeNeedles = {
  "os/src/routes/tasks.js": ["kommo-sync/diagnostics", "kommo-retry", "dead_letter", "force", "queue_errors"],
  "os/src/routes/sms.js": ["sms_history", "historia"],
  "os/src/routes/sms-webhooks.js": ["sms_delivery_events", "delivery_error_code", "provider_status"],
  "os/src/routes/ops.js": ["sms_delivery", "resend_zadarma_sms", "queue_zadarma_call", "ops_action_events"],
  "os/src/services/kommo.js": ["dead_letter", "retry_count", "next_retry_at"],
  "os/src/services/smsGateway.js": ["Zadarma", "sms_history", "provider_status"],
  "web/src/pages/Integracje.js": ["kommo-sync/diagnostics", "dead_letter", "retry_count"],
  "web/src/pages/Telefonia.js": ["Zadarma", "delivery"],
  "web/src/pages/Kierownik.js": ["resend_zadarma_sms", "queue_zadarma_call"],
};

function readJson(relPath, baseDir = root) {
  return JSON.parse(fs.readFileSync(path.join(baseDir, relPath), "utf8"));
}

function assertFilesExist(files = requiredFiles, baseDir = root) {
  const missing = files.filter((file) => !fs.existsSync(path.join(baseDir, file)));
  if (missing.length) {
    throw new Error(`Missing Kommo/SMS drill files: ${missing.join(", ")}`);
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

function assertCodeNeedles(needlesByFile = codeNeedles, baseDir = root) {
  for (const [file, needles] of Object.entries(needlesByFile)) {
    assertTextIncludes(file, needles, baseDir);
  }
}

function runKommoSmsDrillCheck(options = {}) {
  const baseDir = options.root || root;
  assertFilesExist(options.requiredFiles || requiredFiles, baseDir);
  assertPackageScripts(options.requiredScripts || requiredScripts, baseDir);
  assertTextIncludes("docs/KOMMO-SMS-INCIDENT-DRILL.md", options.drillNeedles || drillNeedles, baseDir);
  assertCodeNeedles(options.codeNeedles || codeNeedles, baseDir);

  return {
    ok: true,
    checkedFiles: (options.requiredFiles || requiredFiles).length,
    checkedPackages: Object.keys(options.requiredScripts || requiredScripts).length,
  };
}

if (require.main === module) {
  try {
    const result = runKommoSmsDrillCheck();
    console.log(`[kommo-sms-drill-check] OK (${result.checkedFiles} files, ${result.checkedPackages} package files)`);
  } catch (error) {
    console.error(`[kommo-sms-drill-check] FAILED: ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  runKommoSmsDrillCheck,
  assertFilesExist,
  assertPackageScripts,
  assertTextIncludes,
  assertCodeNeedles,
};
