#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { getAndroidPreviewUrl } = require("./release-builds.cjs");

const rootDir = path.resolve(__dirname, "..");
const appConfig = JSON.parse(fs.readFileSync(path.join(rootDir, "app.json"), "utf8")).expo;
const environments = JSON.parse(
  fs.readFileSync(path.join(rootDir, "config", "release-environments.json"), "utf8")
);

const androidPreviewUrl = getAndroidPreviewUrl();

function parseArgs(argv) {
  const values = {
    platform: "android",
    tester: "",
    device: "",
    os: "",
    role: "",
  };

  for (const arg of argv) {
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (!match) {
      continue;
    }
    const [, key, value] = match;
    if (Object.prototype.hasOwnProperty.call(values, key)) {
      values[key] = value;
    }
  }

  return values;
}

function todayStamp() {
  return new Date().toISOString().slice(0, 10);
}

function safeSlug(value, fallback) {
  return (value || fallback)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function checkbox(label) {
  return `- [ ] ${label}`;
}

const options = parseArgs(process.argv.slice(2));
const platform = options.platform.toLowerCase() === "ios" ? "ios" : "android";
const fileName = `mobile-device-qa-${todayStamp()}-${platform}-${safeSlug(options.device, "device")}.md`;
const outputPath = path.join(rootDir, "docs", fileName);

if (fs.existsSync(outputPath)) {
  console.error(`x QA note already exists: ${path.relative(rootDir, outputPath)}`);
  console.error("Pass a different --device value or rename the existing file.");
  process.exit(1);
}

const buildUrl = platform === "android" ? androidPreviewUrl : "";
const buildNumber = platform === "android" ? appConfig.android?.versionCode : appConfig.ios?.buildNumber;
const packageId = platform === "android" ? appConfig.android?.package : appConfig.ios?.bundleIdentifier;

const lines = [
  `# Mobile Device QA - ${platform.toUpperCase()} - ${todayStamp()}`,
  "",
  "## Build",
  "",
  `- Version: ${appConfig.version}`,
  `- Platform: ${platform}`,
  `- Package / bundle id: ${packageId || ""}`,
  `- Build number / version code: ${buildNumber || ""}`,
  `- EAS profile: preview`,
  `- EAS build URL: ${buildUrl}`,
  `- API environment: preview`,
  `- API URL: ${environments.preview?.apiUrl || ""}`,
  `- Expected API version: ${environments.preview?.expectedApiVersion || ""}`,
  `- Date: ${todayStamp()}`,
  "",
  "## Tester",
  "",
  `- Tester: ${options.tester}`,
  `- Device model: ${options.device}`,
  `- OS version: ${options.os}`,
  `- Test account role: ${options.role}`,
  `- Fresh install pass:`,
  `- Upgrade install pass:`,
  "",
  "## Required Results",
  "",
  checkbox("Login/session restore passed."),
  checkbox("Permissions prompts and denied-permission fallbacks passed."),
  checkbox("GPS live off/on, last sync, and blocked state passed."),
  checkbox("Task detail and status update flow passed."),
  checkbox("Camera/gallery upload and photo preview passed."),
  checkbox("Offline queue replay reached backend exactly once."),
  checkbox("Finish task validation and submit passed."),
  checkbox("Push notification deep link passed."),
  checkbox("Release QA summary from API Diagnostics pasted below."),
  checkbox("Local crash/error report fallback passed."),
  checkbox("Sentry status in API Diagnostics matches release intent."),
  checkbox("Privacy lock / Face ID passed."),
  checkbox("No redbox, uncaught exception, stuck spinner, or mojibake observed."),
  "",
  "## Release QA Summary Paste",
  "",
  "Paste the API Diagnostics Release QA copy output here.",
  "",
  "```text",
  "",
  "```",
  "",
  "## Issues",
  "",
  "- Issue:",
  "- Impact:",
  "- Workaround:",
  "- Owner:",
  "- Decision:",
  "",
  "## Go / No-Go",
  "",
  "- Decision:",
  "- Approver:",
  "- Notes:",
  "",
].join("\n");

fs.writeFileSync(outputPath, lines);

console.log(`Created ${path.relative(rootDir, outputPath)}`);
console.log("");
console.log("Next:");
console.log("1. Install the preview build on the device.");
console.log("2. Run docs/mobile-device-smoke-checklist.md.");
console.log(`3. Fill ${path.relative(rootDir, outputPath)}.`);
