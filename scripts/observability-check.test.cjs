const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  runObservabilityCheck,
  assertCodeNeedles,
  assertPackageScripts,
  assertTextIncludes,
} = require("./observability-check.cjs");

function writeFixtureFile(root, relPath, contents) {
  const fullPath = path.join(root, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, contents);
}

function withFixture(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "observability-check-"));
  try {
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("observability check validates files, scripts, runbook, and metric hooks", () => {
  withFixture((root) => {
    const files = ["docs/OBSERVABILITY-SLO-RUNBOOK.md", "os/src/app.js", "os/src/metrics.js"];
    for (const file of files) writeFixtureFile(root, file, "placeholder");

    writeFixtureFile(
      root,
      "docs/OBSERVABILITY-SLO-RUNBOOK.md",
      "/api/health /api/ready /api/metrics /api/ops/smoke /api/ops/storage-smoke METRICS_ENABLED=true METRICS_TOKEN 5xx p95 500 ms arbor_http_requests_total arbor_http_duration_seconds_bucket arbor_db_pool_waiting restore:db:check GO NO-GO",
    );
    writeFixtureFile(root, "os/src/app.js", "/api/health /api/ready /api/metrics METRICS_TOKEN");
    writeFixtureFile(root, "os/src/metrics.js", "arbor_http_requests_total arbor_http_duration_seconds arbor_db_pool_waiting metricsMiddleware");
    writeFixtureFile(
      root,
      "package.json",
      JSON.stringify({ scripts: { "verify:observability": "node script", health: "node health" } }),
    );

    const result = runObservabilityCheck({
      root,
      requiredFiles: files,
      requiredScripts: { "package.json": ["verify:observability", "health"] },
      codeNeedles: {
        "os/src/app.js": ["/api/metrics", "METRICS_TOKEN"],
        "os/src/metrics.js": ["arbor_http_requests_total", "arbor_db_pool_waiting"],
      },
    });

    assert.deepEqual(result, { ok: true, checkedFiles: 3, checkedPackages: 1 });
  });
});

test("observability package assertion reports missing script name", () => {
  withFixture((root) => {
    writeFixtureFile(root, "package.json", JSON.stringify({ scripts: { health: "node ok" } }));

    assert.throws(
      () => assertPackageScripts({ "package.json": ["health", "verify:observability"] }, root),
      /verify:observability/,
    );
  });
});

test("observability text assertion reports missing SLO keyword", () => {
  withFixture((root) => {
    writeFixtureFile(root, "docs/OBSERVABILITY-SLO-RUNBOOK.md", "/api/ready p95");

    assert.throws(
      () => assertTextIncludes("docs/OBSERVABILITY-SLO-RUNBOOK.md", ["/api/ready", "5xx"], root),
      /5xx/,
    );
  });
});

test("observability code assertion reports missing metrics hook", () => {
  withFixture((root) => {
    writeFixtureFile(root, "os/src/metrics.js", "arbor_http_requests_total");

    assert.throws(
      () => assertCodeNeedles({ "os/src/metrics.js": ["arbor_http_requests_total", "arbor_db_pool_waiting"] }, root),
      /arbor_db_pool_waiting/,
    );
  });
});
