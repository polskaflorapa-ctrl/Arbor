const fs = require("node:fs");
const path = require("node:path");
const YAML = require("yaml");

const root = path.resolve(__dirname, "..");

const workflowChecks = {
  ".github/workflows/deploy-prod.yml": [
    "npm run db:migrate -w arbor-os",
    "Missing required PROD_DATABASE_URL",
    "deploy:render:web:wait",
    "--expected-build",
    "RENDER_WEB_DEPLOY_HOOK_URL",
    "Missing required RENDER_WEB_DEPLOY_HOOK_URL",
    "Missing required PROD_API_URL",
    "Missing required PROD_WEB_URL",
    "Production API health check failed after 60 attempts.",
    "Production web health check failed after 15 attempts.",
    "--api \"https://$PROD_API_URL/api\"",
    "--web \"https://$PROD_WEB_URL\"",
    "--expected-build \"$EXPECTED_BUILD\"",
    "exit 1",
    "status:production",
  ],
  ".github/workflows/deploy-ready.yml": [
    "npm run verify:contracts",
    "deploy:ready:check",
    "npm run build -w arbor-web",
    "npm run typecheck -w arbor-mobile",
  ],
};

function readWorkflow(relPath, baseDir = root) {
  const fullPath = path.join(baseDir, relPath);
  return {
    text: fs.readFileSync(fullPath, "utf8"),
    parsed: YAML.parse(fs.readFileSync(fullPath, "utf8")),
  };
}

function assertWorkflowParses(relPath, baseDir = root) {
  const { parsed } = readWorkflow(relPath, baseDir);
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`${relPath} is not a valid workflow`);
  }
  if (!parsed.jobs || typeof parsed.jobs !== "object") {
    throw new Error(`${relPath} is missing jobs`);
  }
}

function assertWorkflowIncludes(relPath, needles, baseDir = root) {
  const { text } = readWorkflow(relPath, baseDir);
  const missing = needles.filter((needle) => !text.includes(needle));
  if (missing.length) {
    throw new Error(`${relPath} is missing: ${missing.join(", ")}`);
  }
}

function runGithubActionsCheck(options = {}) {
  const baseDir = options.root || root;
  const checks = options.workflowChecks || workflowChecks;
  for (const [file, needles] of Object.entries(checks)) {
    assertWorkflowParses(file, baseDir);
    assertWorkflowIncludes(file, needles, baseDir);
  }
  return { ok: true, checkedWorkflows: Object.keys(checks).length };
}

if (require.main === module) {
  try {
    const result = runGithubActionsCheck();
    console.log(`[github-actions-check] OK (${result.checkedWorkflows} workflows)`);
  } catch (error) {
    console.error(`[github-actions-check] FAILED: ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  workflowChecks,
  readWorkflow,
  assertWorkflowParses,
  assertWorkflowIncludes,
  runGithubActionsCheck,
};
