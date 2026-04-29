#!/usr/bin/env node
/**
 * Patche po `npm install` (monorepo Windows):
 * 1) expo-router _ctx.* — process.env → literał ścieżki do mobile/app (każda znaleziona kopia).
 * 2) react-native VirtualView* — RN #56269 + **usunięcie `onModeChange` z typu props**
 *    w `VirtualViewExperimentalNativeComponent.js` i `VirtualViewNativeComponent.js`
 *    (interfaceOnly — Babel/codegen; RN 0.81: `DirectEventHandler` bez generyków + `as HostComponent` bez `<Props>`;
 *    runtime: VirtualView.js nadal przekazuje handler).
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

function uniqueReactNativeRoots() {
  const dirs = new Set();
  for (const base of [...ancestorDirs(mobileRoot), mobileRoot]) {
    const d = path.join(base, 'node_modules', 'react-native');
    if (!fs.existsSync(d)) continue;
    try {
      dirs.add(fs.realpathSync(d));
    } catch {
      dirs.add(d);
    }
  }
  return [...dirs];
}

/** Usuń blok onModeChange z typu props (wszystkie warianty po wcześniejszych patchach). */
function stripOnModeChangeFromProps(raw) {
  if (raw.includes('ARBOR_NO_ONMODE')) return raw;
  const hadCRLF = raw.includes('\r\n');
  let out = raw.replace(/\r\n/g, '\n');
  const replacement =
    '  /* ARBOR_NO_ONMODE — onModeChange usunięty z typu Flow (Babel/codegen); VirtualView.js nadal przekazuje handler */\n';

  const strips = [
    `  /**
   * See \`NativeModeChangeEvent\`.
   */
  /* ARBOR_PATCH onModeChange — uproszczone argumenty dla Babel/codegen */
  onModeChange?: ?DirectEventHandler<{|mode: Int32|}>,`,
    `  /**
   * See \`NativeModeChangeEvent\`.
   */
  onModeChange?: ?DirectEventHandler<NativeModeChangeEvent>,`,
    `  /**
   * See \`NativeModeChangeEvent\`.
   */
  onModeChange?: ?DirectEventHandler,`,
  ];
  let changed = false;
  for (const block of strips) {
    if (out.includes(block)) {
      out = out.replace(block, replacement);
      changed = true;
      break;
    }
  }
  if (!changed) {
    const reFallback =
      /\n\s+\/\*\*\s*\n\s+\*\s*See `NativeModeChangeEvent`\.\s*\n\s+\*\/\s*\n(?:\s*\/\* ARBOR_PATCH[^\n]*\n)?\s*onModeChange\?\s*:\s*\?\s*DirectEventHandler[^,\n]*\s*,/;
    if (reFallback.test(out)) {
      out = out.replace(reFallback, '\n' + replacement);
      changed = true;
    }
  }
  if (!changed) return raw;
  return hadCRLF ? out.replace(/\n/g, '\r\n') : out;
}

function patchHostComponentWrap(raw, propsName) {
  const hadCRLF = raw.includes('\r\n');
  let s = raw.replace(/\r\n/g, '\n');
  const out = () => (hadCRLF ? s.replace(/\n/g, '\r\n') : s);

  const isExp = propsName === 'VirtualViewExperimentalNativeProps';

  if (isExp) {
    const needleTyped = ') as HostComponent<VirtualViewExperimentalNativeProps>;';
    const doneTyped = '): HostComponent<VirtualViewExperimentalNativeProps>);';
    if (
      s.includes(needleTyped) &&
      !s.includes(doneTyped) &&
      s.includes('export default codegenNativeComponent<VirtualViewExperimentalNativeProps>(')
    ) {
      s = s
        .replace(
          'export default codegenNativeComponent<VirtualViewExperimentalNativeProps>(',
          'export default (codegenNativeComponent<VirtualViewExperimentalNativeProps>('
        )
        .replace(needleTyped, doneTyped);
      return out();
    }
    const donePlain = '): HostComponent);';
    if (
      s.includes(') as HostComponent;') &&
      !s.includes(donePlain) &&
      s.includes("'VirtualViewExperimental'")
    ) {
      if (s.includes('export default codegenNativeComponent (')) {
        s = s.replace('export default codegenNativeComponent (', 'export default (codegenNativeComponent (');
      } else {
        s = s.replace('export default codegenNativeComponent(', 'export default (codegenNativeComponent(');
      }
      s = s.replace(') as HostComponent;', '): HostComponent);');
      return out();
    }
    return out();
  }

  const needleNat = ') as HostComponent<VirtualViewNativeProps>;';
  const doneNat = '): HostComponent<VirtualViewNativeProps>);';
  if (s.includes(needleNat) && !s.includes(doneNat)) {
    if (s.includes('export default codegenNativeComponent<VirtualViewNativeProps>(')) {
      s = s
        .replace(
          'export default codegenNativeComponent<VirtualViewNativeProps>(',
          'export default (codegenNativeComponent<VirtualViewNativeProps>('
        )
        .replace(needleNat, doneNat);
      return out();
    }
    const oldBlock = `export default codegenNativeComponent<VirtualViewNativeProps>('VirtualView', {
  interfaceOnly: true,
}) as HostComponent<VirtualViewNativeProps>;`;
    const newBlock = `export default (codegenNativeComponent<VirtualViewNativeProps>(
  'VirtualView',
  {
    interfaceOnly: true,
  },
): HostComponent<VirtualViewNativeProps>);`;
    if (s.includes(oldBlock)) s = s.replace(oldBlock, newBlock);
    if (s.includes(doneNat)) return out();
  }

  const donePlainNat = '): HostComponent);';
  if (
    s.includes(') as HostComponent;') &&
    !s.includes(donePlainNat) &&
    s.includes("'VirtualView'") &&
    s.includes('interfaceOnly')
  ) {
    if (s.includes('export default codegenNativeComponent (')) {
      s = s.replace('export default codegenNativeComponent (', 'export default (codegenNativeComponent (');
    } else {
      s = s.replace('export default codegenNativeComponent(', 'export default (codegenNativeComponent(');
    }
    s = s.replace(') as HostComponent;', '): HostComponent);');
    return out();
  }

  return out();
}

function patchVirtualViewFile(fp) {
  let s = fs.readFileSync(fp, 'utf8');
  const base = path.basename(fp);
  const propsName = base.includes('Experimental')
    ? 'VirtualViewExperimentalNativeProps'
    : 'VirtualViewNativeProps';

  const before = s;
  s = stripOnModeChangeFromProps(s);
  s = patchHostComponentWrap(s, propsName);

  if (s !== before) {
    fs.writeFileSync(fp, s, 'utf8');
    console.info('[patches] VirtualView ←', fp);
  } else if (
    /onModeChange\?\: \?DirectEventHandler/.test(s) &&
    !s.includes('ARBOR_NO_ONMODE')
  ) {
    console.warn('[patches] VirtualView — typ nadal zawiera onModeChange; dopasuj strip/regex:', fp);
  }
}

function patchVirtualViewAll() {
  const roots = uniqueReactNativeRoots();
  if (roots.length === 0) {
    console.warn('[patches] Brak node_modules/react-native (npm install?) — pomijam VirtualView.');
    return;
  }
  const names = ['VirtualViewExperimentalNativeComponent.js', 'VirtualViewNativeComponent.js'];
  for (const rn of roots) {
    for (const name of names) {
      const fp = path.join(rn, 'src', 'private', 'components', 'virtualview', name);
      if (fs.existsSync(fp)) patchVirtualViewFile(fp);
    }
  }
}

patchExpoRouterAll();
patchVirtualViewAll();
console.info('[patches] Gotowe.');
