#!/usr/bin/env node

const { spawnSync } = require("node:child_process");

const buildUrl =
  process.env.EAS_ANDROID_PREVIEW_URL ||
  "https://expo.dev/accounts/arboros/projects/arbor-mobile/builds/11b7dd68-da12-424d-a893-1f403d7d29ea";

function run(command, args) {
  return spawnSync(command, args, {
    encoding: "utf8",
    shell: process.platform === "win32",
  });
}

function printManualInstall(reason) {
  console.log(`Android preview install helper: ${reason}`);
  console.log("");
  console.log("Manual install:");
  console.log(`1. Open ${buildUrl}`);
  console.log("2. Scan the QR code or open the link on the Android test device.");
  console.log("3. Install the build and run docs/mobile-device-smoke-checklist.md.");
  console.log("");
  console.log("Optional ADB install path:");
  console.log("- Install Android platform-tools and make sure adb is in PATH.");
  console.log("- Connect one Android device with USB debugging enabled.");
  console.log("- Download the APK from the EAS build page.");
  console.log("- Run: adb install -r path/to/build.apk");
}

const adbVersion = run("adb", ["version"]);

if (adbVersion.error || adbVersion.status !== 0) {
  printManualInstall("adb is not available in PATH.");
  process.exit(0);
}

const devices = run("adb", ["devices"]);

if (devices.status !== 0) {
  printManualInstall("adb is available, but device discovery failed.");
  process.exit(0);
}

const connectedDevices = devices.stdout
  .split(/\r?\n/)
  .slice(1)
  .map((line) => line.trim())
  .filter(Boolean)
  .filter((line) => /\tdevice$/.test(line));

if (connectedDevices.length === 0) {
  printManualInstall("no Android device is connected and authorized.");
  process.exit(0);
}

console.log("Android device detected:");
for (const line of connectedDevices) {
  console.log(`- ${line.replace(/\tdevice$/, "")}`);
}

console.log("");
console.log("Open the EAS build page to download/install the preview build:");
console.log(buildUrl);
console.log("");
console.log("After install, run docs/mobile-device-smoke-checklist.md.");
