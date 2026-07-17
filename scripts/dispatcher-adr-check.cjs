const path = require("node:path");
const { createRepositoryAssertions } = require("./lib/repository-contract.cjs");

const root = path.resolve(__dirname, "..");

const requiredFiles = [
  "docs/DISPATCHER-ARCHITECTURE-DECISION.md",
  "docs/ARBOR-full-scope-implementation-backlog.md",
  "docs/HORIZONTAL-SCALING-READINESS.md",
  "docs/PILOT-ONE-BRANCH-CHECKLIST.md",
  "os/src/services/vrp.js",
  "os/src/routes/dispatch.js",
];

const requiredScripts = {
  "package.json": ["verify:dispatcher-adr", "verify:scale-readiness", "check"],
};

const adrNeedles = [
  "OR-Tools",
  "Google Routes",
  "Google Route Optimization",
  "Mapbox",
  "arbor-clarke-wright",
  "solver worker",
  "DISPATCH_SOLVER_TARGET_MS",
  "stats.solver_engine",
  "solver_sla_ok",
  "unassigned.reason",
  "Google Route Optimization usage and billing",
  "Mapbox pricing",
  "GO",
  "NO-GO",
];

const codeNeedles = {
  "os/src/services/vrp.js": [
    "solver_engine",
    "arbor-clarke-wright",
    "unassigned",
    "no_capable_team",
    "time_window_missed",
    "capacity_exceeded",
  ],
  "os/src/routes/dispatch.js": [
    "DISPATCH_SOLVER_TARGET_MS",
    "solver_target_ms",
    "solver_sla_ok",
    "dispatch_plans",
    "attachDispatchBenchmark",
  ],
};

const docsNeedles = {
  "docs/ARBOR-full-scope-implementation-backlog.md": [
    "dispatcher architecture decision",
    "docs/DISPATCHER-ARCHITECTURE-DECISION.md",
    "verify:dispatcher-adr",
    "1.2",
  ],
  "docs/HORIZONTAL-SCALING-READINESS.md": ["DISPATCH_SOLVER_TARGET_MS", "worker"],
  "docs/PILOT-ONE-BRANCH-CHECKLIST.md": [
    "verify:dispatcher-adr",
    "DISPATCHER-ARCHITECTURE-DECISION.md",
  ],
};

const {
  assertFilesExist,
  assertNeedleMap,
  assertPackageScripts,
  assertTextIncludes,
} = createRepositoryAssertions({
  root,
  requiredFiles,
  requiredScripts,
  missingFilesLabel: "Missing dispatcher ADR files",
});

function runDispatcherAdrCheck(options = {}) {
  const baseDir = options.root || root;
  assertFilesExist(options.requiredFiles || requiredFiles, baseDir);
  assertPackageScripts(options.requiredScripts || requiredScripts, baseDir);
  assertTextIncludes("docs/DISPATCHER-ARCHITECTURE-DECISION.md", options.adrNeedles || adrNeedles, baseDir);
  assertNeedleMap(options.codeNeedles || codeNeedles, baseDir);
  assertNeedleMap(options.docsNeedles || docsNeedles, baseDir);

  return {
    ok: true,
    checkedFiles: (options.requiredFiles || requiredFiles).length,
    checkedPackages: Object.keys(options.requiredScripts || requiredScripts).length,
  };
}

if (require.main === module) {
  try {
    const result = runDispatcherAdrCheck();
    console.log(`[dispatcher-adr-check] OK (${result.checkedFiles} files, ${result.checkedPackages} package files)`);
  } catch (error) {
    console.error(`[dispatcher-adr-check] FAILED: ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  runDispatcherAdrCheck,
  assertFilesExist,
  assertPackageScripts,
  assertTextIncludes,
  assertNeedleMap,
};
