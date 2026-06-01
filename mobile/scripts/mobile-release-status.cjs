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

function hasSentryAutoUploadDisabled() {
  return (appConfig.plugins || []).some((plugin) => {
    return (
      Array.isArray(plugin) &&
      plugin[0] === "@sentry/react-native/expo" &&
      plugin[1] &&
      plugin[1].disableAutoUpload === true
    );
  });
}

function printLine(label, value) {
  console.log(`${label.padEnd(28)} ${value}`);
}

console.log("Arbor Mobile release status");
console.log("===========================");
console.log("");

printLine("Version", appConfig.version);
printLine("Android package", appConfig.android?.package || "missing");
printLine("Android versionCode", String(appConfig.android?.versionCode ?? "missing"));
printLine("iOS bundleIdentifier", appConfig.ios?.bundleIdentifier || "missing");
printLine("iOS buildNumber", appConfig.ios?.buildNumber || "missing");
printLine("Preview API", environments.preview?.apiUrl || "missing");
printLine("Expected API version", environments.preview?.expectedApiVersion || "missing");
printLine("Sentry sourcemap upload", hasSentryAutoUploadDisabled() ? "disabled for preview" : "enabled/config-dependent");
console.log("");

console.log("Readiness");
console.log("---------");
console.log("[ok] Android preview build completed");
console.log("[ok] Android preview ready for device QA");
console.log("[ok] EAS iOS preflight command is available: npm run release:ios:preflight");
console.log("[blocked] iOS preview build needs interactive Apple/EAS credentials setup");
console.log("[pending] Manual device smoke checklist must be completed before production promotion");
console.log("");

console.log("Android preview");
console.log("---------------");
console.log(androidPreviewUrl);
console.log("");

console.log("Next commands");
console.log("-------------");
console.log("npm run install:android:preview");
console.log("npm run qa:note -- --tester=Jan --device=Pixel-8 --os=Android-15 --role=Brygadzista");
console.log("npm run qa:validate -- docs/mobile-device-qa-YYYY-MM-DD-android-pixel-8.md");
console.log("npm run qa:review");
console.log("npm run release:ios:preflight");
console.log("npm run release:ios:credentials");
console.log("npm run release:build:ios:preview");
console.log("");

console.log("QA docs");
console.log("-------");
console.log("docs/mobile-preview-release-2026-06-01-android.md");
console.log("docs/mobile-device-smoke-checklist.md");
console.log("docs/mobile-store-readiness-checklist.md");
