/** Wspólna widoczność CMR (file-db) — spójnie z widocznością zleceń. */

function canSeeAll(user) {
  return user?.rola === 'Administrator' || user?.rola === 'Dyrektor';
}

function visibleZlecenia(state, user) {
  const rows = state.zlecenia || [];
  if (canSeeAll(user)) return rows;
  if (user.rola === 'Kierownik') return rows.filter((z) => String(z.oddzial_id) === String(user.oddzial_id));
  if (['Brygadzista', 'Pomocnik', 'Pomocnik bez doświadczenia'].includes(user.rola) && user.ekipa_id) {
    return rows.filter((z) => String(z.ekipa_id) === String(user.ekipa_id));
  }
  if (user.oddzial_id != null) return rows.filter((z) => String(z.oddzial_id) === String(user.oddzial_id));
  return rows;
}

function canUserViewZlecenie(state, user, taskId) {
  const z = (state.zlecenia || []).find((x) => x.id === taskId);
  if (!z) return false;
  if (canSeeAll(user)) return true;
  return visibleZlecenia(state, user).some((x) => x.id === taskId);
}

function canViewCmr(state, user, row) {
  if (canSeeAll(user)) return true;
  if (row.task_id && canUserViewZlecenie(state, user, row.task_id)) return true;
  if (!row.task_id && row.created_by != null && String(row.created_by) === String(user.id)) return true;
  return false;
}

function enrichCmr(state, row) {
  const z = row.task_id ? (state.zlecenia || []).find((x) => x.id === row.task_id) : null;
  const p = row.vehicle_id ? (state.flotaPojazdy || []).find((x) => x.id === row.vehicle_id) : null;
  return {
    ...row,
    task_klient_nazwa: z ? z.klient_nazwa || [z.klient_imie, z.klient_nazwisko].filter(Boolean).join(' ') : null,
    /** Oddział z karty zlecenia — do integracji (Kommo), nie pole „oddział CMR”. */
    task_oddzial_id: z && z.oddzial_id != null ? z.oddzial_id : null,
    pojazd_nr_rejestracyjny: p ? p.nr_rejestracyjny : null,
  };
}

module.exports = { canViewCmr, enrichCmr, canUserViewZlecenie };
