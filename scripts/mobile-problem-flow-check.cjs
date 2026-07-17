const path = require("node:path");
const { createRepositoryAssertions } = require("./lib/repository-contract.cjs");

const root = path.resolve(__dirname, "..");

const requiredFiles = [
  "docs/MOBILE-PROBLEM-OFFLINE-FLOW.md",
  "docs/PILOT-ONE-BRANCH-CHECKLIST.md",
  "docs/ARBOR-full-scope-implementation-backlog.md",
  "mobile/app/zlecenie/[id].tsx",
  "mobile/utils/offline-queue.ts",
  "mobile/scripts/test-offline-queue.cjs",
  "os/src/routes/tasks.js",
  "os/tests/tasks.test.js",
];

const requiredScripts = {
  "package.json": ["verify:mobile-problem-flow", "check"],
  "mobile/package.json": ["test:offline-queue"],
};

const runbookNeedles = [
  "queueTaskProblemOffline",
  "queueTaskPhotoOffline",
  "Idempotency-Key",
  "offline_pending",
  "notifications_created",
  "pushToUser",
  "tab: \"problemy\"",
  "GO",
  "NO-GO",
];

const codeNeedles = {
  "mobile/utils/offline-queue.ts": ["queueTaskProblemOffline", "dedupeKey", "problem:", "Idempotency-Key"],
  "mobile/app/zlecenie/[id].tsx": ["queueTaskProblemOffline", "addPendingOfflineProblem", "zrobZdjecieProblemu", "queueTaskPhotoOffline", "offline_pending"],
  "os/src/routes/tasks.js": ["INSERT INTO issues", "INSERT INTO notifications", "notifications_created", "pushToUser", "tab: 'problemy'", "tryConsumeIdempotencyKey", "requireTaskAccess"],
};

const testNeedles = {
  "mobile/scripts/test-offline-queue.cjs": ["testQueueTaskProblemOfflineUsesStableIdAndDedupe", "queueTaskProblemOffline", "problem:problem-offline-1"],
  "os/tests/tasks.test.js": ["POST /tasks/:id/problemy notifies branch managers", "notifications_created", "INSERT INTO notifications"],
};

const docsNeedles = {
  "docs/PILOT-ONE-BRANCH-CHECKLIST.md": ["verify:mobile-problem-flow", "MOBILE-PROBLEM-OFFLINE-FLOW.md"],
  "docs/ARBOR-full-scope-implementation-backlog.md": ["mobile problem/offline incident flow", "verify:mobile-problem-flow", "2.2"],
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
  missingFilesLabel: "Missing mobile problem flow files",
});

function runMobileProblemFlowCheck(options = {}) {
  const baseDir = options.root || root;
  assertFilesExist(options.requiredFiles || requiredFiles, baseDir);
  assertPackageScripts(options.requiredScripts || requiredScripts, baseDir);
  assertTextIncludes("docs/MOBILE-PROBLEM-OFFLINE-FLOW.md", options.runbookNeedles || runbookNeedles, baseDir);
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
    const result = runMobileProblemFlowCheck();
    console.log(`[mobile-problem-flow-check] OK (${result.checkedFiles} files, ${result.checkedPackages} package files)`);
  } catch (error) {
    console.error(`[mobile-problem-flow-check] FAILED: ${error.message}`);
    process.exit(1);
  }
}

module.exports = { runMobileProblemFlowCheck, assertFilesExist, assertPackageScripts, assertTextIncludes, assertNeedleMap };
