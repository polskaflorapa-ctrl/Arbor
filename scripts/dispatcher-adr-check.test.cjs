const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  runDispatcherAdrCheck,
  assertNeedleMap,
  assertPackageScripts,
  assertTextIncludes,
} = require("./dispatcher-adr-check.cjs");

function writeFixtureFile(root, relPath, contents) {
  const fullPath = path.join(root, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, contents);
}

function withFixture(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dispatcher-adr-"));
  try {
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("dispatcher ADR check validates script, ADR, docs, and solver code", () => {
  withFixture((root) => {
    const files = [
      "docs/DISPATCHER-ARCHITECTURE-DECISION.md",
      "docs/ARBOR-full-scope-implementation-backlog.md",
      "docs/PILOT-ONE-BRANCH-CHECKLIST.md",
      "os/src/services/vrp.js",
      "os/src/routes/dispatch.js",
    ];
    for (const file of files) writeFixtureFile(root, file, "placeholder");

    writeFixtureFile(
      root,
      "docs/DISPATCHER-ARCHITECTURE-DECISION.md",
      "OR-Tools Google Routes Google Route Optimization Mapbox arbor-clarke-wright solver worker DISPATCH_SOLVER_TARGET_MS stats.solver_engine solver_sla_ok unassigned.reason Google Route Optimization usage and billing Mapbox pricing GO NO-GO",
    );
    writeFixtureFile(root, "os/src/services/vrp.js", "solver_engine arbor-clarke-wright unassigned no_capable_team time_window_missed capacity_exceeded");
    writeFixtureFile(root, "os/src/routes/dispatch.js", "DISPATCH_SOLVER_TARGET_MS solver_target_ms solver_sla_ok dispatch_plans attachDispatchBenchmark");
    writeFixtureFile(root, "docs/ARBOR-full-scope-implementation-backlog.md", "dispatcher architecture decision docs/DISPATCHER-ARCHITECTURE-DECISION.md verify:dispatcher-adr 1.2");
    writeFixtureFile(root, "docs/PILOT-ONE-BRANCH-CHECKLIST.md", "verify:dispatcher-adr DISPATCHER-ARCHITECTURE-DECISION.md");
    writeFixtureFile(root, "package.json", JSON.stringify({ scripts: { "verify:dispatcher-adr": "node script", check: "npm test" } }));

    const result = runDispatcherAdrCheck({
      root,
      requiredFiles: files,
      requiredScripts: { "package.json": ["verify:dispatcher-adr", "check"] },
      docsNeedles: {
        "docs/ARBOR-full-scope-implementation-backlog.md": ["verify:dispatcher-adr"],
      },
    });

    assert.deepEqual(result, { ok: true, checkedFiles: 5, checkedPackages: 1 });
  });
});

test("dispatcher package assertion reports missing verifier script", () => {
  withFixture((root) => {
    writeFixtureFile(root, "package.json", JSON.stringify({ scripts: { check: "node ok" } }));

    assert.throws(
      () => assertPackageScripts({ "package.json": ["check", "verify:dispatcher-adr"] }, root),
      /verify:dispatcher-adr/,
    );
  });
});

test("dispatcher ADR assertion reports missing cost source", () => {
  withFixture((root) => {
    writeFixtureFile(root, "docs/DISPATCHER-ARCHITECTURE-DECISION.md", "OR-Tools Mapbox");

    assert.throws(
      () => assertTextIncludes("docs/DISPATCHER-ARCHITECTURE-DECISION.md", ["OR-Tools", "Google Route Optimization usage and billing"], root),
      /Google Route Optimization usage and billing/,
    );
  });
});

test("dispatcher code assertion reports missing solver engine", () => {
  withFixture((root) => {
    writeFixtureFile(root, "os/src/services/vrp.js", "unassigned");

    assert.throws(
      () => assertNeedleMap({ "os/src/services/vrp.js": ["unassigned", "solver_engine"] }, root),
      /solver_engine/,
    );
  });
});

test("actual VRP solver exposes pilot solver engine in stats", () => {
  const { solve } = require("../os/src/services/vrp");

  const result = solve({
    date: "2026-06-01",
    teams: [{
      id: 1,
      nazwa: "Ekipa A",
      depot_lat: 50.06,
      depot_lng: 19.94,
      max_godzin_dzien: 8,
      sprzet_typy: [],
      kompetencje: [],
    }],
    tasks: [{
      id: 101,
      numer: "ADR-101",
      status: "Zaplanowane",
      adres: "Krakow",
      pin_lat: 50.061,
      pin_lng: 19.941,
      czas_obslugi_min: 30,
    }],
  });

  assert.equal(result.stats.solver_engine, "arbor-clarke-wright");
  assert.equal(result.stats.tasks_assigned, 1);
});
