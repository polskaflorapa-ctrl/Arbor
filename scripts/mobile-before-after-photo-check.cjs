const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

const requiredFiles = [
  "docs/MOBILE-BEFORE-AFTER-PHOTO-ENFORCEMENT.md",
  "docs/PILOT-ONE-BRANCH-CHECKLIST.md",
  "docs/ARBOR-full-scope-implementation-backlog.md",
  "mobile/app/zlecenie/[id].tsx",
  "mobile/components/task-photo-add-modal.tsx",
  "mobile/components/task-photo-preview-modal.tsx",
  "mobile/utils/offline-queue.ts",
  "mobile/scripts/test-offline-queue.cjs",
  "os/src/routes/tasks.js",
  "os/src/services/taskSettlement.js",
  "os/tests/tasks.test.js",
  "os/.env.example",
];

const requiredScripts = {
  "package.json": ["verify:mobile-before-after-photo", "check"],
  "mobile/package.json": ["test:offline-queue", "smoke:mobile"],
};

const runbookNeedles = [
  "TASK_FINISH_REQUIRE_PRZED_PHOTO_BRANCHES",
  "TASK_FINISH_REQUIRE_PO_PHOTO_BRANCHES",
  "finish_requirements",
  "queueTaskPhotoOffline",
  "offline_pending",
  "Przed",
  "Po",
  "GO",
  "NO-GO",
];

const codeNeedles = {
  "os/src/routes/tasks.js": [
    "TASK_FINISH_REQUIRE_PO_PHOTO_BRANCHES",
    "TASK_FINISH_REQUIRE_PRZED_PHOTO_BRANCHES",
    "finishRequirePoPhoto(row.oddzial_id)",
    "finishRequirePrzedPhoto(row.oddzial_id)",
    "assertTeamFinishPhotoRules(client, task)",
    "TASK_FINISH_PO_PHOTO_REQUIRED",
    "TASK_FINISH_PRZED_PHOTO_REQUIRED",
  ],
  "os/src/services/taskSettlement.js": ["FINISH_PHOTO_MIN", "countTaskFinishPhotos", "'po', 'after'", "'przed', 'before', 'checkin'"],
  "mobile/app/zlecenie/[id].tsx": [
    "TaskPhotoAddModal",
    "TaskPhotoPreviewModal",
    "finishRequirements.require_przed_photo",
    "finishRequirements.require_po_photo",
    "finishBeforePhotoReady",
    "finishAfterPhotoReady",
    "photos-before",
    "zrobZdjecie('przed'",
    "zrobZdjecie('po'",
    "offline_pending",
  ],
  "mobile/components/task-photo-add-modal.tsx": [
    "TaskPhotoAddModal",
    "PHOTO_TYPE_LABELS",
    "TYP_ZDJECIA_KEYS",
    "PlatinumIconName",
    "onSelectType(key, photoOpisDraft, photoTagiDraft)",
  ],
  "mobile/components/task-photo-preview-modal.tsx": [
    "TaskPhotoPreviewModal",
    "absolutePhotoUrl",
    "photoTypeLabel",
    "Podgląd zdjęcia",
    "previewCounter",
    "Następne",
  ],
  "mobile/utils/offline-queue.ts": ["queueTaskPhotoOffline", "fields", "typ", "multipart", "Idempotency-Key"],
};

const testNeedles = {
  "mobile/scripts/test-offline-queue.cjs": ["typ: 'przed'", "typ: 'po'", "offline_pending", "file:///tmp/photo-before.jpg", "file:///tmp/photo-after.jpg"],
  "os/tests/tasks.test.js": ["TASK_FINISH_REQUIRE_PO_PHOTO_BRANCHES", "TASK_FINISH_PO_PHOTO_REQUIRED", "TASK_FINISH_PRZED_PHOTO_REQUIRED"],
};

const docsNeedles = {
  "docs/PILOT-ONE-BRANCH-CHECKLIST.md": ["verify:mobile-before-after-photo", "MOBILE-BEFORE-AFTER-PHOTO-ENFORCEMENT.md"],
  "docs/ARBOR-full-scope-implementation-backlog.md": ["mobile before/after photo enforcement", "verify:mobile-before-after-photo", "2.3"],
  "os/.env.example": ["TASK_FINISH_REQUIRE_PO_PHOTO_BRANCHES", "TASK_FINISH_REQUIRE_PRZED_PHOTO_BRANCHES"],
};

function readJson(relPath, baseDir = root) {
  return JSON.parse(fs.readFileSync(path.join(baseDir, relPath), "utf8"));
}

function assertFilesExist(files = requiredFiles, baseDir = root) {
  const missing = files.filter((file) => !fs.existsSync(path.join(baseDir, file)));
  if (missing.length) throw new Error(`Missing mobile before/after photo files: ${missing.join(", ")}`);
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

function runMobileBeforeAfterPhotoCheck(options = {}) {
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
    const result = runMobileBeforeAfterPhotoCheck();
    console.log(`[mobile-before-after-photo-check] OK (${result.checkedFiles} files, ${result.checkedPackages} package files)`);
  } catch (error) {
    console.error(`[mobile-before-after-photo-check] FAILED: ${error.message}`);
    process.exit(1);
  }
}

module.exports = { runMobileBeforeAfterPhotoCheck, assertFilesExist, assertPackageScripts, assertTextIncludes, assertNeedleMap };
