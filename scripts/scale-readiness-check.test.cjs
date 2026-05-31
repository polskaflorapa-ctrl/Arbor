const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  runScaleReadinessCheck,
  assertNeedleMap,
  assertPackageScripts,
  assertTextIncludes,
} = require("./scale-readiness-check.cjs");

function writeFixtureFile(root, relPath, contents) {
  const fullPath = path.join(root, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, contents);
}

function withFixture(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "scale-readiness-"));
  try {
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("scale readiness check validates scripts, runbook, docs, env, and code guards", () => {
  withFixture((root) => {
    const files = [
      "docs/HORIZONTAL-SCALING-READINESS.md",
      "docs/ENVIRONMENT-RUNBOOK.md",
      "os/src/middleware/auth.js",
      "deploy/local-production-doctor.env.example",
    ];
    for (const file of files) writeFixtureFile(root, file, "placeholder");

    writeFixtureFile(
      root,
      "docs/HORIZONTAL-SCALING-READINESS.md",
      "JWT_SECRET stateless UPLOAD_STORAGE=s3 LOGIN_RATE_LIMIT_STORE=redis LOGIN_RATE_LIMIT_REDIS_URL DB_POOL_MAX OPS_CRON_SECRET CRM_MESSAGE_QUEUE_WORKER_ENABLED SSE sticky sessions Redis pub/sub DISPATCH_SOLVER_TARGET_MS arbor_db_pool_waiting smoke:render smoke:p95 smoke:web:tti GO NO-GO",
    );
    writeFixtureFile(root, "docs/ENVIRONMENT-RUNBOOK.md", "verify:scale-readiness LOGIN_RATE_LIMIT_STORE=redis UPLOAD_STORAGE=s3");
    writeFixtureFile(root, "os/src/middleware/auth.js", "jwt.verify env.JWT_SECRET Bearer");
    writeFixtureFile(root, "deploy/local-production-doctor.env.example", "LOGIN_RATE_LIMIT_STORE=redis LOGIN_RATE_LIMIT_REDIS_URL UPLOAD_STORAGE=s3 DB_POOL_MAX=5");
    writeFixtureFile(root, "package.json", JSON.stringify({ scripts: { "verify:scale-readiness": "node script", "smoke:p95": "node smoke", check: "npm test" } }));

    const result = runScaleReadinessCheck({
      root,
      requiredFiles: files,
      requiredScripts: { "package.json": ["verify:scale-readiness", "smoke:p95", "check"] },
      codeNeedles: { "os/src/middleware/auth.js": ["jwt.verify", "env.JWT_SECRET"] },
      docsNeedles: { "docs/ENVIRONMENT-RUNBOOK.md": ["LOGIN_RATE_LIMIT_STORE=redis"] },
      envNeedles: { "deploy/local-production-doctor.env.example": ["UPLOAD_STORAGE=s3", "DB_POOL_MAX=5"] },
    });

    assert.deepEqual(result, { ok: true, checkedFiles: 4, checkedPackages: 1 });
  });
});

test("scale readiness package assertion reports missing verifier script", () => {
  withFixture((root) => {
    writeFixtureFile(root, "package.json", JSON.stringify({ scripts: { check: "node ok" } }));

    assert.throws(
      () => assertPackageScripts({ "package.json": ["check", "verify:scale-readiness"] }, root),
      /verify:scale-readiness/,
    );
  });
});

test("scale readiness runbook assertion reports missing Redis limiter guidance", () => {
  withFixture((root) => {
    writeFixtureFile(root, "docs/HORIZONTAL-SCALING-READINESS.md", "JWT_SECRET stateless");

    assert.throws(
      () => assertTextIncludes("docs/HORIZONTAL-SCALING-READINESS.md", ["JWT_SECRET", "LOGIN_RATE_LIMIT_STORE=redis"], root),
      /LOGIN_RATE_LIMIT_STORE=redis/,
    );
  });
});

test("scale readiness code assertion reports missing shared storage guard", () => {
  withFixture((root) => {
    writeFixtureFile(root, "os/src/services/upload-storage.js", "UPLOAD_STORAGE local");

    assert.throws(
      () => assertNeedleMap({ "os/src/services/upload-storage.js": ["UPLOAD_STORAGE", "S3_PUBLIC_BASE_URL"] }, root),
      /S3_PUBLIC_BASE_URL/,
    );
  });
});
