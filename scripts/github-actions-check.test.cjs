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
        "      - run: |",
        "          if [ -z \"$DATABASE_URL\" ]; then",
        "            echo \"Missing required PROD_DATABASE_URL; production deploy cannot run migrations.\"",
        "            exit 1",
        "          fi",
        "          if [ -z \"$JWT_SECRET\" ]; then",
        "            echo \"Missing required PROD_JWT_SECRET; production deploy cannot verify API signing secret.\"",
        "            exit 1",
        "          fi",
        "          npm run db:migrate -w arbor-os",
        "      - run: |",
        "          if [ -z \"$RENDER_WEB_DEPLOY_HOOK_URL\" ]; then",
        "            echo \"Missing required RENDER_WEB_DEPLOY_HOOK_URL; production deploy cannot continue.\"",
        "            exit 1",
        "          fi",
        "      - run: npm run deploy:render:web:wait -- --expected-build abc123",
        "        env:",
        "          RENDER_WEB_DEPLOY_HOOK_URL: ${{ secrets.RENDER_WEB_DEPLOY_HOOK_URL }}",
        "      - run: |",
        "          if [ -z \"$PROD_API_URL\" ]; then",
        "            echo \"Missing required PROD_API_URL; production deploy cannot verify API health.\"",
        "            exit 1",
        "          fi",
        "          api_ready=false",
        "          echo \"Production API health check failed after 60 attempts.\"",
        "      - run: |",
        "          if [ -z \"$PROD_WEB_URL\" ]; then",
        "            echo \"Missing required PROD_WEB_URL; production deploy cannot verify web health.\"",
        "            exit 1",
        "          fi",
        "          web_ready=false",
        "          echo \"Production web health check failed after 15 attempts.\"",
        "      - run: |",
        "          EXPECTED_BUILD=\"${GITHUB_SHA::7}\"",
        "          npm run status:production -- --skip-local --api \"https://$PROD_API_URL/api\" --web \"https://$PROD_WEB_URL\" --expected-build \"$EXPECTED_BUILD\"",
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
        "      - run: npm run verify:contracts",
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

test("GitHub Actions check requires deploy-prod to fail without production database URL", () => {
  withFixture((root) => {
    writeFixtureFile(
      root,
      ".github/workflows/deploy-prod.yml",
      [
        "name: Deploy Production",
        "jobs:",
        "  deploy-prod:",
        "    steps:",
        "      - run: |",
        "          if [ -z \"$DATABASE_URL\" ]; then",
        "            echo \"PROD_DATABASE_URL is not configured; skipping production migration.\"",
        "            exit 0",
        "          fi",
        "          npm run db:migrate -w arbor-os",
        "      - run: |",
        "          if [ -z \"$RENDER_WEB_DEPLOY_HOOK_URL\" ]; then",
        "            echo \"Missing required RENDER_WEB_DEPLOY_HOOK_URL; production deploy cannot continue.\"",
        "            exit 1",
        "          fi",
        "      - run: npm run deploy:render:web:wait -- --expected-build abc123",
        "        env:",
        "          RENDER_WEB_DEPLOY_HOOK_URL: ${{ secrets.RENDER_WEB_DEPLOY_HOOK_URL }}",
        "      - run: |",
        "          if [ -z \"$PROD_API_URL\" ]; then",
        "            echo \"Missing required PROD_API_URL; production deploy cannot verify API health.\"",
        "            exit 1",
        "          fi",
        "          api_ready=false",
        "          echo \"Production API health check failed after 60 attempts.\"",
        "      - run: |",
        "          if [ -z \"$PROD_WEB_URL\" ]; then",
        "            echo \"Missing required PROD_WEB_URL; production deploy cannot verify web health.\"",
        "            exit 1",
        "          fi",
        "          web_ready=false",
        "          echo \"Production web health check failed after 15 attempts.\"",
        "      - run: |",
        "          EXPECTED_BUILD=\"${GITHUB_SHA::7}\"",
        "          npm run status:production -- --skip-local --api \"https://$PROD_API_URL/api\" --web \"https://$PROD_WEB_URL\" --expected-build \"$EXPECTED_BUILD\"",
      ].join("\n"),
    );

    assert.throws(
      () => runGithubActionsCheck({ root }),
      /Missing required PROD_DATABASE_URL/,
    );
  });
});

test("GitHub Actions check requires deploy-prod to fail without production JWT secret", () => {
  withFixture((root) => {
    writeFixtureFile(
      root,
      ".github/workflows/deploy-prod.yml",
      [
        "name: Deploy Production",
        "jobs:",
        "  deploy-prod:",
        "    steps:",
        "      - run: |",
        "          if [ -z \"$DATABASE_URL\" ]; then",
        "            echo \"Missing required PROD_DATABASE_URL; production deploy cannot run migrations.\"",
        "            exit 1",
        "          fi",
        "          npm run db:migrate -w arbor-os",
        "      - run: |",
        "          if [ -z \"$RENDER_WEB_DEPLOY_HOOK_URL\" ]; then",
        "            echo \"Missing required RENDER_WEB_DEPLOY_HOOK_URL; production deploy cannot continue.\"",
        "            exit 1",
        "          fi",
        "      - run: npm run deploy:render:web:wait -- --expected-build abc123",
        "        env:",
        "          RENDER_WEB_DEPLOY_HOOK_URL: ${{ secrets.RENDER_WEB_DEPLOY_HOOK_URL }}",
        "      - run: |",
        "          if [ -z \"$PROD_API_URL\" ]; then",
        "            echo \"Missing required PROD_API_URL; production deploy cannot verify API health.\"",
        "            exit 1",
        "          fi",
        "          api_ready=false",
        "          echo \"Production API health check failed after 60 attempts.\"",
        "      - run: |",
        "          if [ -z \"$PROD_WEB_URL\" ]; then",
        "            echo \"Missing required PROD_WEB_URL; production deploy cannot verify web health.\"",
        "            exit 1",
        "          fi",
        "          web_ready=false",
        "          echo \"Production web health check failed after 15 attempts.\"",
        "      - run: |",
        "          EXPECTED_BUILD=\"${GITHUB_SHA::7}\"",
        "          npm run status:production -- --skip-local --api \"https://$PROD_API_URL/api\" --web \"https://$PROD_WEB_URL\" --expected-build \"$EXPECTED_BUILD\"",
      ].join("\n"),
    );

    assert.throws(
      () => runGithubActionsCheck({ root }),
      /Missing required PROD_JWT_SECRET/,
    );
  });
});

test("GitHub Actions check requires deploy-prod to fail without Render web deploy hook", () => {
  withFixture((root) => {
    writeFixtureFile(
      root,
      ".github/workflows/deploy-prod.yml",
      [
        "name: Deploy Production",
        "jobs:",
        "  deploy-prod:",
        "    steps:",
        "      - run: |",
        "          if [ -z \"$DATABASE_URL\" ]; then",
        "            echo \"Missing required PROD_DATABASE_URL; production deploy cannot run migrations.\"",
        "            exit 1",
        "          fi",
        "          npm run db:migrate -w arbor-os",
        "      - run: |",
        "          if [ -z \"$RENDER_WEB_DEPLOY_HOOK_URL\" ]; then",
        "            echo \"RENDER_WEB_DEPLOY_HOOK_URL is not configured; skipping Render web deploy.\"",
        "            exit 0",
        "          fi",
        "      - run: npm run deploy:render:web:wait -- --expected-build abc123",
        "        env:",
        "          RENDER_WEB_DEPLOY_HOOK_URL: ${{ secrets.RENDER_WEB_DEPLOY_HOOK_URL }}",
        "      - run: npm run status:production -- --skip-local",
      ].join("\n"),
    );

    assert.throws(
      () => runGithubActionsCheck({ root }),
      /Missing required RENDER_WEB_DEPLOY_HOOK_URL/,
    );
  });
});

test("GitHub Actions check requires deploy-prod to fail without production health URLs", () => {
  withFixture((root) => {
    writeFixtureFile(
      root,
      ".github/workflows/deploy-prod.yml",
      [
        "name: Deploy Production",
        "jobs:",
        "  deploy-prod:",
        "    steps:",
        "      - run: |",
        "          if [ -z \"$RENDER_WEB_DEPLOY_HOOK_URL\" ]; then",
        "            echo \"Missing required RENDER_WEB_DEPLOY_HOOK_URL; production deploy cannot continue.\"",
        "            exit 1",
        "          fi",
        "      - run: npm run deploy:render:web:wait -- --expected-build abc123",
        "        env:",
        "          RENDER_WEB_DEPLOY_HOOK_URL: ${{ secrets.RENDER_WEB_DEPLOY_HOOK_URL }}",
        "      - run: |",
        "          if [ -z \"$PROD_API_URL\" ]; then",
        "            echo \"PROD_API_URL is not configured; skipping API health check.\"",
        "            exit 0",
        "          fi",
        "      - run: |",
        "          if [ -z \"$PROD_WEB_URL\" ]; then",
        "            echo \"PROD_WEB_URL is not configured; skipping web health check.\"",
        "            exit 0",
        "          fi",
        "      - run: npm run status:production -- --skip-local",
      ].join("\n"),
    );

    assert.throws(
      () => runGithubActionsCheck({ root }),
      /Missing required PROD_API_URL/,
    );
  });
});

test("GitHub Actions check requires deploy-prod to fail after exhausted health checks", () => {
  withFixture((root) => {
    writeFixtureFile(
      root,
      ".github/workflows/deploy-prod.yml",
      [
        "name: Deploy Production",
        "jobs:",
        "  deploy-prod:",
        "    steps:",
        "      - run: |",
        "          if [ -z \"$RENDER_WEB_DEPLOY_HOOK_URL\" ]; then",
        "            echo \"Missing required RENDER_WEB_DEPLOY_HOOK_URL; production deploy cannot continue.\"",
        "            exit 1",
        "          fi",
        "      - run: npm run deploy:render:web:wait -- --expected-build abc123",
        "        env:",
        "          RENDER_WEB_DEPLOY_HOOK_URL: ${{ secrets.RENDER_WEB_DEPLOY_HOOK_URL }}",
        "      - run: |",
        "          if [ -z \"$PROD_API_URL\" ]; then",
        "            echo \"Missing required PROD_API_URL; production deploy cannot verify API health.\"",
        "            exit 1",
        "          fi",
        "          for i in {1..60}; do",
        "            curl -sf \"https://$PROD_API_URL/api/ready/\" && break",
        "            sleep 10",
        "          done",
        "      - run: |",
        "          if [ -z \"$PROD_WEB_URL\" ]; then",
        "            echo \"Missing required PROD_WEB_URL; production deploy cannot verify web health.\"",
        "            exit 1",
        "          fi",
        "          for i in {1..15}; do",
        "            curl -sf \"https://$PROD_WEB_URL\" && break",
        "            sleep 5",
        "          done",
        "      - run: npm run status:production -- --skip-local",
      ].join("\n"),
    );

    assert.throws(
      () => runGithubActionsCheck({ root }),
      /Production API health check failed after 60 attempts/,
    );
  });
});

test("GitHub Actions check requires production readiness report to use production URL secrets", () => {
  withFixture((root) => {
    writeFixtureFile(
      root,
      ".github/workflows/deploy-prod.yml",
      [
        "name: Deploy Production",
        "jobs:",
        "  deploy-prod:",
        "    steps:",
        "      - run: |",
        "          if [ -z \"$RENDER_WEB_DEPLOY_HOOK_URL\" ]; then",
        "            echo \"Missing required RENDER_WEB_DEPLOY_HOOK_URL; production deploy cannot continue.\"",
        "            exit 1",
        "          fi",
        "      - run: npm run deploy:render:web:wait -- --expected-build abc123",
        "        env:",
        "          RENDER_WEB_DEPLOY_HOOK_URL: ${{ secrets.RENDER_WEB_DEPLOY_HOOK_URL }}",
        "      - run: |",
        "          if [ -z \"$PROD_API_URL\" ]; then",
        "            echo \"Missing required PROD_API_URL; production deploy cannot verify API health.\"",
        "            exit 1",
        "          fi",
        "          api_ready=false",
        "          echo \"Production API health check failed after 60 attempts.\"",
        "      - run: |",
        "          if [ -z \"$PROD_WEB_URL\" ]; then",
        "            echo \"Missing required PROD_WEB_URL; production deploy cannot verify web health.\"",
        "            exit 1",
        "          fi",
        "          web_ready=false",
        "          echo \"Production web health check failed after 15 attempts.\"",
        "      - run: npm run status:production -- --skip-local",
      ].join("\n"),
    );

    assert.throws(
      () => runGithubActionsCheck({ root }),
      /--api "https:\/\/\$PROD_API_URL\/api"/,
    );
  });
});

test("GitHub Actions check requires production readiness report to use deployed build marker", () => {
  withFixture((root) => {
    writeFixtureFile(
      root,
      ".github/workflows/deploy-prod.yml",
      [
        "name: Deploy Production",
        "jobs:",
        "  deploy-prod:",
        "    steps:",
        "      - run: |",
        "          if [ -z \"$RENDER_WEB_DEPLOY_HOOK_URL\" ]; then",
        "            echo \"Missing required RENDER_WEB_DEPLOY_HOOK_URL; production deploy cannot continue.\"",
        "            exit 1",
        "          fi",
        "      - run: npm run deploy:render:web:wait -- --expected-build abc123",
        "        env:",
        "          RENDER_WEB_DEPLOY_HOOK_URL: ${{ secrets.RENDER_WEB_DEPLOY_HOOK_URL }}",
        "      - run: |",
        "          if [ -z \"$PROD_API_URL\" ]; then",
        "            echo \"Missing required PROD_API_URL; production deploy cannot verify API health.\"",
        "            exit 1",
        "          fi",
        "          api_ready=false",
        "          echo \"Production API health check failed after 60 attempts.\"",
        "      - run: |",
        "          if [ -z \"$PROD_WEB_URL\" ]; then",
        "            echo \"Missing required PROD_WEB_URL; production deploy cannot verify web health.\"",
        "            exit 1",
        "          fi",
        "          web_ready=false",
        "          echo \"Production web health check failed after 15 attempts.\"",
        "      - run: npm run status:production -- --skip-local --api \"https://$PROD_API_URL/api\" --web \"https://$PROD_WEB_URL\"",
      ].join("\n"),
    );

    assert.throws(
      () => runGithubActionsCheck({ root }),
      /--expected-build "\$EXPECTED_BUILD"/,
    );
  });
});
