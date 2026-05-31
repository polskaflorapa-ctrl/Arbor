#!/usr/bin/env node
const { spawn } = require("node:child_process");

const mode = process.argv[2] || "start";
const isWindows = process.platform === "win32";

function showUsage() {
  console.log(`usage: node ./script/build_and_run.cjs [mode]

Modes:
  start, run        Start the Expo dev server
  --ios, ios        Start Expo and open iOS
  --android, android
                   Start Expo and open Android
  --web, web        Start Expo for web
  --dev-client, dev-client
                   Start Expo in development-client mode
  --tunnel, tunnel Start Expo using tunnel transport
  --export-web, export-web
                   Export the web build locally
  --doctor, doctor Run Expo diagnostics
  --help, help     Show this help`);
}

function commandFor(parts) {
  if (process.env.EXPO_CLI) {
    return {
      command: process.env.EXPO_CLI,
      args: parts.slice(1),
      shell: true,
    };
  }

  const npx = isWindows ? "npx.cmd" : "npx";
  if (isWindows) {
    return {
      command: [npx, ...parts].join(" "),
      args: [],
      shell: true,
    };
  }

  return {
    command: npx,
    args: parts,
    shell: false,
  };
}

function run(parts) {
  const childConfig = commandFor(parts);
  const child = spawn(childConfig.command, childConfig.args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
    shell: childConfig.shell,
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
}

switch (mode) {
  case "start":
  case "run":
    run(["expo", "start"]);
    break;
  case "--ios":
  case "ios":
    run(["expo", "start", "--ios"]);
    break;
  case "--android":
  case "android":
    run(["expo", "start", "--android"]);
    break;
  case "--web":
  case "web":
    run(["expo", "start", "--web"]);
    break;
  case "--dev-client":
  case "dev-client":
    run(["expo", "start", "--dev-client"]);
    break;
  case "--tunnel":
  case "tunnel":
    run(["expo", "start", "--tunnel"]);
    break;
  case "--export-web":
  case "export-web":
    run(["expo", "export", "--platform", "web"]);
    break;
  case "--doctor":
  case "doctor":
    run(["expo-doctor"]);
    break;
  case "--help":
  case "help":
    showUsage();
    break;
  default:
    showUsage();
    process.exit(2);
}
