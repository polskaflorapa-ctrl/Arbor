#!/usr/bin/env node
/**
 * expo-router _ctx.*.js — zastępuje process.env.EXPO_ROUTER_APP_ROOT / IMPORT_MODE
 * literałami (ścieżka względna do mobile/app od faktycznego katalogu expo-router).
 */
const fs = require('fs');
const path = require('path');

const mobileRoot = path.resolve(__dirname, '..');
const appDir = path.join(mobileRoot, 'app');

let expoRouterDir;
try {
  expoRouterDir = path.dirname(require.resolve('expo-router/package.json', { paths: [mobileRoot] }));
} catch {
  console.warn('[patch-expo-router-ctx] Pomijam: brak expo-router.');
  process.exit(0);
}

if (!fs.existsSync(appDir)) {
  console.warn('[patch-expo-router-ctx] Pomijam: brak app/.');
  process.exit(0);
}

let rel = path.relative(expoRouterDir, appDir);
if (!rel || rel === '.') {
  console.warn('[patch-expo-router-ctx] Pomijam: pusta ścieżka względna.');
  process.exit(0);
}
rel = rel.split(path.sep).join('/');

for (const name of ['_ctx.ios.js', '_ctx.android.js', '_ctx.web.js']) {
  const fp = path.join(expoRouterDir, name);
  if (!fs.existsSync(fp)) continue;
  let s = fs.readFileSync(fp, 'utf8');
  if (!s.includes('process.env.EXPO_ROUTER_APP_ROOT')) continue;
  s = s.replace(/\bprocess\.env\.EXPO_ROUTER_APP_ROOT\b/g, JSON.stringify(rel));
  s = s.replace(/\bprocess\.env\.EXPO_ROUTER_IMPORT_MODE\b/g, JSON.stringify('sync'));
  fs.writeFileSync(fp, s, 'utf8');
}

console.info('[patch-expo-router-ctx] OK (app →', rel + ')');
