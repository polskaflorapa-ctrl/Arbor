const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

const requiredFiles = [
  "docs/PILOT-ONE-BRANCH-CHECKLIST.md",
  "docs/PILOT-HARDENING-KIEROWNIK-BRYGADZISTA.md",
  "docs/ENVIRONMENT-RUNBOOK.md",
  "docs/backup-restore.md",
  "docs/MOBILE-OFFLINE-CONTRACT.md",
  "mobile/docs/mobile-offline-field-flow-checklist.md",
];

const requiredScripts = {
  "package.json": [
    "check",
    "verify:env-runbook",
    "verify:pilot-hardening",
    "verify:fleet-repair-parts-cost",
    "smoke:critical-path",
    "smoke:operational",
    "smoke:demo:e2e",
    "deploy:prod:dry-run",
    "smoke:p95",
    "smoke:web:tti",
  ],
  "web/package.json": ["smoke:routes", "smoke:demo:e2e", "smoke:kommo:crm"],
  "os/package.json": ["smoke:field", "smoke:office", "smoke:operational"],
  "mobile/package.json": ["smoke:mobile", "release:check:quick", "test:offline-queue"],
};

const hardeningNeedles = [
  "Kierownik",
  "Brygadzista",
  "canViewFinance",
  "offline",
  "Idempotency-Key",
  "Kommo",
  "SMS",
  "audit_log",
  "verify:fleet-repair-parts-cost",
  "koszty napraw floty",
  "deploy:prod:dry-run",
  "smoke:p95",
  "smoke:web:tti",
  "--threshold 500",
  "--threshold 3000",
  "GO",
  "NO-GO",
];

function readJson(relPath, baseDir = root) {
  return JSON.parse(fs.readFileSync(path.join(baseDir, relPath), "utf8"));
}

function assertFilesExist(files = requiredFiles, baseDir = root) {
  const missing = files.filter((file) => !fs.existsSync(path.join(baseDir, file)));
  if (missing.length) {
    throw new Error(`Missing pilot hardening files: ${missing.join(", ")}`);
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

function runPilotHardeningCheck(options = {}) {
  const baseDir = options.root || root;
  assertFilesExist(options.requiredFiles || requiredFiles, baseDir);
  assertPackageScripts(options.requiredScripts || requiredScripts, baseDir);
  assertTextIncludes(
    "docs/PILOT-HARDENING-KIEROWNIK-BRYGADZISTA.md",
    options.hardeningNeedles || hardeningNeedles,
    baseDir,
  );

  return {
    ok: true,
    checkedFiles: (options.requiredFiles || requiredFiles).length,
    checkedPackages: Object.keys(options.requiredScripts || requiredScripts).length,
  };
}

if (require.main === module) {
  try {
    const result = runPilotHardeningCheck();
    console.log(
      `[pilot-hardening-check] OK (${result.checkedFiles} files, ${result.checkedPackages} package files)`,
    );
  } catch (error) {
    console.error(`[pilot-hardening-check] FAILED: ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  runPilotHardeningCheck,
  assertFilesExist,
  assertPackageScripts,
  assertTextIncludes,
};
