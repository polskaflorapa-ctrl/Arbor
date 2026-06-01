const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

const requiredFiles = [
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

const requiredScripts = {
  "package.json": ["verify:mobile-material-cost-flow", "check"],
  "mobile/package.json": ["test:offline-queue", "test:zlecenie-detail", "smoke:mobile"],
};

const runbookNeedles = [
  "finishUsageNazwa",
  "finishUsageIlosc",
  "finishUsageKoszt",
  "finishOperationalCosts.paliwo",
  "finishOperationalCosts.utylizacja",
  "zuzyte_materialy",
  "koszty_operacyjne",
  "queueTaskFinishOffline",
  "mobile_finish_payload",
  "GO",
  "NO-GO",
];

const codeNeedles = {
  "mobile/app/zlecenie/[id].tsx": [
    "finishUsageNazwa",
    "finishUsageIlosc",
    "finishUsageKoszt",
    "finishOperationalCosts",
    "buildFinishMaterialUsage",
    "buildFinishOperationalCostRows",
    "buildFinishBody",
    "queueTaskFinishOffline",
    "addPendingOfflineFinish",
  ],
  "mobile/utils/zlecenie-detail.ts": [
    "parseOptionalFinishMoney",
    "buildFinishMaterialUsage",
    "buildFinishOperationalCostRows",
    "buildFinishBody",
    "zuzyte_materialy",
    "koszty_operacyjne",
    "suggestedFinishOperationalCosts",
    "FinishOperationalCostRow",
    "mobile_finish",
  ],
  "mobile/scripts/test-offline-queue.cjs": [
    "mobile_finish_payload",
    "queueTaskFinishOffline",
    "finish:finish-offline-1",
    "zuzyte_materialy",
    "koszty_operacyjne",
    "paliwo",
    "utylizacja",
  ],
  "mobile/scripts/test-zlecenie-detail.cjs": [
    "parseOptionalFinishMoney",
    "buildFinishMaterialUsage",
    "buildFinishOperationalCostRows",
    "buildFinishBody",
    "suggestedFinishOperationalCosts",
  ],
  "os/src/routes/tasks.js": [
    "TASK_FINISH_REQUIRE_MATERIAL_USAGE",
    "validateFinishCostPayload",
    "insertFinishMaterialUsageRows",
    "insertOperationalCostRows",
    "task_finish_material_usage",
    "task_operational_costs",
  ],
  "os/src/services/taskFinishCosts.js": [
    "validateFinishCostPayload",
    "material_total_max",
    "total_operational_max",
    "paliwo",
    "utylizacja",
  ],
  "os/src/routes/bi.js": [
    "task_finish_material_usage",
    "task_operational_costs",
    "koszt_paliwa",
    "koszt_materialow",
    "koszt_utylizacji",
  ],
  "os/src/services/kommo.js": [
    "material_usage",
    "material_cost",
    "fuel_cost",
    "disposal_cost",
    "total_known_cost",
  ],
};

const testNeedles = {
  "os/tests/tasks.test.js": [
    "TASK_FINISH_REQUIRE_MATERIAL_USAGE",
    "TASK_FINISH_MATERIAL_USAGE_REQUIRED",
    "zuzyte_materialy",
  ],
  "os/tests/taskFinishCosts.test.js": [
    "validateFinishCostPayload",
    "operationalRows",
    "paliwo",
    "utylizacja",
  ],
  "os/tests/critical-path-smoke.test.js": [
    "finish-cost-suggestions",
    "paliwo",
    "utylizacja",
    "material_usage",
    "total_known_cost",
  ],
};

const docsNeedles = {
  "docs/PILOT-ONE-BRANCH-CHECKLIST.md": ["verify:mobile-material-cost-flow", "MOBILE-MATERIAL-OFFLINE-COST-FLOW.md"],
  "docs/ARBOR-full-scope-implementation-backlog.md": ["mobile material usage/offline cost flow", "verify:mobile-material-cost-flow", "2.4"],
};

function readJson(relPath, baseDir = root) {
  return JSON.parse(fs.readFileSync(path.join(baseDir, relPath), "utf8"));
}

function assertFilesExist(files = requiredFiles, baseDir = root) {
  const missing = files.filter((file) => !fs.existsSync(path.join(baseDir, file)));
  if (missing.length) throw new Error(`Missing mobile material cost flow files: ${missing.join(", ")}`);
}

function assertPackageScripts(scriptMap = requiredScripts, baseDir = root) {
  for (const [file, scripts] of Object.entries(scriptMap)) {
    const pkg = readJson(file, baseDir);
    for (const scriptName of scripts) {
      if (!pkg.scripts || !pkg.scripts[scriptName]) throw new Error(`${file} is missing script ${scriptName}`);
    }
  }
}

function assertTextIncludes(relPath, needles, baseDir = root) {
  const text = fs.readFileSync(path.join(baseDir, relPath), "utf8");
  const missing = needles.filter((needle) => !text.includes(needle));
  if (missing.length) throw new Error(`${relPath} is missing: ${missing.join(", ")}`);
}

function assertNeedleMap(needlesByFile, baseDir = root) {
  for (const [file, needles] of Object.entries(needlesByFile)) {
    assertTextIncludes(file, needles, baseDir);
  }
}

function runMobileMaterialCostFlowCheck(options = {}) {
  const baseDir = options.root || root;
  assertFilesExist(options.requiredFiles || requiredFiles, baseDir);
  assertPackageScripts(options.requiredScripts || requiredScripts, baseDir);
  assertTextIncludes("docs/MOBILE-MATERIAL-OFFLINE-COST-FLOW.md", options.runbookNeedles || runbookNeedles, baseDir);
  assertNeedleMap(options.codeNeedles || codeNeedles, baseDir);
  assertNeedleMap(options.testNeedles || testNeedles, baseDir);
  assertNeedleMap(options.docsNeedles || docsNeedles, baseDir);
  return {
    ok: true,
    checkedFiles: (options.requiredFiles || requiredFiles).length,
    checkedPackages: Object.keys(options.requiredScripts || requiredScripts).length,
  };
}

if (require.main === module) {
  try {
    const result = runMobileMaterialCostFlowCheck();
    console.log(`[mobile-material-cost-flow-check] OK (${result.checkedFiles} files, ${result.checkedPackages} package files)`);
  } catch (error) {
    console.error(`[mobile-material-cost-flow-check] FAILED: ${error.message}`);
    process.exit(1);
  }
}

module.exports = { runMobileMaterialCostFlowCheck, assertFilesExist, assertPackageScripts, assertTextIncludes, assertNeedleMap };
