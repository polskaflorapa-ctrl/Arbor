#!/usr/bin/env node
/**
 * Metro: „Unable to determine event arguments for onModeChange” (VirtualViewExperimental…).
 * Workaround jak RN #56269 — plus w monorepo trzeba znaleźć *pełny* react-native (nie stub w mobile/node_modules).
 */
const fs = require('fs');
const path = require('path');

const mobileRoot = path.resolve(__dirname, '..');
const relTarget =
  'src/private/components/virtualview/VirtualViewExperimentalNativeComponent.js';

function findReactNativeWithVirtualView() {
  let dir = mobileRoot;
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, 'node_modules', 'react-native');
    const fp = path.join(candidate, relTarget);
    if (fs.existsSync(fp)) return { rnRoot: candidate, fp };
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const found = findReactNativeWithVirtualView();
if (!found) {
  console.warn('[patch-rn-virtualview] Pomijam: nie znaleziono react-native z VirtualViewExperimental….');
  process.exit(0);
}

const { fp } = found;
let s = fs.readFileSync(fp, 'utf8');
if (s.includes('): HostComponent<VirtualViewExperimentalNativeProps>);')) {
  console.info('[patch-rn-virtualview] Już załatane.');
  process.exit(0);
}

const needle = ') as HostComponent<VirtualViewExperimentalNativeProps>;';
if (!s.includes(needle)) {
  console.warn('[patch-rn-virtualview] Pomijam: nieoczekiwana treść (inna wersja RN?).');
  process.exit(0);
}

s = s.replace(
  'export default codegenNativeComponent<VirtualViewExperimentalNativeProps>(',
  'export default (codegenNativeComponent<VirtualViewExperimentalNativeProps>('
);
s = s.replace(needle, '): HostComponent<VirtualViewExperimentalNativeProps>);');

fs.writeFileSync(fp, s, 'utf8');
console.info('[patch-rn-virtualview] OK →', fp);
