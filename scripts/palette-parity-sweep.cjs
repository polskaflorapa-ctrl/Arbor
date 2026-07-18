#!/usr/bin/env node
/**
 * Sweep parytetu palety: zamienia obce hexy (Tailwind/Monday itp.) na paletę
 * prototypów Polska Flora (platform/public/prototypes) wg odcienia i jasności.
 * Użycie: node scripts/palette-parity-sweep.cjs [--write] [katalogi...]
 * Bez --write: raport (dry run).
 */
const fs = require('node:fs');
const path = require('node:path');

// Paleta prototypów (kanoniczna) — te hexy zostają nietknięte.
const CANON = new Set([
  '2c2011', '3b2a18', '2a1d0f', '23260a', 'a0af14', 'b4c232', '7f8c12', 'bd701e',
  '5a5040', '8a8069', '9a907a', '766440', 'f0ebdd', 'e0d9c8', 'ece6d7', 'e6ddc9',
  'faf8f1', 'fffdf8', 'efeadd', 'efe9da', 'f1f3d6', 'e4efd6', 'fae7d2', 'f6e0d9',
  '5d6a0b', '456b1f', '995510', 'a3402a', 'c0492f', 'ffffff', '000000',
]);

function hexToHsl(hex) {
  const n = parseInt(hex, 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l, c: 0 };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  else if (max === g) h = ((b - r) / d + 2) * 60;
  else h = ((r - g) / d + 4) * 60;
  return { h, s, l, c: d };
}

// Mapowanie: rodzina barw → skala prototypu (od najciemniejszego).
function mapToCanon(hex) {
  const { h, s, l, c } = hexToHsl(hex);
  // Neutralne: mała chroma bezwzględna (slate-900 ma wysokie s, ale wygląda
  // grafitowo) LUB chłodne szarości (niebieskawe, nisko nasycone).
  if (c < 0.09 || s < 0.16 || (h >= 180 && h < 300 && s < 0.35)) {
    if (l < 0.25) return '2c2011';
    if (l < 0.45) return '5a5040';
    if (l < 0.62) return '8a8069';
    if (l < 0.78) return '9a907a';
    if (l < 0.90) return 'e0d9c8';
    return 'f0ebdd';
  }
  // Czerwienie/róże (h 330-25)
  if (h >= 330 || h < 25) {
    if (l < 0.45) return 'a3402a';
    if (l < 0.72) return 'c0492f';
    return 'f6e0d9';
  }
  // Pomarańcze/ambery (25-55)
  if (h < 55) {
    if (l < 0.42) return '995510';
    if (l < 0.62) return 'bd701e';
    return 'fae7d2';
  }
  // Żółcie/limonki (55-90): akcent marki
  if (h < 90) {
    if (l < 0.35) return '5d6a0b';
    if (l < 0.60) return 'a0af14';
    return 'f1f3d6';
  }
  // Zielenie (90-170)
  if (h < 170) {
    if (l < 0.35) return '456b1f';
    if (l < 0.62) return '7f8c12';
    return 'e4efd6';
  }
  // Cyjan/błękity/fiolety (170-330): prototyp nie ma niebieskiego —
  // informacyjne stany = ciemna limonka / brązy.
  if (l < 0.35) return '5d6a0b';
  if (l < 0.62) return '766440';
  return 'f1f3d6';
}

const write = process.argv.includes('--write');
const dirs = process.argv.slice(2).filter((a) => a !== '--write');
if (dirs.length === 0) dirs.push('web/src/pages', 'web/src/components');

const files = [];
for (const dir of dirs) {
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    for (const entry of fs.readdirSync(cur, { withFileTypes: true })) {
      const p = path.join(cur, entry.name);
      if (entry.isDirectory()) stack.push(p);
      else if (/\.(js|jsx|ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name)) files.push(p);
    }
  }
}

const report = new Map();
let changedFiles = 0;
for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  let changed = false;
  const out = src.replace(/#([0-9a-fA-F]{6})\b/g, (m, hex) => {
    const low = hex.toLowerCase();
    if (CANON.has(low)) return m;
    const to = mapToCanon(low);
    report.set(low, { to, count: (report.get(low)?.count ?? 0) + 1 });
    changed = true;
    return '#' + to;
  });
  if (changed && write) { fs.writeFileSync(file, out); changedFiles++; }
}

const rows = [...report.entries()].sort((a, b) => b[1].count - a[1].count);
console.log(`${write ? 'ZAPISANO' : 'DRY RUN'} — plików do zmiany: ${write ? changedFiles : new Set(rows.length && files).size || '?'}, unikalnych obcych hexów: ${rows.length}`);
for (const [hex, { to, count }] of rows.slice(0, 25)) console.log(`  #${hex} → #${to}  (${count}×)`);
