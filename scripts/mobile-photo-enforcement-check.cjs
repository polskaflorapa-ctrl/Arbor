const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

const requiredFiles = [
  "docs/MOBILE-BEFORE-AFTER-PHOTO-ENFORCEMENT.md",
  "docs/PILOT-ONE-BRANCH-CHECKLIST.md",
  "docs/ARBOR-full-scope-implementation-backlog.md",
  "mobile/app/zlecenie/[id].tsx",
  "mobile/utils/zlecenie-detail.ts",
  "mobile/utils/offline-queue.ts",
  "os/src/routes/tasks.js",
  "os/src/services/taskSettlement.js",
  "os/tests/tasks.test.js",
];

const requiredScripts = {
  "package.json": ["verify:mobile-photo-enforcement", "check"],
};

const runbookNeedles = [
  "TASK_FINISH_REQUIRE_PRZED_PHOTO",
  "TASK_FINISH_REQUIRE_PO_PHOTO",
  "FINISH_PHOTO_MIN.przed = 2",
  "FINISH_PHOTO_MIN.po = 2",
  "finish_requirements",
  "TASK_FINISH_PRZED_PHOTO_REQUIRED",
  "TASK_FINISH_PO_PHOTO_REQUIRED",
  "offline_pending",
  "GO",
  "NO-GO",
];

const codeNeedles = {
  "os/src/routes/tasks.js": [
    "finishRequirePrzedPhoto",
    "finishRequirePoPhoto",
    "requirePo = finishRequirePoPhoto",
    "requirePrzed = finishRequirePrzedPhoto",
    "TASK_FINISH_PRZED_PHOTO_REQUIRED",
    "TASK_FINISH_PO_PHOTO_REQUIRED",
    "finish_requirements",
  ],
  "os/src/services/taskSettlement.js": [
    "FINISH_PHOTO_MIN",
    "po: 2",
    "przed: 2",
    "countTaskFinishPhotos",
  ],
  "mobile/app/zlecenie/[id].tsx": [
    "finishRequirements",
    "require_przed_photo",
    "require_po_photo",
    "has_przed_photo",
    "has_po_photo",
    "finishBlockedPrzedTitle",
    "finishBlockedPoTitle",
    "finishPhotoBlocked",
    "offline_pending",
  ],
  "mobile/utils/offline-queue.ts": ["queueTaskPhotoOffline", "Idempotency-Key"],
};

const testNeedles = {
  "os/tests/tasks.test.js": [
    "only TASK_FINISH_REQUIRE_PRZED_PHOTO=1",
    "TASK_FINISH_PRZED_PHOTO_REQUIRED",
    "TASK_FINISH_REQUIRE_PO_PHOTO=1",
    "TASK_FINISH_PO_PHOTO_REQUIRED",
  ],
};

const docsNeedles = {
  "docs/PILOT-ONE-BRANCH-CHECKLIST.md": [
    "verify:mobile-photo-enforcement",
    "MOBILE-BEFORE-AFTER-PHOTO-ENFORCEMENT.md",
  ],
  "docs/ARBOR-full-scope-implementation-backlog.md": [
    "mobile before/after photo enforcement",
    "verify:mobile-photo-enforcement",
    "2.3",
  ],
};

function readJson(relPath, baseDir = root) {
  return JSON.parse(fs.readFileSync(path.join(baseDir, relPath), "utf8"));
}

function assertFilesExist(files = requiredFiles, baseDir = root) {
  const missing = files.filter((file) => !fs.existsSync(path.join(baseDir, file)));
  if (missing.length) throw new Error(`Missing mobile photo enforcement files: ${missing.join(", ")}`);
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

function runMobilePhotoEnforcementCheck(options = {}) {
  const baseDir = options.root || root;
  assertFilesExist(options.requiredFiles || requiredFiles, baseDir);
  assertPackageScripts(options.requiredScripts || requiredScripts, baseDir);
  assertTextIncludes("docs/MOBILE-BEFORE-AFTER-PHOTO-ENFORCEMENT.md", options.runbookNeedles || runbookNeedles, baseDir);
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
    const result = runMobilePhotoEnforcementCheck();
    console.log(`[mobile-photo-enforcement-check] OK (${result.checkedFiles} files, ${result.checkedPackages} package files)`);
  } catch (error) {
    console.error(`[mobile-photo-enforcement-check] FAILED: ${error.message}`);
    process.exit(1);
  }
}

module.exports = { runMobilePhotoEnforcementCheck, assertFilesExist, assertPackageScripts, assertTextIncludes, assertNeedleMap };
