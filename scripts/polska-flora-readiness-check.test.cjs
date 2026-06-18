const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  runPolskaFloraReadinessCheck,
  assertTextIncludes,
  assertPackageScripts,
} = require("./polska-flora-readiness-check.cjs");

function writeFixtureFile(root, relPath, contents) {
  const fullPath = path.join(root, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, contents);
}

function withFixture(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "polska-flora-readiness-"));
  try {
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("Polska Flora readiness check validates docs, scripts, and integration contracts", () => {
  withFixture((root) => {
    const files = [
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
    for (const file of files) writeFixtureFile(root, file, "placeholder");
    writeFixtureFile(
      root,
      "docs/POLSKA_FLORA_MALOPOLSKIE_GO_LIVE.md",
      "Malopolskie pon.-pt. 8-17 brak wycen przez telefon przypomnienia SMS GO NO-GO /telephony/voice-agent/polska-flora/intake Kommo kalendarz wycen kalendarz zasobow",
    );
    writeFixtureFile(
      root,
      "docs/POLSKA_FLORA_MERGE_PLAN.md",
      "Telefon / Ania -> CRM -> Ogledziny -> Wycena -> Ekipa",
    );
    writeFixtureFile(
      root,
      "os/src/routes/telephony.js",
      "/voice-agent/polska-flora/intake x-voice-agent-secret crm_leads voice_agent_intakes INSERT INTO ogledziny",
    );
    writeFixtureFile(
      root,
      "os/tests/telephony.test.js",
      "accepts voice agent intake and creates CRM lead plus call log allows voice agent intake with branch integration secret",
    );
    writeFixtureFile(
      root,
      "os/tests/kommo-task-inbound-webhook.test.js",
      "applies task.sync idempotently maps Kommo lead fields",
    );
    writeFixtureFile(
      root,
      "os/tests/kommo-config.test.js",
      "GET /api/kommo/config PUT /api/kommo/config",
    );
    writeFixtureFile(
      root,
      "web/src/pages/DashboardPolskaFlora.js",
      "Telefon / Ania CRM Oględziny Wycena Ekipa Przyjmij telefon CRM dzisiaj Dzisiaj do ogarni Gotowość zleceń Co blokuje pieniądze",
    );
    writeFixtureFile(
      root,
      "web/src/utils/taskReadiness.js",
      "TASK_READINESS_CHECKS phone address scope planned_date quote team summarizeTaskReadiness",
    );
    writeFixtureFile(
      root,
      "web/src/utils/testMode.js",
      "Wycinka drzew Pielęgnacja drzew Mycie / malowanie dachów Czyszczenie kostki / elewacji Projekt i pielegnacja ogrodu",
    );
    writeFixtureFile(
      root,
      "package.json",
      JSON.stringify({ scripts: { "verify:polska-flora-ready": "node script", check: "npm test" } }),
    );

    const result = runPolskaFloraReadinessCheck({ root, requiredFiles: files });

    assert.deepEqual(result, { ok: true, checkedFiles: files.length, checkedPackages: 1 });
  });
});

test("Polska Flora readiness package assertion reports missing script", () => {
  withFixture((root) => {
    writeFixtureFile(root, "package.json", JSON.stringify({ scripts: { check: "node ok" } }));
    assert.throws(
      () => assertPackageScripts({ "package.json": ["verify:polska-flora-ready"] }, root),
      /verify:polska-flora-ready/,
    );
  });
});

test("Polska Flora readiness text assertion reports missing checklist gate", () => {
  withFixture((root) => {
    writeFixtureFile(root, "docs/POLSKA_FLORA_MALOPOLSKIE_GO_LIVE.md", "Malopolskie");
    assert.throws(
      () => assertTextIncludes("docs/POLSKA_FLORA_MALOPOLSKIE_GO_LIVE.md", ["GO", "NO-GO"], root),
      /GO/,
    );
  });
});
