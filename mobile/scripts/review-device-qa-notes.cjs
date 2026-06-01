#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { validateNote } = require("./validate-device-qa-note.cjs");

const rootDir = path.resolve(__dirname, "..");
const docsDir = path.join(rootDir, "docs");
const notes = fs
  .readdirSync(docsDir)
  .filter((name) => /^mobile-device-qa-\d{4}-\d{2}-\d{2}-.+\.md$/.test(name))
  .sort();

if (notes.length === 0) {
  console.log("NO-GO: no device QA notes found.");
  console.log("Create one with:");
  console.log("npm run qa:note -- --tester=Jan --device=Pixel-8 --os=Android-15 --role=Brygadzista");
  process.exit(1);
}

let goCount = 0;
let noGoCount = 0;
let warningCount = 0;

console.log("Device QA review");
console.log("================");
console.log("");

for (const note of notes) {
  const notePath = path.join(docsDir, note);
  const result = validateNote(notePath);
  const isGo = result.issues.length === 0;
  if (isGo) {
    goCount += 1;
  } else {
    noGoCount += 1;
  }
  warningCount += result.warnings.length;

  console.log(`${isGo ? "GO" : "NO-GO"} ${path.join("docs", note)}`);
  console.log(`  checked: ${result.checked}`);
  if (result.issues.length > 0) {
    console.log(`  issues: ${result.issues.length}`);
  }
  if (result.warnings.length > 0) {
    console.log(`  warnings: ${result.warnings.length}`);
  }
}

console.log("");
console.log("Summary");
console.log("-------");
console.log(`GO notes: ${goCount}`);
console.log(`NO-GO notes: ${noGoCount}`);
console.log(`Warnings: ${warningCount}`);

if (goCount === 0 || noGoCount > 0) {
  console.log("");
  console.log("NO-GO: release promotion review needs all device QA notes passing.");
  process.exit(1);
}

console.log("");
console.log("GO: all discovered device QA notes pass validation.");
