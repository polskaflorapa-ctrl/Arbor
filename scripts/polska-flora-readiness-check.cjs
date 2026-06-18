const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

const requiredFiles = [
  "docs/POLSKA_FLORA_MALOPOLSKIE_GO_LIVE.md",
  "docs/POLSKA_FLORA_MERGE_PLAN.md",
  "os/src/routes/telephony.js",
  "os/tests/telephony.test.js",
  "os/tests/kommo-task-inbound-webhook.test.js",
  "os/tests/kommo-config.test.js",
  "web/src/pages/DashboardPolskaFlora.js",
  "web/src/utils/taskReadiness.js",
  "web/src/utils/testMode.js",
];

const requiredScripts = {
  "package.json": ["verify:polska-flora-ready", "check"],
};

const readinessNeedles = {
  "docs/POLSKA_FLORA_MALOPOLSKIE_GO_LIVE.md": [
    "Malopolskie",
    "pon.-pt. 8-17",
    "brak wycen przez telefon",
    "przypomnienia SMS",
    "GO",
    "NO-GO",
    "/telephony/voice-agent/polska-flora/intake",
    "Kommo",
    "kalendarz wycen",
    "kalendarz zasobow",
  ],
  "docs/POLSKA_FLORA_MERGE_PLAN.md": [
    "Telefon / Ania -> CRM -> Ogledziny -> Wycena -> Ekipa",
  ],
  "os/src/routes/telephony.js": [
    "/voice-agent/polska-flora/intake",
    "x-voice-agent-secret",
    "crm_leads",
    "voice_agent_intakes",
    "INSERT INTO ogledziny",
  ],
  "os/tests/telephony.test.js": [
    "accepts voice agent intake and creates CRM lead plus call log",
    "allows voice agent intake with branch integration secret",
  ],
  "os/tests/kommo-task-inbound-webhook.test.js": [
    "applies task.sync idempotently",
    "maps Kommo lead fields",
  ],
  "os/tests/kommo-config.test.js": [
    "GET /api/kommo/config",
    "PUT /api/kommo/config",
  ],
  "web/src/pages/DashboardPolskaFlora.js": [
    "Telefon / Ania",
    "CRM",
    "Oględziny",
    "Wycena",
    "Ekipa",
    "Przyjmij telefon",
    "CRM dzisiaj",
    "Dzisiaj do ogarni",
    "Gotowość zleceń",
    "Co blokuje pieniądze",
  ],
  "web/src/utils/taskReadiness.js": [
    "TASK_READINESS_CHECKS",
    "phone",
    "address",
    "scope",
    "planned_date",
    "quote",
    "team",
    "summarizeTaskReadiness",
  ],
  "web/src/utils/testMode.js": [
    "Wycinka drzew",
    "Pielęgnacja drzew",
    "Mycie / malowanie dachów",
    "Czyszczenie kostki / elewacji",
    "Projekt i pielegnacja ogrodu",
  ],
};

function readJson(relPath, baseDir = root) {
  return JSON.parse(fs.readFileSync(path.join(baseDir, relPath), "utf8"));
}

function assertFilesExist(files = requiredFiles, baseDir = root) {
  const missing = files.filter((file) => !fs.existsSync(path.join(baseDir, file)));
  if (missing.length) throw new Error(`Missing Polska Flora readiness files: ${missing.join(", ")}`);
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

function assertReadinessNeedles(needlesByFile = readinessNeedles, baseDir = root) {
  for (const [file, needles] of Object.entries(needlesByFile)) {
    assertTextIncludes(file, needles, baseDir);
  }
}

function runPolskaFloraReadinessCheck(options = {}) {
  const baseDir = options.root || root;
  const files = options.requiredFiles || requiredFiles;
  assertFilesExist(files, baseDir);
  assertPackageScripts(options.requiredScripts || requiredScripts, baseDir);
  assertReadinessNeedles(options.readinessNeedles || readinessNeedles, baseDir);
  return {
    ok: true,
    checkedFiles: files.length,
    checkedPackages: Object.keys(options.requiredScripts || requiredScripts).length,
  };
}

if (require.main === module) {
  try {
    const result = runPolskaFloraReadinessCheck();
    console.log(`[polska-flora-readiness-check] OK (${result.checkedFiles} files, ${result.checkedPackages} package files)`);
  } catch (error) {
    console.error(`[polska-flora-readiness-check] FAILED: ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  runPolskaFloraReadinessCheck,
  assertFilesExist,
  assertPackageScripts,
  assertTextIncludes,
  assertReadinessNeedles,
};
