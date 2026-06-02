const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const yaml = require("yaml");

const { validateCircleciConfig } = require("./circleci-config-check.cjs");

function loadCurrentConfig() {
  const configPath = path.resolve(__dirname, "..", ".circleci", "config.yml");
  return yaml.parse(fs.readFileSync(configPath, "utf8"));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test("CircleCI config check validates the current repository config", () => {
  assert.doesNotThrow(() => validateCircleciConfig(loadCurrentConfig()));
});

test("CircleCI config check requires verify-green to depend on backend tests", () => {
  const config = clone(loadCurrentConfig());
  const verifyGreen = config.workflows.verify.jobs.find((job) => job["verify-green"]);
  verifyGreen["verify-green"].requires = verifyGreen["verify-green"].requires.filter((job) => job !== "os-tests");

  assert.throws(() => validateCircleciConfig(config), /verify-green does not require os-tests/);
});

test("CircleCI config check requires deploy-ready to stay mainline-only", () => {
  const config = clone(loadCurrentConfig());
  const deployReady = config.workflows["deploy-ready"].jobs.find((job) => job["deploy-ready"]);
  deployReady["deploy-ready"].filters.branches.only = ["master"];

  assert.throws(() => validateCircleciConfig(config), /deploy-ready is not filtered to main/);
});

test("CircleCI config check requires web JUnit upload", () => {
  const config = clone(loadCurrentConfig());
  config.jobs.web.steps = config.jobs.web.steps.filter((step) => !step.store_test_results);

  assert.throws(() => validateCircleciConfig(config), /web does not upload test results/);
});

test("CircleCI config check requires OS tests to emit Jest JUnit", () => {
  const config = clone(loadCurrentConfig());
  const testStep = config.jobs["os-tests"].steps.find((step) => step.run?.name === "Test Arbor OS");
  testStep.run.command = "npm run verify:os:test";

  assert.throws(() => validateCircleciConfig(config), /OS test job does not generate Jest JUnit output/);
});
