const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const { runMobileProblemFlowCheck, assertNeedleMap, assertPackageScripts, assertTextIncludes } = require("./mobile-problem-flow-check.cjs");

function writeFixtureFile(root, relPath, contents) {
  const fullPath = path.join(root, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, contents);
}

function withFixture(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mobile-problem-flow-"));
  try {
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("mobile problem flow check validates docs, scripts, mobile queue, backend notifications, and tests", () => {
  withFixture((root) => {
    const files = [
      "docs/MOBILE-PROBLEM-OFFLINE-FLOW.md",
      "mobile/utils/offline-queue.ts",
      "mobile/app/zlecenie/[id].tsx",
      "os/src/routes/tasks.js",
      "mobile/scripts/test-offline-queue.cjs",
      "os/tests/tasks.test.js",
      "docs/PILOT-ONE-BRANCH-CHECKLIST.md",
      "docs/ARBOR-full-scope-implementation-backlog.md",
    ];
    for (const file of files) writeFixtureFile(root, file, "placeholder");
    writeFixtureFile(root, "docs/MOBILE-PROBLEM-OFFLINE-FLOW.md", "queueTaskProblemOffline queueTaskPhotoOffline Idempotency-Key offline_pending notifications_created pushToUser tab: \"problemy\" GO NO-GO");
    writeFixtureFile(root, "mobile/utils/offline-queue.ts", "queueTaskProblemOffline dedupeKey problem: Idempotency-Key");
    writeFixtureFile(root, "mobile/app/zlecenie/[id].tsx", "queueTaskProblemOffline addPendingOfflineProblem zrobZdjecieProblemu queueTaskPhotoOffline offline_pending");
    writeFixtureFile(root, "os/src/routes/tasks.js", "INSERT INTO issues INSERT INTO notifications notifications_created pushToUser tab: 'problemy' tryConsumeIdempotencyKey requireTaskAccess");
    writeFixtureFile(root, "mobile/scripts/test-offline-queue.cjs", "testQueueTaskProblemOfflineUsesStableIdAndDedupe queueTaskProblemOffline problem:problem-offline-1");
    writeFixtureFile(root, "os/tests/tasks.test.js", "POST /tasks/:id/problemy notifies branch managers notifications_created INSERT INTO notifications");
    writeFixtureFile(root, "docs/PILOT-ONE-BRANCH-CHECKLIST.md", "verify:mobile-problem-flow MOBILE-PROBLEM-OFFLINE-FLOW.md");
    writeFixtureFile(root, "docs/ARBOR-full-scope-implementation-backlog.md", "mobile problem/offline incident flow verify:mobile-problem-flow 2.2");
    writeFixtureFile(root, "package.json", JSON.stringify({ scripts: { "verify:mobile-problem-flow": "node script", check: "npm test" } }));
    writeFixtureFile(root, "mobile/package.json", JSON.stringify({ scripts: { "test:offline-queue": "node script" } }));

    const result = runMobileProblemFlowCheck({ root });

    assert.deepEqual(result, { ok: true, checkedFiles: 8, checkedPackages: 2 });
  });
});

test("mobile problem flow package assertion reports missing verifier", () => {
  withFixture((root) => {
    writeFixtureFile(root, "package.json", JSON.stringify({ scripts: { check: "node ok" } }));
    assert.throws(() => assertPackageScripts({ "package.json": ["check", "verify:mobile-problem-flow"] }, root), /verify:mobile-problem-flow/);
  });
});

test("mobile problem runbook assertion reports missing offline contract", () => {
  withFixture((root) => {
    writeFixtureFile(root, "docs/MOBILE-PROBLEM-OFFLINE-FLOW.md", "GO NO-GO");
    assert.throws(() => assertTextIncludes("docs/MOBILE-PROBLEM-OFFLINE-FLOW.md", ["queueTaskProblemOffline"], root), /queueTaskProblemOffline/);
  });
});

test("mobile problem code assertion reports missing manager notification", () => {
  withFixture((root) => {
    writeFixtureFile(root, "os/src/routes/tasks.js", "INSERT INTO issues");
    assert.throws(() => assertNeedleMap({ "os/src/routes/tasks.js": ["INSERT INTO notifications", "pushToUser"] }, root), /INSERT INTO notifications/);
  });
});

