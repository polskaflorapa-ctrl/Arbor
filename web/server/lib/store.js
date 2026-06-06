const fs = require('fs');
const path = require('path');
const { migrateState } = require('./migrate');

const DATA_DIR = path.join(__dirname, '..', 'data');
const STATE_PATH = path.join(DATA_DIR, 'state.json');
const SEED_PATH = path.join(DATA_DIR, 'seed.json');

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function saveState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
}

const MOJIBAKE_REPLACEMENTS = [
  ['KrakÄw', 'Kraków'],
  ['KrakĂłw', 'Kraków'],
  ['Ä…', 'ą'],
  ['Ä‡', 'ć'],
  ['Ä™', 'ę'],
  ['Ĺ‚', 'ł'],
  ['Ĺ„', 'ń'],
  ['Ăł', 'ó'],
  ['Ĺ›', 'ś'],
  ['Ĺş', 'ź'],
  ['ĹĽ', 'ż'],
  ['Ä„', 'Ą'],
  ['Ä†', 'Ć'],
  ['Ä', 'Ę'],
  ['Ĺ', 'Ł'],
  ['Ă“', 'Ó'],
  ['Ĺš', 'Ś'],
  ['Ĺą', 'Ź'],
  ['Ĺ»', 'Ż'],
  ['Â·', '·'],
  ['Â', ''],
  ['â€”', '—'],
  ['â€“', '–'],
  ['â€¦', '...'],
  ['â€‘', '-'],
];

function normalizeMojibakeText(value) {
  if (typeof value !== 'string') return value;
  return MOJIBAKE_REPLACEMENTS.reduce(
    (text, [broken, fixed]) => text.replaceAll(broken, fixed),
    value,
  );
}

function normalizeRuntimeEncoding(value) {
  if (Array.isArray(value)) return value.map(normalizeRuntimeEncoding);
  if (!value || typeof value !== 'object') return normalizeMojibakeText(value);
  for (const key of Object.keys(value)) {
    value[key] = normalizeRuntimeEncoding(value[key]);
  }
  return value;
}

function loadState() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(STATE_PATH)) {
    const seed = readJson(SEED_PATH);
    fs.writeFileSync(STATE_PATH, JSON.stringify(seed, null, 2), 'utf8');
  }
  const state = readJson(STATE_PATH);
  const beforeNormalize = JSON.stringify(state);
  normalizeRuntimeEncoding(state);
  const migrated = migrateState(state, saveState);
  if (JSON.stringify(migrated) !== beforeNormalize) saveState(migrated);
  return migrated;
}

function withStore(fn) {
  const state = loadState();
  const out = fn(state);
  saveState(state);
  return out;
}

function readOnly(fn) {
  const state = loadState();
  return fn(state);
}

module.exports = { loadState, saveState, withStore, readOnly, STATE_PATH, DATA_DIR };
