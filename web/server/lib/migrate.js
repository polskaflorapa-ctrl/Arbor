const fs = require('fs');
const path = require('path');

const SEED_PATH = path.join(__dirname, '..', 'data', 'seed.json');

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function migrateState(state, saveState) {
  const seed = readJson(SEED_PATH);
  let changed = false;
  const ensure = (key, val) => {
    if (state[key] === undefined || state[key] === null) {
      state[key] = typeof val === 'function' ? val() : val;
      changed = true;
    }
  };
  ensure('oddzialy', () => [...seed.oddzialy]);
  ensure('klienci', () => [...seed.klienci]);
  ensure('nextKlientId', seed.nextKlientId || 10);
  ensure('ogledziny', () => []);
  ensure('zalaczniki', () => []);
  ensure('nextOgledzinyId', 1);
  ensure('teams', () => [...(seed.teams || [])]);
  ensure('users', () => [...(seed.users || [])]);
  ensure('zlecenia', () => [...(seed.zlecenia || [])]);
  ensure('notifications', () => []);
  ensure('nextNotificationId', 1);
  ensure('delegacje', () => []);
  ensure('nextDelegacjaId', 1);
  ensure('roles', () => [...(seed.roles || [])]);
  ensure('nextRoleId', seed.nextRoleId || 100);
  ensure('nextUserId', seed.nextUserId || 100);
  ensure('kompetencje', () => []);
  ensure('nextKompetencjaId', 1);
  ensure('ekipaCzlonkowie', () => [...(seed.ekipaCzlonkowie || [])]);
  ensure('nextEkipaCzlonekId', seed.nextEkipaCzlonekId || 1);
  ensure('flotaPojazdy', () => [...(seed.flotaPojazdy || [])]);
  ensure('flotaSprzet', () => [...(seed.flotaSprzet || [])]);
  ensure('flotaNaprawy', () => [...(seed.flotaNaprawy || [])]);
  ensure('nextFlotaPojazdId', seed.nextFlotaPojazdId || 1);
  ensure('nextFlotaSprzetId', seed.nextFlotaSprzetId || 1);
  ensure('nextFlotaNaprawaId', seed.nextFlotaNaprawaId || 1);
  ensure('faktury', () => []);
  ensure('nextFakturaId', 1);
  ensure('nextFakturaNumer', seed.nextFakturaNumer || 1);
  ensure('ksiegowoscUstawienia', () => ({ ...(seed.ksiegowoscUstawienia || {}) }));
  ensure('taskLogs', () => ({}));
  ensure('taskProblemy', () => ({}));
  ensure('taskZdjecia', () => ({}));
  ensure('nextTaskLogId', 1);
  ensure('nextTaskProblemId', 1);
  ensure('nextTaskZdjecieId', 1);
  ensure('dniowki', () => []);
  if (state.nextZlecenieId == null) {
    state.nextZlecenieId = seed.nextZlecenieId;
    changed = true;
  }
  if (changed) saveState(state);
  return state;
}

module.exports = { migrateState };
