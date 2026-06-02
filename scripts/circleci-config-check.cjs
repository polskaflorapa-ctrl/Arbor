const fs = require("node:fs");
const path = require("node:path");
const yaml = require("yaml");

const root = path.resolve(__dirname, "..");
const configPath = path.join(root, ".circleci", "config.yml");

function fail(message) {
  throw new Error(`[circleci-config-check] ${message}`);
}

function readConfig() {
  if (!fs.existsSync(configPath)) {
    fail("Missing .circleci/config.yml");
  }

  const raw = fs.readFileSync(configPath, "utf8");
  return yaml.parse(raw);
}

function workflowJobNames(workflow) {
  return (workflow.jobs || []).map((job) => {
    if (typeof job === "string") {
      return job;
    }
    return Object.keys(job)[0];
  });
}

function getWorkflowJob(workflow, name) {
  return (workflow.jobs || []).find((job) => {
    if (typeof job === "string") {
      return job === name;
    }
    return Object.keys(job)[0] === name;
  });
}

function getWorkflowJobConfig(workflow, name) {
  const job = getWorkflowJob(workflow, name);
  if (!job || typeof job === "string") {
    return {};
  }
  return job[name] || {};
}

function commandText(job, runName) {
  const step = (job.steps || []).find((candidate) => candidate.run?.name === runName);
  return step?.run?.command || "";
}

function assertHasJobs(config, names) {
  for (const name of names) {
    if (!config.jobs?.[name]) {
      fail(`Missing job: ${name}`);
    }
  }
}

function assertWorkflowContains(workflow, names) {
  const present = new Set(workflowJobNames(workflow));
  for (const name of names) {
    if (!present.has(name)) {
      fail(`Workflow is missing job: ${name}`);
    }
  }
}

function assertRequires(workflow, jobName, expected) {
  const actual = getWorkflowJobConfig(workflow, jobName).requires || [];
  for (const name of expected) {
    if (!actual.includes(name)) {
      fail(`${jobName} does not require ${name}`);
    }
  }
}

function assertMainlineOnly(workflow, jobName) {
  const only = getWorkflowJobConfig(workflow, jobName).filters?.branches?.only || [];
  for (const branch of ["main", "master"]) {
    if (!only.includes(branch)) {
      fail(`${jobName} is not filtered to ${branch}`);
    }
  }
}

function assertStoreTestResults(jobName, job) {
  const hasStoreTestResults = (job.steps || []).some((step) => step.store_test_results?.path === "test-results");
  const hasStoreArtifacts = (job.steps || []).some((step) => step.store_artifacts?.path === "test-results");

  if (!hasStoreTestResults) {
    fail(`${jobName} does not upload test results`);
  }
  if (!hasStoreArtifacts) {
    fail(`${jobName} does not upload test artifacts`);
  }
}

function validateCircleciConfig(config) {
  if (config.version !== 2.1) {
    fail("Expected CircleCI version 2.1");
  }

  const nodeImage = config.executors?.node?.docker?.[0]?.image;
  if (nodeImage !== "cimg/node:22.12") {
    fail(`Unexpected Node image: ${nodeImage}`);
  }

  assertHasJobs(config, [
    "scripts",
    "mobile",
    "web",
    "os",
    "os-tests",
    "deploy-ready",
    "verify-green",
    "deploy-ready-green",
  ]);

  const verify = config.workflows?.verify;
  const deployReady = config.workflows?.["deploy-ready"];

  if (!verify) {
    fail("Missing verify workflow");
  }
  if (!deployReady) {
    fail("Missing deploy-ready workflow");
  }

  assertWorkflowContains(verify, ["scripts", "mobile", "web", "os", "os-tests", "verify-green"]);
  assertRequires(verify, "verify-green", ["scripts", "mobile", "web", "os", "os-tests"]);

  assertWorkflowContains(deployReady, ["deploy-ready", "deploy-ready-green"]);
  assertRequires(deployReady, "deploy-ready-green", ["deploy-ready"]);
  assertMainlineOnly(deployReady, "deploy-ready");
  assertMainlineOnly(deployReady, "deploy-ready-green");

  assertStoreTestResults("web", config.jobs.web);
  assertStoreTestResults("os-tests", config.jobs["os-tests"]);

  const webCommand = commandText(config.jobs.web, "Test web");
  if (!webCommand.includes("--reporter=junit") || !webCommand.includes("test-results/vitest/results.xml")) {
    fail("Web job does not generate Vitest JUnit output");
  }

  const osTestsCommand = commandText(config.jobs["os-tests"], "Test Arbor OS");
  if (!osTestsCommand.includes("--reporters=jest-junit") || !osTestsCommand.includes("test-results/jest")) {
    fail("OS test job does not generate Jest JUnit output");
  }
}

function main() {
  validateCircleciConfig(readConfig());

  console.info("[circleci-config-check] OK");
}

if (require.main === module) {
  main();
}

module.exports = {
  assertHasJobs,
  assertMainlineOnly,
  assertRequires,
  assertStoreTestResults,
  assertWorkflowContains,
  commandText,
  getWorkflowJobConfig,
  main,
  validateCircleciConfig,
  workflowJobNames,
};
