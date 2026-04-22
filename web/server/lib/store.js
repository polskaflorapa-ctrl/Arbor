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

function loadState() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(STATE_PATH)) {
    const seed = readJson(SEED_PATH);
    fs.writeFileSync(STATE_PATH, JSON.stringify(seed, null, 2), 'utf8');
  }
  const state = readJson(STATE_PATH);
  return migrateState(state, saveState);
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
