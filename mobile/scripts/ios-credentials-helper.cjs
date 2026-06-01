#!/usr/bin/env node

const { spawnSync } = require("node:child_process");

const easCliPackage = "eas-cli@19.1.0";
const mode = process.argv[2] || "check";

function npmExecEas(args, stdio = "inherit") {
  const npmCli = process.env.npm_execpath;
  const command = npmCli ? process.execPath : process.platform === "win32" ? "npm.cmd" : "npm";
  const npmArgs = npmCli
    ? [npmCli, "exec", "--yes", "--package", easCliPackage, "--", "eas", ...args]
    : ["exec", "--yes", "--package", easCliPackage, "--", "eas", ...args];

  return spawnSync(command, npmArgs, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      EAS_NO_VCS: process.env.EAS_NO_VCS || "1",
    },
    encoding: stdio === "pipe" ? "utf8" : undefined,
    stdio,
  });
}

function printNextSteps() {
  console.log("");
  console.log("Next iOS steps:");
  console.log("1. Run: npm run release:ios:credentials");
  console.log("2. Complete the interactive Apple/EAS prompts.");
  console.log("3. Run: npm run release:build:ios:preview");
  console.log("");
  console.log("Notes:");
  console.log("- This must be run by the Apple account/release operator.");
  console.log("- Keep Apple 2FA available.");
  console.log("- The Android preview build is already available for QA.");
}

function check() {
  console.log("Checking iOS credentials readiness...\n");

  const cli = npmExecEas(["--version"], "pipe");
  if (cli.status !== 0) {
    console.error("x EAS CLI is not available.");
    console.error((cli.stderr || cli.stdout || "").trim());
    printNextSteps();
    process.exit(1);
  }
  console.log(`ok EAS CLI: ${(cli.stdout || cli.stderr || "").trim().split(/\r?\n/)[0]}`);

  const whoami = npmExecEas(["whoami"], "pipe");
  if (whoami.status !== 0) {
    console.error("x EAS account is not authenticated.");
    console.error("Run: npm exec --yes --package eas-cli@19.1.0 -- eas login");
    printNextSteps();
    process.exit(1);
  }
  console.log(`ok EAS account: ${(whoami.stdout || "").trim().split(/\r?\n/)[0]}`);

  const project = npmExecEas(["project:info", "--non-interactive"], "pipe");
  if (project.status !== 0) {
    console.error("x EAS project access is not ready.");
    console.error((project.stderr || project.stdout || "").trim());
    printNextSteps();
    process.exit(1);
  }
  console.log("ok EAS project access");

  console.log("\niOS credentials still need an interactive Apple/EAS step before non-interactive preview builds can succeed.");
  printNextSteps();
}

function credentials() {
  console.log("Starting interactive EAS credentials flow for iOS preview...\n");
  console.log("Use this to create/select Apple distribution credentials and provisioning for internal preview builds.");
  console.log("If asked, choose the iOS app identifier: com.arbor.mobile");
  console.log("");

  const result = npmExecEas(["credentials", "--platform", "ios"], "inherit");
  process.exit(result.status ?? 0);
}

switch (mode) {
  case "check":
    check();
    break;
  case "credentials":
    credentials();
    break;
  default:
    console.error(`Unknown mode "${mode}". Use check or credentials.`);
    process.exit(2);
}
