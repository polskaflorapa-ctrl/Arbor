const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

const requiredFiles = [
  "docs/WEB-TTI-SMOKE-RUNBOOK.md",
  "docs/OBSERVABILITY-SLO-RUNBOOK.md",
  "docs/PILOT-ONE-BRANCH-CHECKLIST.md",
  "web/scripts/smoke-tti.cjs",
  "web/scripts/smoke-routes.cjs",
  "web/package.json",
];

const requiredScripts = {
  "package.json": ["verify:web-tti", "smoke:web:tti", "check"],
  "web/package.json": ["smoke:tti", "smoke:routes", "build", "start"],
};

const runbookNeedles = [
  "TTI",
  "3000 ms",
  "smoke:web:tti",
  "ARBOR_WEB_TTI_BASE",
  "--threshold 3000",
  "--routes",
  "--mobile",
  "output/playwright/web-tti-smoke-results.json",
  "GO",
  "NO-GO",
];

const codeNeedles = {
  "web/scripts/smoke-tti.cjs": [
    "DEFAULT_THRESHOLD_MS = 3000",
    "DEFAULT_ROUTES",
    "performance.now",
    "textLength",
    "overflowX",
    "console_or_network_error",
    "web-tti-smoke-results.json",
  ],
};

const docsNeedles = {
  "docs/OBSERVABILITY-SLO-RUNBOOK.md": ["smoke:web:tti", "TTI", "3000 ms"],
  "docs/PILOT-ONE-BRANCH-CHECKLIST.md": ["verify:web-tti", "smoke:web:tti", "TTI"],
};

function readJson(relPath, baseDir = root) {
  return JSON.parse(fs.readFileSync(path.join(baseDir, relPath), "utf8"));
}

function assertFilesExist(files = requiredFiles, baseDir = root) {
  const missing = files.filter((file) => !fs.existsSync(path.join(baseDir, file)));
  if (missing.length) {
    throw new Error(`Missing web TTI smoke files: ${missing.join(", ")}`);
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

function assertNeedleMap(needlesByFile, baseDir = root) {
  for (const [file, needles] of Object.entries(needlesByFile)) {
    assertTextIncludes(file, needles, baseDir);
  }
}

function runWebTtiCheck(options = {}) {
  const baseDir = options.root || root;
  assertFilesExist(options.requiredFiles || requiredFiles, baseDir);
  assertPackageScripts(options.requiredScripts || requiredScripts, baseDir);
  assertTextIncludes("docs/WEB-TTI-SMOKE-RUNBOOK.md", options.runbookNeedles || runbookNeedles, baseDir);
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
    const result = runWebTtiCheck();
    console.log(`[web-tti-check] OK (${result.checkedFiles} files, ${result.checkedPackages} package files)`);
  } catch (error) {
    console.error(`[web-tti-check] FAILED: ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  runWebTtiCheck,
  assertFilesExist,
  assertPackageScripts,
  assertTextIncludes,
  assertNeedleMap,
};
