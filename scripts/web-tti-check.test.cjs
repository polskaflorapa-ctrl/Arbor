const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  runWebTtiCheck,
  assertNeedleMap,
  assertPackageScripts,
  assertTextIncludes,
} = require("./web-tti-check.cjs");

const {
  parseArgs,
  normalizeRoute,
  eventMessages,
} = require("../web/scripts/smoke-tti.cjs");

function writeFixtureFile(root, relPath, contents) {
  const fullPath = path.join(root, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, contents);
}

function withFixture(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "web-tti-"));
  try {
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("web TTI check validates files, scripts, runbook, docs, and smoke code", () => {
  withFixture((root) => {
    const files = ["docs/WEB-TTI-SMOKE-RUNBOOK.md", "docs/OBSERVABILITY-SLO-RUNBOOK.md", "web/scripts/smoke-tti.cjs"];
    for (const file of files) writeFixtureFile(root, file, "placeholder");

    writeFixtureFile(
      root,
      "docs/WEB-TTI-SMOKE-RUNBOOK.md",
      "TTI 3000 ms smoke:web:tti ARBOR_WEB_TTI_BASE --threshold 3000 --routes --mobile output/playwright/web-tti-smoke-results.json GO NO-GO",
    );
    writeFixtureFile(root, "docs/OBSERVABILITY-SLO-RUNBOOK.md", "smoke:web:tti TTI 3000 ms");
    writeFixtureFile(root, "web/scripts/smoke-tti.cjs", "DEFAULT_THRESHOLD_MS = 3000 DEFAULT_ROUTES performance.now textLength overflowX console_or_network_error web-tti-smoke-results.json");
    writeFixtureFile(root, "package.json", JSON.stringify({ scripts: { "verify:web-tti": "node script", "smoke:web:tti": "node smoke", check: "npm test" } }));
    writeFixtureFile(root, "web/package.json", JSON.stringify({ scripts: { "smoke:tti": "node smoke", start: "vite" } }));

    const result = runWebTtiCheck({
      root,
      requiredFiles: files,
      requiredScripts: {
        "package.json": ["verify:web-tti", "smoke:web:tti", "check"],
        "web/package.json": ["smoke:tti", "start"],
      },
      docsNeedles: { "docs/OBSERVABILITY-SLO-RUNBOOK.md": ["TTI"] },
      codeNeedles: { "web/scripts/smoke-tti.cjs": ["DEFAULT_THRESHOLD_MS = 3000", "performance.now"] },
    });

    assert.deepEqual(result, { ok: true, checkedFiles: 3, checkedPackages: 2 });
  });
});

test("web TTI package assertion reports missing script name", () => {
  withFixture((root) => {
    writeFixtureFile(root, "package.json", JSON.stringify({ scripts: { check: "node ok" } }));

    assert.throws(
      () => assertPackageScripts({ "package.json": ["check", "verify:web-tti"] }, root),
      /verify:web-tti/,
    );
  });
});

test("web TTI text assertion reports missing threshold", () => {
  withFixture((root) => {
    writeFixtureFile(root, "docs/WEB-TTI-SMOKE-RUNBOOK.md", "TTI smoke");

    assert.throws(
      () => assertTextIncludes("docs/WEB-TTI-SMOKE-RUNBOOK.md", ["TTI", "3000 ms"], root),
      /3000 ms/,
    );
  });
});

test("web TTI needle map reports missing performance marker", () => {
  withFixture((root) => {
    writeFixtureFile(root, "web/scripts/smoke-tti.cjs", "DEFAULT_THRESHOLD_MS = 3000");

    assert.throws(
      () => assertNeedleMap({ "web/scripts/smoke-tti.cjs": ["DEFAULT_THRESHOLD_MS = 3000", "performance.now"] }, root),
      /performance\.now/,
    );
  });
});

test("web TTI CLI parser supports threshold, routes, mobile, and base URL", () => {
  const parsed = parseArgs([
    "http://127.0.0.1:5173/",
    "--threshold",
    "2500",
    "--routes",
    "dashboard,/bi",
    "--mobile",
    "--json",
  ], {});

  assert.equal(parsed.baseUrl, "http://127.0.0.1:5173");
  assert.equal(parsed.thresholdMs, 2500);
  assert.deepEqual(parsed.routes, ["/dashboard", "/bi"]);
  assert.equal(parsed.mobile, true);
  assert.equal(parsed.json, true);
});

test("web TTI route normalization and event filtering keep actionable errors", () => {
  assert.equal(normalizeRoute("dashboard"), "/dashboard");

  const messages = eventMessages([
    { method: "Network.responseReceived", params: { response: { status: 404, url: "http://x/favicon.ico" } } },
    { method: "Network.responseReceived", params: { response: { status: 500, url: "http://x/api/tasks" } } },
    { method: "Log.entryAdded", params: { entry: { text: "[api:test-mode] generic mock fallback" } } },
    { method: "Log.entryAdded", params: { entry: { text: "real app error" } } },
  ]);

  assert.deepEqual(messages, ["500 http://x/api/tasks", "real app error"]);
});
