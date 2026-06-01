const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  runMobileBeforeAfterPhotoCheck,
  assertNeedleMap,
  assertPackageScripts,
  assertTextIncludes,
} = require("./mobile-before-after-photo-check.cjs");

function writeFixtureFile(root, relPath, contents) {
  const fullPath = path.join(root, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, contents);
}

function withFixture(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mobile-before-after-photo-"));
  try {
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("mobile before/after photo check validates docs, scripts, mobile UX, backend branch flags, and tests", () => {
  withFixture((root) => {
    const files = [
      "docs/MOBILE-BEFORE-AFTER-PHOTO-ENFORCEMENT.md",
      "mobile/utils/offline-queue.ts",
      "mobile/app/zlecenie/[id].tsx",
      "os/src/routes/tasks.js",
      "os/src/services/taskSettlement.js",
      "mobile/scripts/test-offline-queue.cjs",
      "os/tests/tasks.test.js",
      "docs/PILOT-ONE-BRANCH-CHECKLIST.md",
      "docs/ARBOR-full-scope-implementation-backlog.md",
      "os/.env.example",
    ];
    for (const file of files) writeFixtureFile(root, file, "placeholder");
    writeFixtureFile(root, "docs/MOBILE-BEFORE-AFTER-PHOTO-ENFORCEMENT.md", "TASK_FINISH_REQUIRE_PRZED_PHOTO_BRANCHES TASK_FINISH_REQUIRE_PO_PHOTO_BRANCHES finish_requirements queueTaskPhotoOffline offline_pending Przed Po GO NO-GO");
    writeFixtureFile(root, "mobile/utils/offline-queue.ts", "queueTaskPhotoOffline fields typ multipart Idempotency-Key");
    writeFixtureFile(root, "mobile/app/zlecenie/[id].tsx", "finishRequirements.require_przed_photo finishRequirements.require_po_photo finishBeforePhotoReady finishAfterPhotoReady photos-before zrobZdjecie('przed' zrobZdjecie('po' offline_pending");
    writeFixtureFile(root, "os/src/routes/tasks.js", "TASK_FINISH_REQUIRE_PO_PHOTO_BRANCHES TASK_FINISH_REQUIRE_PRZED_PHOTO_BRANCHES finishRequirePoPhoto(row.oddzial_id) finishRequirePrzedPhoto(row.oddzial_id) assertTeamFinishPhotoRules(client, task) TASK_FINISH_PO_PHOTO_REQUIRED TASK_FINISH_PRZED_PHOTO_REQUIRED");
    writeFixtureFile(root, "os/src/services/taskSettlement.js", "FINISH_PHOTO_MIN countTaskFinishPhotos 'po', 'after' 'przed', 'before', 'checkin'");
    writeFixtureFile(root, "mobile/scripts/test-offline-queue.cjs", "typ: 'przed' typ: 'po' offline_pending file:///tmp/photo-before.jpg file:///tmp/photo-after.jpg");
    writeFixtureFile(root, "os/tests/tasks.test.js", "TASK_FINISH_REQUIRE_PO_PHOTO_BRANCHES TASK_FINISH_PO_PHOTO_REQUIRED TASK_FINISH_PRZED_PHOTO_REQUIRED");
    writeFixtureFile(root, "docs/PILOT-ONE-BRANCH-CHECKLIST.md", "verify:mobile-before-after-photo MOBILE-BEFORE-AFTER-PHOTO-ENFORCEMENT.md");
    writeFixtureFile(root, "docs/ARBOR-full-scope-implementation-backlog.md", "mobile before/after photo enforcement verify:mobile-before-after-photo 2.3");
    writeFixtureFile(root, "os/.env.example", "TASK_FINISH_REQUIRE_PO_PHOTO_BRANCHES TASK_FINISH_REQUIRE_PRZED_PHOTO_BRANCHES");
    writeFixtureFile(root, "package.json", JSON.stringify({ scripts: { "verify:mobile-before-after-photo": "node script", check: "npm test" } }));
    writeFixtureFile(root, "mobile/package.json", JSON.stringify({ scripts: { "test:offline-queue": "node script", "smoke:mobile": "node script" } }));

    const result = runMobileBeforeAfterPhotoCheck({ root });

    assert.deepEqual(result, { ok: true, checkedFiles: 10, checkedPackages: 2 });
  });
});

test("mobile before/after package assertion reports missing verifier", () => {
  withFixture((root) => {
    writeFixtureFile(root, "package.json", JSON.stringify({ scripts: { check: "node ok" } }));
    assert.throws(() => assertPackageScripts({ "package.json": ["check", "verify:mobile-before-after-photo"] }, root), /verify:mobile-before-after-photo/);
  });
});

test("mobile before/after runbook assertion reports missing branch flag", () => {
  withFixture((root) => {
    writeFixtureFile(root, "docs/MOBILE-BEFORE-AFTER-PHOTO-ENFORCEMENT.md", "GO NO-GO");
    assert.throws(() => assertTextIncludes("docs/MOBILE-BEFORE-AFTER-PHOTO-ENFORCEMENT.md", ["TASK_FINISH_REQUIRE_PO_PHOTO_BRANCHES"], root), /TASK_FINISH_REQUIRE_PO_PHOTO_BRANCHES/);
  });
});

test("mobile before/after code assertion reports missing mobile checklist", () => {
  withFixture((root) => {
    writeFixtureFile(root, "mobile/app/zlecenie/[id].tsx", "finishRequirements.require_po_photo");
    assert.throws(() => assertNeedleMap({ "mobile/app/zlecenie/[id].tsx": ["photos-before", "finishBeforePhotoReady"] }, root), /photos-before/);
  });
});
