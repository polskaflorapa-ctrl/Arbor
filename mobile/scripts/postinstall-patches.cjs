#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const mobileRoot = path.resolve(__dirname, '..');

function copyIfMissing(packageName, fileName) {
  const mobilePackageDir = path.join(mobileRoot, 'node_modules', packageName);
  const hoistedPackageDir = path.join(repoRoot, 'node_modules', packageName);
  const target = path.join(mobilePackageDir, fileName);
  const source = path.join(hoistedPackageDir, fileName);

  if (!fs.existsSync(mobilePackageDir) || fs.existsSync(target)) {
    return;
  }

  if (!fs.existsSync(source)) {
    console.warn(`[postinstall] Cannot patch ${packageName}: ${source} is missing.`);
    return;
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  console.log(`[postinstall] Restored ${packageName}/${fileName} for Metro resolution.`);
}

copyIfMissing('split-on-first', 'index.js');
copyIfMissing('split-on-first', 'license');
copyIfMissing('split-on-first', 'readme.md');
