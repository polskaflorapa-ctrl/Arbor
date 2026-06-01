const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  runMobileMaterialCostFlowCheck,
  assertNeedleMap,
  assertPackageScripts,
  assertTextIncludes,
} = require("./mobile-material-cost-flow-check.cjs");

function writeFixtureFile(root, relPath, contents) {
  const fullPath = path.join(root, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, contents);
}

function withFixture(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mobile-material-cost-flow-"));
  try {
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("mobile material cost flow check validates docs, scripts, mobile helpers, offline payload, backend, BI, and Kommo", () => {
  withFixture((root) => {
    const files = [
      "docs/MOBILE-MATERIAL-OFFLINE-COST-FLOW.md",
      "docs/PILOT-ONE-BRANCH-CHECKLIST.md",
      "docs/ARBOR-full-scope-implementation-backlog.md",
      "mobile/app/zlecenie/[id].tsx",
      "mobile/utils/zlecenie-detail.ts",
      "mobile/scripts/test-zlecenie-detail.cjs",
      "mobile/scripts/test-offline-queue.cjs",
      "mobile/utils/task-list-cache.ts",
      "os/src/routes/tasks.js",
      "os/src/services/taskFinishCosts.js",
      "os/src/routes/bi.js",
      "os/src/services/kommo.js",
      "os/tests/tasks.test.js",
      "os/tests/taskFinishCosts.test.js",
      "os/tests/critical-path-smoke.test.js",
    ];
    for (const file of files) writeFixtureFile(root, file, "placeholder");
    writeFixtureFile(root, "docs/MOBILE-MATERIAL-OFFLINE-COST-FLOW.md", "finishUsageNazwa finishUsageIlosc finishUsageKoszt finishOperationalCosts.paliwo finishOperationalCosts.utylizacja zuzyte_materialy koszty_operacyjne queueTaskFinishOffline mobile_finish_payload GO NO-GO");
    writeFixtureFile(root, "mobile/app/zlecenie/[id].tsx", "finishUsageNazwa finishUsageIlosc finishUsageKoszt finishOperationalCosts buildFinishMaterialUsage buildFinishOperationalCostRows buildFinishBody queueTaskFinishOffline addPendingOfflineFinish");
    writeFixtureFile(root, "mobile/utils/zlecenie-detail.ts", "parseOptionalFinishMoney buildFinishMaterialUsage buildFinishOperationalCostRows buildFinishBody zuzyte_materialy koszty_operacyjne suggestedFinishOperationalCosts FinishOperationalCostRow mobile_finish");
    writeFixtureFile(root, "mobile/scripts/test-offline-queue.cjs", "mobile_finish_payload queueTaskFinishOffline finish:finish-offline-1 zuzyte_materialy koszty_operacyjne paliwo utylizacja");
    writeFixtureFile(root, "mobile/scripts/test-zlecenie-detail.cjs", "parseOptionalFinishMoney buildFinishMaterialUsage buildFinishOperationalCostRows buildFinishBody suggestedFinishOperationalCosts");
    writeFixtureFile(root, "os/src/routes/tasks.js", "TASK_FINISH_REQUIRE_MATERIAL_USAGE validateFinishCostPayload insertFinishMaterialUsageRows insertOperationalCostRows task_finish_material_usage task_operational_costs");
    writeFixtureFile(root, "os/src/services/taskFinishCosts.js", "validateFinishCostPayload material_total_max total_operational_max paliwo utylizacja");
    writeFixtureFile(root, "os/src/routes/bi.js", "task_finish_material_usage task_operational_costs koszt_paliwa koszt_materialow koszt_utylizacji");
    writeFixtureFile(root, "os/src/services/kommo.js", "material_usage material_cost fuel_cost disposal_cost total_known_cost");
    writeFixtureFile(root, "os/tests/tasks.test.js", "TASK_FINISH_REQUIRE_MATERIAL_USAGE TASK_FINISH_MATERIAL_USAGE_REQUIRED zuzyte_materialy");
    writeFixtureFile(root, "os/tests/taskFinishCosts.test.js", "validateFinishCostPayload operationalRows paliwo utylizacja");
    writeFixtureFile(root, "os/tests/critical-path-smoke.test.js", "finish-cost-suggestions paliwo utylizacja material_usage total_known_cost");
    writeFixtureFile(root, "docs/PILOT-ONE-BRANCH-CHECKLIST.md", "verify:mobile-material-cost-flow MOBILE-MATERIAL-OFFLINE-COST-FLOW.md");
    writeFixtureFile(root, "docs/ARBOR-full-scope-implementation-backlog.md", "mobile material usage/offline cost flow verify:mobile-material-cost-flow 2.4");
    writeFixtureFile(root, "package.json", JSON.stringify({ scripts: { "verify:mobile-material-cost-flow": "node script", check: "npm test" } }));
    writeFixtureFile(root, "mobile/package.json", JSON.stringify({ scripts: { "test:offline-queue": "node script", "test:zlecenie-detail": "node script", "smoke:mobile": "node script" } }));

    const result = runMobileMaterialCostFlowCheck({ root });

    assert.deepEqual(result, { ok: true, checkedFiles: 15, checkedPackages: 2 });
  });
});

test("mobile material package assertion reports missing verifier", () => {
  withFixture((root) => {
    writeFixtureFile(root, "package.json", JSON.stringify({ scripts: { check: "node ok" } }));
    assert.throws(() => assertPackageScripts({ "package.json": ["check", "verify:mobile-material-cost-flow"] }, root), /verify:mobile-material-cost-flow/);
  });
});

test("mobile material runbook assertion reports missing offline payload", () => {
  withFixture((root) => {
    writeFixtureFile(root, "docs/MOBILE-MATERIAL-OFFLINE-COST-FLOW.md", "GO NO-GO");
    assert.throws(() => assertTextIncludes("docs/MOBILE-MATERIAL-OFFLINE-COST-FLOW.md", ["mobile_finish_payload"], root), /mobile_finish_payload/);
  });
});

test("mobile material code assertion reports missing backend persistence", () => {
  withFixture((root) => {
    writeFixtureFile(root, "os/src/routes/tasks.js", "TASK_FINISH_REQUIRE_MATERIAL_USAGE");
    assert.throws(() => assertNeedleMap({ "os/src/routes/tasks.js": ["task_finish_material_usage", "task_operational_costs"] }, root), /task_finish_material_usage/);
  });
});
