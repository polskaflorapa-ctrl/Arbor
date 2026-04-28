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
  ensure('oddzialCeleMiesieczne', () => [...(seed.oddzialCeleMiesieczne || [])]);
  ensure('nextOddzialCeleMiesieczneId', seed.nextOddzialCeleMiesieczneId || 1);
  ensure('oddzialSprzedazMiesieczna', () => [...(seed.oddzialSprzedazMiesieczna || [])]);
  ensure('nextOddzialSprzedazMiesiecznaId', seed.nextOddzialSprzedazMiesiecznaId || 1);
  ensure('callLogs', () => [...(seed.callLogs || [])]);
  ensure('nextCallLogId', seed.nextCallLogId || 1);
  ensure('callbackTasks', () => [...(seed.callbackTasks || [])]);
  ensure('nextCallbackTaskId', seed.nextCallbackTaskId || 1);
  ensure('crmLeads', () => [...(seed.crmLeads || [])]);
  ensure('nextCrmLeadId', seed.nextCrmLeadId || 1);
  ensure('crmLeadActivities', () => [...(seed.crmLeadActivities || [])]);
  ensure('nextCrmLeadActivityId', seed.nextCrmLeadActivityId || 1);
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
  ensure('cmrLists', () => []);
  ensure('nextCmrId', 1);
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
  if (Array.isArray(state.zlecenia)) {
    for (const z of state.zlecenia) {
      if (z.dodatkowe_uslugi_liczba === undefined || z.dodatkowe_uslugi_liczba === null) {
        z.dodatkowe_uslugi_liczba = 0;
        changed = true;
      }
      if (z.bony_liczba === undefined || z.bony_liczba === null) {
        z.bony_liczba = 0;
        changed = true;
      }
    }
  }
  if (Array.isArray(state.zlecenia)) {
    for (const z of state.zlecenia) {
      for (const k of ['kommo_last_sync_at', 'kommo_last_sync_status', 'kommo_last_sync_http', 'kommo_last_sync_error']) {
        if (z[k] === undefined) {
          z[k] = null;
          changed = true;
        }
      }
    }
  }
  if (Array.isArray(state.klienci)) {
    for (const kl of state.klienci) {
      for (const k of ['kommo_last_sync_at', 'kommo_last_sync_status', 'kommo_last_sync_http', 'kommo_last_sync_error']) {
        if (kl[k] === undefined) {
          kl[k] = null;
          changed = true;
        }
      }
    }
  }
  if (Array.isArray(state.cmrLists)) {
    for (const c of state.cmrLists) {
      if (c.kommo_last_sync_at === undefined) {
        c.kommo_last_sync_at = null;
        changed = true;
      }
      if (c.kommo_last_sync_status === undefined) {
        c.kommo_last_sync_status = null;
        changed = true;
      }
      if (c.kommo_last_sync_http === undefined) {
        c.kommo_last_sync_http = null;
        changed = true;
      }
      if (c.kommo_last_sync_error === undefined) {
        c.kommo_last_sync_error = null;
        changed = true;
      }
      if (c.oddzial_id != null) {
        c.oddzial_id = null;
        changed = true;
      }
    }
  }
  if (changed) saveState(state);
  return state;
}

module.exports = { migrateState };
