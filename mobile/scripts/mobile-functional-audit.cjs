#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const scanDirs = ["app", "components", "utils", "hooks", "constants"];

function walk(dir) {
  const abs = path.join(rootDir, dir);
  if (!fs.existsSync(abs)) return [];
  const entries = fs.readdirSync(abs, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const full = path.join(abs, entry.name);
    if (entry.isDirectory()) return walk(path.relative(rootDir, full));
    return /\.(tsx?|js)$/.test(entry.name) ? [full] : [];
  });
}

function rel(file) {
  return path.relative(rootDir, file).replace(/\\/g, "/");
}

function routeFromAppFile(file) {
  const relative = rel(file);
  if (!relative.startsWith("app/")) return null;
  return relative
    .replace(/^app\//, "")
    .replace(/\.(tsx|ts|js)$/, "")
    .replace(/\/index$/, "")
    .replace(/^\(tabs\)\//, "(tabs)/");
}

const files = scanDirs.flatMap(walk);
const appFiles = files.filter((file) => rel(file).startsWith("app/"));
const routes = appFiles.map(routeFromAppFile).filter(Boolean).sort();
const lineStats = files
  .map((file) => {
    const text = fs.readFileSync(file, "utf8");
    return {
      file: rel(file),
      lines: text.split(/\r?\n/).length,
      fetches: (text.match(/\bfetch\s*\(/g) || []).length,
      routerPushes: (text.match(/router\.(push|replace)\s*\(/g) || []).length,
      alerts: (text.match(/Alert\.alert\s*\(/g) || []).length,
    };
  })
  .sort((a, b) => b.lines - a.lines);

const largeFiles = lineStats.filter((item) => item.lines >= 1000);
const directFetchCount = lineStats.reduce((sum, item) => sum + item.fetches, 0);
const routerPushCount = lineStats.reduce((sum, item) => sum + item.routerPushes, 0);
const alertCount = lineStats.reduce((sum, item) => sum + item.alerts, 0);
const mobileScreens = routes.filter((route) => /-mobile$/.test(route));
const tabRoutes = routes.filter((route) => route.startsWith("(tabs)/"));

console.log("Mobile functional surface audit");
console.log("===============================");
console.log("");
console.log(`Routes: ${routes.length}`);
console.log(`Files scanned: ${files.length}`);
console.log(`Direct fetch() calls: ${directFetchCount}`);
console.log(`router push/replace calls: ${routerPushCount}`);
console.log(`Alert.alert calls: ${alertCount}`);
console.log("");

console.log("Largest files");
console.log("-------------");
for (const item of lineStats.slice(0, 12)) {
  console.log(`${String(item.lines).padStart(5)}  ${item.file}`);
}
console.log("");

console.log("Risk notes");
console.log("----------");
if (largeFiles.length > 0) {
  console.log(`[warn] ${largeFiles.length} files have 1000+ lines; refactor risk is concentrated there.`);
}
if (lineStats[0]?.lines > 5000) {
  console.log(`[warn] ${lineStats[0].file} has ${lineStats[0].lines} lines and should be split first.`);
}
if (directFetchCount > 50) {
  console.log("[warn] Many screens call fetch() directly; API error/session handling is likely duplicated.");
}
if (mobileScreens.length > 0) {
  console.log(`[info] ${mobileScreens.length} routes use the *-mobile naming pattern; check overlap with web/admin modules.`);
}
if (tabRoutes.length > 0) {
  console.log(`[info] Tab routes exist (${tabRoutes.join(", ")}), while domain routes are registered in the root Stack.`);
}
console.log("");

console.log("Suggested next refactors");
console.log("------------------------");
console.log("1. Split app/zlecenie/[id].tsx into field workflow, photos, finish modal, and office planning modules.");
console.log("2. Introduce a shared API client for auth headers, JSON parsing, and consistent error handling.");
console.log("3. Review *-mobile screens for overlap and decide which are production-critical for field QA.");
console.log("4. Keep Android device QA as the truth for camera, GPS, push, Face ID/privacy lock, and offline replay.");
