#!/usr/bin/env node
/**
 * Patche po `npm install` (monorepo Windows):
 * 1) expo-router _ctx.* — process.env → literał ścieżki do mobile/app (każda znaleziona kopia).
 * 2) react-native VirtualViewExperimental… — workaround RN #56269 (każda znaleziona kopia).
 *
 * Uruchamiaj z roota: `node mobile/scripts/postinstall-patches.cjs`
 * lub z mobile: `node ./scripts/postinstall-patches.cjs`
 */
const fs = require('fs');
const path = require('path');

const mobileRoot = path.resolve(__dirname, '..');
const appDir = path.join(mobileRoot, 'app');

function ancestorDirs(start, max = 12) {
  const out = [];
  let d = path.resolve(start);
  for (let i = 0; i < max; i++) {
    out.push(d);
    const p = path.dirname(d);
    if (p === d) break;
    d = p;
  }
  return out;
}

function patchExpoRouterAll() {
  if (!fs.existsSync(appDir)) {
    console.warn('[patches] Brak katalogu app/ — pomijam expo-router.');
    return;
  }
  for (const base of ancestorDirs(mobileRoot)) {
    const expoDir = path.join(base, 'node_modules', 'expo-router');
    const ctxIos = path.join(expoDir, '_ctx.ios.js');
    if (!fs.existsSync(ctxIos)) continue;

    const rel = path.relative(expoDir, appDir).split(path.sep).join('/');
    if (!rel || rel === '.') continue;

    for (const name of ['_ctx.ios.js', '_ctx.android.js', '_ctx.web.js']) {
      const fp = path.join(expoDir, name);
      if (!fs.existsSync(fp)) continue;
      let s = fs.readFileSync(fp, 'utf8');
      if (!s.includes('process.env.EXPO_ROUTER_APP_ROOT')) continue;
      s = s.replace(/\bprocess\.env\.EXPO_ROUTER_APP_ROOT\b/g, JSON.stringify(rel));
      s = s.replace(/\bprocess\.env\.EXPO_ROUTER_IMPORT_MODE\b/g, JSON.stringify('sync'));
      fs.writeFileSync(fp, s, 'utf8');
      console.info('[patches] expo-router', name, '←', expoDir);
    }
  }
}

function patchVirtualViewAll() {
  const rel = path.join(
    'src',
    'private',
    'components',
    'virtualview',
    'VirtualViewExperimentalNativeComponent.js'
  );
  const needle = ') as HostComponent<VirtualViewExperimentalNativeProps>;';
  const doneMarker = '): HostComponent<VirtualViewExperimentalNativeProps>);';

  for (const base of ancestorDirs(mobileRoot)) {
    const fp = path.join(base, 'node_modules', 'react-native', rel);
    if (!fs.existsSync(fp)) continue;
    let s = fs.readFileSync(fp, 'utf8');
    if (s.includes(doneMarker)) continue;
    if (!s.includes(needle)) continue;
    s = s.replace(
      'export default codegenNativeComponent<VirtualViewExperimentalNativeProps>(',
      'export default (codegenNativeComponent<VirtualViewExperimentalNativeProps>('
    );
    s = s.replace(needle, '): HostComponent<VirtualViewExperimentalNativeProps>);');
    fs.writeFileSync(fp, s, 'utf8');
    console.info('[patches] VirtualView ←', fp);
  }
}

patchExpoRouterAll();
patchVirtualViewAll();
console.info('[patches] Gotowe.');
