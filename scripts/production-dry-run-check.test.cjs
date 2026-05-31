const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  runProductionDryRunCheck,
  assertPackageScripts,
  assertTextIncludes,
} = require("./production-dry-run-check.cjs");

function writeFixtureFile(root, relPath, contents) {
  const fullPath = path.join(root, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, contents);
}

function withFixture(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "production-dry-run-"));
  try {
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("production dry-run check validates files, scripts, and runbook commands", () => {
  withFixture((root) => {
    const files = [
      "docs/PRODUCTION-DEPLOY-DRY-RUN.md",
      "docs/ENVIRONMENT-RUNBOOK.md",
      "docs/backup-restore.md",
      "os/scripts/db-backup.js",
    ];
    for (const file of files) {
      writeFixtureFile(root, file, "placeholder");
    }

    writeFixtureFile(
      root,
      "docs/PRODUCTION-DEPLOY-DRY-RUN.md",
      "deploy:prod:dry-run deploy:ready:check deploy:env:print deploy:prod:doctor db:migrate bootstrap:admin backup:db:check backup:db restore:db:check smoke:render PUBLIC_BASE_URL CORS_ORIGINS VITE_API_URL EXPO_PUBLIC_API_URL UPLOAD_STORAGE=s3 GO NO-GO",
    );
    writeFixtureFile(
      root,
      "docs/ENVIRONMENT-RUNBOOK.md",
      "npm run deploy:prod:dry-run npm run backup:db npm run restore:db:check npm run smoke:render -- https://<arbor-os-url>",
    );
    writeFixtureFile(
      root,
      "package.json",
      JSON.stringify({ scripts: { "deploy:prod:dry-run": "node script", "smoke:render": "node smoke" } }),
    );

    const result = runProductionDryRunCheck({
      root,
      requiredFiles: files,
      requiredScripts: { "package.json": ["deploy:prod:dry-run", "smoke:render"] },
    });

    assert.deepEqual(result, { ok: true, checkedFiles: 4, checkedPackages: 1 });
  });
});

test("production dry-run package assertion reports missing script name", () => {
  withFixture((root) => {
    writeFixtureFile(root, "package.json", JSON.stringify({ scripts: { check: "node ok" } }));

    assert.throws(
      () => assertPackageScripts({ "package.json": ["check", "deploy:prod:dry-run"] }, root),
      /deploy:prod:dry-run/,
    );
  });
});

test("production dry-run text assertion reports missing command", () => {
  withFixture((root) => {
    writeFixtureFile(root, "docs/PRODUCTION-DEPLOY-DRY-RUN.md", "deploy:ready:check");

    assert.throws(
      () =>
        assertTextIncludes("docs/PRODUCTION-DEPLOY-DRY-RUN.md", ["deploy:ready:check", "restore:db:check"], root),
      /restore:db:check/,
    );
  });
});
