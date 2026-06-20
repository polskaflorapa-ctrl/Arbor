#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { getAndroidPreviewUrl } = require("./release-builds.cjs");

const rootDir = path.resolve(__dirname, "..");
const appConfig = JSON.parse(fs.readFileSync(path.join(rootDir, "app.json"), "utf8")).expo;
const environments = JSON.parse(
  fs.readFileSync(path.join(rootDir, "config", "release-environments.json"), "utf8")
);
const storeMetadata = JSON.parse(
  fs.readFileSync(path.join(rootDir, "config", "store-metadata.json"), "utf8")
);

const androidPreviewUrl = getAndroidPreviewUrl();
const sentryDsnConfigured = isEnvSet("EXPO_PUBLIC_SENTRY_DSN");
const sentrySourcemapEnvComplete = hasSentrySourcemapCredentials();

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

function isEnvSet(name) {
  return Boolean(String(process.env[name] || "").trim());
}

function hasSentrySourcemapCredentials() {
  return ["SENTRY_AUTH_TOKEN", "SENTRY_ORG", "SENTRY_PROJECT"].every(isEnvSet);
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

console.log("Production monitoring");
console.log("---------------------");
printLine("Sentry DSN configured", sentryDsnConfigured ? "yes" : "no");
printLine("Sentry sourcemap env", sentrySourcemapEnvComplete ? "complete" : "missing");
printLine("Production monitoring gate", sentryDsnConfigured ? "ready to verify on device" : "blocked for production");
console.log("");

console.log("Store metadata");
console.log("--------------");
printLine("Marketing URL", storeMetadata.marketingUrl || "missing");
printLine("Support URL", storeMetadata.supportUrl || "missing");
printLine("Privacy URL", storeMetadata.privacyPolicyUrl || "missing");
printLine("Manual store gates", String((storeMetadata.manualGates || []).length));
printLine("Legal review required", storeMetadata.legalReviewRequired ? "yes" : "no");
console.log("");

console.log("Readiness");
console.log("---------");
console.log("[ok] Android preview build completed");
console.log("[ok] Android preview ready for device QA");
console.log("[ok] Store metadata check is available: npm run release:store-check");
console.log("[ok] EAS iOS preflight command is available: npm run release:ios:preflight");
console.log("[blocked] iOS preview build needs interactive Apple/EAS credentials setup");
console.log(
  sentryDsnConfigured
    ? "[pending] Production crash/error monitoring must be verified on device"
    : "[blocked] Production crash/error monitoring needs Sentry DSN or an approved external destination"
);
console.log("[pending] Store manual gates need owner evidence before public submission");
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
console.log("npm run release:store-check");
console.log("npm run release:ios:preflight");
console.log("npm run release:ios:credentials");
console.log("npm run release:build:ios:preview");
console.log("");

console.log("QA docs");
console.log("-------");
console.log("docs/mobile-preview-release-2026-06-02-android.md");
console.log("docs/mobile-device-smoke-checklist.md");
console.log("docs/mobile-store-readiness-checklist.md");
