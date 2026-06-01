#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
function fieldValue(content, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = content.match(new RegExp(`^- ${escaped}:\\s*(.*)$`, "m"));
  return match ? match[1].trim() : "";
}

function validateNote(notePath) {
  const content = fs.readFileSync(notePath, "utf8");
  const issues = [];
  const warnings = [];

  function requireField(label) {
    const value = fieldValue(content, label);
    if (!value) {
      issues.push(`Missing field: ${label}`);
    }
  }

  requireField("Tester");
  requireField("Device model");
  requireField("OS version");
  requireField("Test account role");
  requireField("Fresh install pass");

  const requiredUnchecked = [...content.matchAll(/^- \[ \] (.+)$/gm)].map((match) => match[1]);
  if (requiredUnchecked.length > 0) {
    issues.push(`${requiredUnchecked.length} required result checkbox(es) are still unchecked.`);
  }

  const checked = [...content.matchAll(/^- \[x\] (.+)$/gim)].length;
  if (checked === 0) {
    warnings.push("No checked required results found yet.");
  }

  const qaSummaryBlock = content.match(/## Release QA Summary Paste[\s\S]*?```text\s*([\s\S]*?)```/);
  if (!qaSummaryBlock || !qaSummaryBlock[1].trim()) {
    issues.push("Release QA summary paste is empty.");
  }

  const decision = fieldValue(content, "Decision").toLowerCase();
  if (!decision) {
    issues.push("Go / No-Go decision is empty.");
  } else if (!/\bgo\b|accept|pass|ready/.test(decision)) {
    issues.push(`Go / No-Go decision is not a GO/pass decision: "${fieldValue(content, "Decision")}"`);
  }

  const issueText = fieldValue(content, "Issue");
  if (issueText && !/^n\/?a$|^none$|^-$/i.test(issueText)) {
    warnings.push("Issue section is not empty; review impact/workaround before promotion.");
  }

  return {
    checked,
    issues,
    warnings,
  };
}

function runCli() {
  const notePathArg = process.argv[2];
  if (!notePathArg) {
    console.error("usage: npm run qa:validate -- docs/mobile-device-qa-YYYY-MM-DD-platform-device.md");
    process.exit(2);
  }

  const notePath = path.resolve(rootDir, notePathArg);
  if (!notePath.startsWith(rootDir) || !fs.existsSync(notePath)) {
    console.error(`x QA note not found inside mobile/: ${notePathArg}`);
    process.exit(2);
  }

  const result = validateNote(notePath);

  console.log(`QA note: ${path.relative(rootDir, notePath)}`);
  console.log(`Checked required results: ${result.checked}`);

  if (result.warnings.length > 0) {
    console.log("");
    console.log("Warnings:");
    for (const warning of result.warnings) {
      console.log(`- ${warning}`);
    }
  }

  if (result.issues.length > 0) {
    console.log("");
    console.log("NO-GO:");
    for (const issue of result.issues) {
      console.log(`- ${issue}`);
    }
    process.exit(1);
  }

  console.log("");
  console.log("GO: device QA note is complete enough for preview promotion review.");
}

if (require.main === module) {
  runCli();
}

module.exports = {
  validateNote,
};
