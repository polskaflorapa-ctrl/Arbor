const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  runMobilePhotoEnforcementCheck,
  assertNeedleMap,
  assertPackageScripts,
  assertTextIncludes,
} = require("./mobile-photo-enforcement-check.cjs");

function writeFixtureFile(root, relPath, contents) {
  const fullPath = path.join(root, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, contents);
}

function withFixture(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mobile-photo-enforcement-"));
  try {
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("mobile photo enforcement check validates docs, scripts, mobile blockers, backend guards, and tests", () => {
  withFixture((root) => {
    const files = [
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
    for (const file of files) writeFixtureFile(root, file, "placeholder");
    writeFixtureFile(root, "docs/MOBILE-BEFORE-AFTER-PHOTO-ENFORCEMENT.md", "TASK_FINISH_REQUIRE_PRZED_PHOTO TASK_FINISH_REQUIRE_PO_PHOTO FINISH_PHOTO_MIN.przed = 2 FINISH_PHOTO_MIN.po = 2 finish_requirements TASK_FINISH_PRZED_PHOTO_REQUIRED TASK_FINISH_PO_PHOTO_REQUIRED offline_pending GO NO-GO");
    writeFixtureFile(root, "docs/PILOT-ONE-BRANCH-CHECKLIST.md", "verify:mobile-photo-enforcement MOBILE-BEFORE-AFTER-PHOTO-ENFORCEMENT.md");
    writeFixtureFile(root, "docs/ARBOR-full-scope-implementation-backlog.md", "mobile before/after photo enforcement verify:mobile-photo-enforcement 2.3");
    writeFixtureFile(root, "mobile/app/zlecenie/[id].tsx", "finishRequirements require_przed_photo require_po_photo has_przed_photo has_po_photo finishBlockedPrzedTitle finishBlockedPoTitle finishPhotoBlocked offline_pending");
    writeFixtureFile(root, "mobile/utils/offline-queue.ts", "queueTaskPhotoOffline Idempotency-Key");
    writeFixtureFile(root, "os/src/routes/tasks.js", "finishRequirePrzedPhoto finishRequirePoPhoto requirePo = finishRequirePoPhoto requirePrzed = finishRequirePrzedPhoto TASK_FINISH_PRZED_PHOTO_REQUIRED TASK_FINISH_PO_PHOTO_REQUIRED finish_requirements");
    writeFixtureFile(root, "os/src/services/taskSettlement.js", "FINISH_PHOTO_MIN po: 2 przed: 2 countTaskFinishPhotos");
    writeFixtureFile(root, "os/tests/tasks.test.js", "only TASK_FINISH_REQUIRE_PRZED_PHOTO=1 TASK_FINISH_PRZED_PHOTO_REQUIRED TASK_FINISH_REQUIRE_PO_PHOTO=1 TASK_FINISH_PO_PHOTO_REQUIRED");
    writeFixtureFile(root, "package.json", JSON.stringify({ scripts: { "verify:mobile-photo-enforcement": "node script", check: "npm test" } }));

    const result = runMobilePhotoEnforcementCheck({ root });

    assert.deepEqual(result, { ok: true, checkedFiles: 9, checkedPackages: 1 });
  });
});

test("mobile photo package assertion reports missing verifier", () => {
  withFixture((root) => {
    writeFixtureFile(root, "package.json", JSON.stringify({ scripts: { check: "node ok" } }));
    assert.throws(() => assertPackageScripts({ "package.json": ["check", "verify:mobile-photo-enforcement"] }, root), /verify:mobile-photo-enforcement/);
  });
});

test("mobile photo runbook assertion reports missing before-photo env", () => {
  withFixture((root) => {
    writeFixtureFile(root, "docs/MOBILE-BEFORE-AFTER-PHOTO-ENFORCEMENT.md", "GO NO-GO");
    assert.throws(() => assertTextIncludes("docs/MOBILE-BEFORE-AFTER-PHOTO-ENFORCEMENT.md", ["TASK_FINISH_REQUIRE_PRZED_PHOTO"], root), /TASK_FINISH_REQUIRE_PRZED_PHOTO/);
  });
});

test("mobile photo backend assertion reports missing independent before guard", () => {
  withFixture((root) => {
    writeFixtureFile(root, "os/src/routes/tasks.js", "finishRequirePoPhoto TASK_FINISH_PO_PHOTO_REQUIRED");
    assert.throws(() => assertNeedleMap({ "os/src/routes/tasks.js": ["requirePrzed = finishRequirePrzedPhoto", "TASK_FINISH_PRZED_PHOTO_REQUIRED"] }, root), /requirePrzed/);
  });
});
