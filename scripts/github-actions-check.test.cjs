const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  assertWorkflowIncludes,
  runGithubActionsCheck,
} = require("./github-actions-check.cjs");

function writeFixtureFile(root, relPath, contents) {
  const fullPath = path.join(root, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, contents);
}

function withFixture(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "github-actions-check-"));
  try {
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("GitHub Actions check validates deploy workflows and production gates", () => {
  withFixture((root) => {
    writeFixtureFile(
      root,
      ".github/workflows/deploy-prod.yml",
      [
        "name: Deploy Production",
        "jobs:",
        "  deploy-prod:",
        "    steps:",
        "      - run: npm run deploy:render:web:wait -- --expected-build abc123",
        "        env:",
        "          RENDER_WEB_DEPLOY_HOOK_URL: ${{ secrets.RENDER_WEB_DEPLOY_HOOK_URL }}",
        "      - run: npm run status:production -- --skip-local",
      ].join("\n"),
    );
    writeFixtureFile(
      root,
      ".github/workflows/deploy-ready.yml",
      [
        "name: Deploy ready",
        "jobs:",
        "  deploy-ready:",
        "    steps:",
        "      - run: npm run deploy:ready:check",
        "      - run: npm run build -w arbor-web",
        "      - run: npm run typecheck -w arbor-mobile",
      ].join("\n"),
    );

    assert.deepEqual(runGithubActionsCheck({ root }), { ok: true, checkedWorkflows: 2 });
  });
});

test("GitHub Actions check reports missing production readiness command", () => {
  withFixture((root) => {
    writeFixtureFile(
      root,
      ".github/workflows/deploy-prod.yml",
      [
        "name: Deploy Production",
        "jobs:",
        "  deploy-prod:",
        "    steps:",
        "      - run: npm run deploy:render:web:wait",
      ].join("\n"),
    );

    assert.throws(
      () => assertWorkflowIncludes(".github/workflows/deploy-prod.yml", ["status:production"], root),
      /status:production/,
    );
  });
});
