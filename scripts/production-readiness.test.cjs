const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildSteps,
  parseArgs,
} = require("./production-readiness.cjs");

function labels(steps) {
  return steps.map((step) => [step.command, ...step.args].join(" "));
}

test("production readiness parses public API and web URLs with skip flags", () => {
  const options = parseArgs([
    "--base-url",
    "https://api.arbor.test",
    "--web-url=https://app.arbor.test",
    "--skip-build",
    "--skip-deploy-ready",
    "--skip-remote-smoke",
  ]);

  assert.deepEqual(options, {
    baseUrl: "https://api.arbor.test",
    webUrl: "https://app.arbor.test",
    skipBuild: true,
    skipDeployReady: true,
    skipRemoteSmoke: true,
  });
});

test("production readiness includes dry run, guard checks, build, deploy ready, and remote smoke", () => {
  const steps = buildSteps({
    baseUrl: "https://api.arbor.test",
    webUrl: "https://app.arbor.test",
    skipBuild: false,
    skipDeployReady: false,
    skipRemoteSmoke: false,
  });

  assert.deepEqual(labels(steps), [
    "npm run deploy:prod:dry-run",
    "npm run verify:env-runbook",
    "npm run verify:web-tti",
    "npm run verify:scale-readiness",
    "npm run verify:observability",
    "npm run verify:backup-rpo",
    "npm run verify:contracts",
    "npm run build",
    "npm run deploy:ready:check",
    "npm run deploy:free:check -- https://api.arbor.test",
    "npm run smoke:render -- https://api.arbor.test",
    "npm run smoke:p95 -- https://api.arbor.test --threshold 500 --samples 5",
    "npm run smoke:web:tti -- --threshold 3000 --mobile",
  ]);
  assert.deepEqual(steps.at(-1).env, { ARBOR_WEB_TTI_BASE: "https://app.arbor.test" });
});

test("production readiness can skip slow local and remote phases", () => {
  const steps = buildSteps({
    baseUrl: "https://api.arbor.test",
    webUrl: "https://app.arbor.test",
    skipBuild: true,
    skipDeployReady: true,
    skipRemoteSmoke: true,
  });

  assert.equal(labels(steps).includes("npm run build"), false);
  assert.equal(labels(steps).includes("npm run deploy:ready:check"), false);
  assert.equal(labels(steps).some((label) => label.includes("smoke:render")), false);
  assert.equal(labels(steps).some((label) => label.includes("smoke:web:tti")), false);
});
