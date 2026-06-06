#!/usr/bin/env node
const { spawnSync } = require("node:child_process");

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    baseUrl: process.env.ARBOR_PROD_BASE_URL || "",
    webUrl: process.env.ARBOR_PROD_WEB_URL || "",
    skipBuild: false,
    skipDeployReady: false,
    skipRemoteSmoke: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--base-url") {
      options.baseUrl = argv[index + 1] || "";
      index += 1;
    } else if (arg.startsWith("--base-url=")) {
      options.baseUrl = arg.slice("--base-url=".length);
    } else if (arg === "--web-url") {
      options.webUrl = argv[index + 1] || "";
      index += 1;
    } else if (arg.startsWith("--web-url=")) {
      options.webUrl = arg.slice("--web-url=".length);
    } else if (arg === "--skip-build") {
      options.skipBuild = true;
    } else if (arg === "--skip-deploy-ready") {
      options.skipDeployReady = true;
    } else if (arg === "--skip-remote-smoke") {
      options.skipRemoteSmoke = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/production-readiness.cjs [options]

Options:
  --base-url <url>        Public arbor-os URL for API smoke, e.g. https://arbor-os.onrender.com
  --web-url <url>         Public arbor-web URL for web TTI smoke
  --skip-build            Skip local production web build
  --skip-deploy-ready     Skip deploy:ready:check
  --skip-remote-smoke     Skip remote API/TTI smoke even when URLs are provided

Environment aliases:
  ARBOR_PROD_BASE_URL     Same as --base-url
  ARBOR_PROD_WEB_URL      Same as --web-url
  SMOKE_LOGIN/PASSWORD    Enables authenticated API smoke
`);
}

function npmCommand(args, options = {}) {
  return {
    command: "npm",
    args,
    env: options.env,
    optional: options.optional,
  };
}

function runStep(step) {
  const label = [step.command, ...step.args].join(" ");
  console.log(`[production-readiness] ${label}`);
  const command = process.platform === "win32" && step.command === "npm" ? "cmd.exe" : step.command;
  const args =
    process.platform === "win32" && step.command === "npm"
      ? ["/d", "/s", "/c", ["npm", ...step.args].join(" ")]
      : step.args;
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: step.env ? { ...process.env, ...step.env } : process.env,
  });

  if (result.status !== 0) {
    const message = `Step failed: ${label}`;
    if (step.optional) {
      console.warn(`[production-readiness] WARN: ${message}`);
      return false;
    }
    throw new Error(message);
  }

  return true;
}

function buildSteps(options) {
  const steps = [
    npmCommand(["run", "deploy:prod:dry-run"]),
    npmCommand(["run", "verify:env-runbook"]),
    npmCommand(["run", "verify:web-tti"]),
    npmCommand(["run", "verify:scale-readiness"]),
    npmCommand(["run", "verify:observability"]),
    npmCommand(["run", "verify:backup-rpo"]),
  ];

  if (!options.skipBuild) {
    steps.push(npmCommand(["run", "build"]));
  }

  if (!options.skipDeployReady) {
    steps.push(npmCommand(["run", "deploy:ready:check"]));
  }

  if (!options.skipRemoteSmoke && options.baseUrl) {
    steps.push(npmCommand(["run", "deploy:free:check", "--", options.baseUrl]));
    steps.push(npmCommand(["run", "smoke:render", "--", options.baseUrl]));
    steps.push(npmCommand(["run", "smoke:p95", "--", options.baseUrl, "--threshold", "500", "--samples", "5"]));
  }

  if (!options.skipRemoteSmoke && options.webUrl) {
    steps.push(
      npmCommand(["run", "smoke:web:tti", "--", "--threshold", "3000", "--mobile"], {
        env: { ARBOR_WEB_TTI_BASE: options.webUrl },
      }),
    );
  }

  return steps;
}

function main() {
  const options = parseArgs();
  if (options.help) {
    printHelp();
    return;
  }

  const steps = buildSteps(options);
  for (const step of steps) {
    runStep(step);
  }

  if (!options.baseUrl && !options.webUrl && !options.skipRemoteSmoke) {
    console.log("[production-readiness] Remote smoke skipped: pass --base-url and/or --web-url after deploy.");
  }

  console.log("[production-readiness] OK");
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`[production-readiness] FAILED: ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  parseArgs,
  buildSteps,
  runStep,
};
