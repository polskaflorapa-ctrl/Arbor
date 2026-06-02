const { execSync } = require("node:child_process");

const DEFAULT_PROJECT_SLUG = "gh/polskaflorapa-ctrl/Arbor";

function parseArgs(argv) {
  const args = {
    branch: null,
    projectSlug: process.env.CIRCLECI_PROJECT_SLUG || DEFAULT_PROJECT_SLUG,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--branch") {
      args.branch = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--branch=")) {
      args.branch = arg.slice("--branch=".length);
      continue;
    }
    if (arg === "--project-slug") {
      args.projectSlug = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--project-slug=")) {
      args.projectSlug = arg.slice("--project-slug=".length);
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

function currentBranch() {
  return execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf8" }).trim();
}

async function triggerPipeline({ token, branch, projectSlug, fetchImpl = global.fetch }) {
  if (!token) {
    throw new Error("CIRCLECI_TOKEN is required");
  }
  if (!branch) {
    throw new Error("Branch is required");
  }
  if (!projectSlug) {
    throw new Error("Project slug is required");
  }
  if (!fetchImpl) {
    throw new Error("fetch is not available in this Node runtime");
  }

  const url = `https://circleci.com/api/v2/project/${encodeURIComponent(projectSlug)}/pipeline`;
  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Circle-Token": token,
    },
    body: JSON.stringify({ branch }),
  });

  const body = await response.text();
  let parsed = null;
  try {
    parsed = body ? JSON.parse(body) : null;
  } catch {
    parsed = null;
  }

  if (!response.ok) {
    const detail = parsed?.message || body || response.statusText;
    throw new Error(`CircleCI trigger failed with ${response.status}: ${detail}`);
  }

  return parsed || {};
}

async function main(argv = process.argv.slice(2), env = process.env) {
  const args = parseArgs(argv);
  const branch = args.branch || currentBranch();

  const result = await triggerPipeline({
    token: env.CIRCLECI_TOKEN,
    branch,
    projectSlug: args.projectSlug,
  });

  console.info(`[circleci-trigger] Triggered pipeline for ${args.projectSlug} on ${branch}`);
  if (result.id) {
    console.info(`[circleci-trigger] Pipeline id: ${result.id}`);
  }
  if (result.number) {
    console.info(`[circleci-trigger] Pipeline number: ${result.number}`);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[circleci-trigger] FAILED: ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  DEFAULT_PROJECT_SLUG,
  parseArgs,
  triggerPipeline,
};
