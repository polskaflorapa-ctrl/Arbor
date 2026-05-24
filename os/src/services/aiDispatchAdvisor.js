const CLOSED_STATUSES = new Set(['Zakonczone', 'Anulowane']);
const TEAM_REQUIRED_STATUSES = new Set(['Do_Zatwierdzenia', 'Zaplanowane', 'W_Realizacji']);
const EVIDENCE_REQUIRED_STATUSES = new Set(['Wycena_Terenowa', 'Do_Zatwierdzenia', 'Zaplanowane', 'W_Realizacji']);

const toNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const hasText = (value) => String(value || '').trim().length > 0;
const isoDay = (value) => (value ? String(value).slice(0, 10) : '');

const hasAnyText = (row, keys) => keys.some((key) => hasText(row?.[key]));
const hasAnyPositiveNumber = (row, keys) => keys.some((key) => toNumber(row?.[key]) > 0);

const pushIssue = (issues, issue) => {
  issues.push({
    severity: issue.severity || 'warning',
    key: issue.key,
    label: issue.label,
    detail: issue.detail,
    action: issue.action,
    field: issue.field || null,
  });
};

function analyzeTaskQuality(task = {}, options = {}) {
  const today = options.today || new Date().toISOString().slice(0, 10);
  const status = String(task.status || '');
  const plannedDay = isoDay(task.data_planowana || task.data_wykonania);
  const issues = [];
  const value = toNumber(task.wartosc_planowana) || toNumber(task.budzet);
  const hours = toNumber(task.czas_planowany_godziny) || toNumber(task.czas_realizacji_godz) || (toNumber(task.czas_obslugi_min) / 60);
  const needsEquipment = Boolean(
    task.rebak ||
    task.pila_wysiegniku ||
    task.nozyce_dlugie ||
    task.kosiarka ||
    task.podkaszarka ||
    task.lopata ||
    task.mulczer ||
    task.arborysta ||
    hasText(task.wymagany_sprzet_typ)
  );

  if (!hasText(task.klient_nazwa)) {
    pushIssue(issues, {
      severity: 'critical',
      key: 'client_name',
      label: 'Brak klienta',
      detail: 'Zlecenie nie ma nazwy klienta.',
      action: 'Uzupelnij klienta przed planowaniem.',
      field: 'klient_nazwa',
    });
  }
  if (!hasText(task.klient_telefon)) {
    pushIssue(issues, {
      severity: 'critical',
      key: 'client_phone',
      label: 'Brak telefonu',
      detail: 'Ekipa i biuro nie maja szybkiego kontaktu do klienta.',
      action: 'Dodaj numer telefonu klienta.',
      field: 'klient_telefon',
    });
  }
  if (!hasText(task.adres) || !hasText(task.miasto)) {
    pushIssue(issues, {
      severity: 'critical',
      key: 'address',
      label: 'Niepelny adres',
      detail: 'Adres albo miasto jest puste.',
      action: 'Uzupelnij adres wykonania.',
      field: !hasText(task.adres) ? 'adres' : 'miasto',
    });
  }
  if (!plannedDay) {
    pushIssue(issues, {
      severity: 'critical',
      key: 'date',
      label: 'Brak terminu',
      detail: 'Zlecenie nie wejdzie poprawnie do planu dnia.',
      action: 'Ustaw date i godzine planowana.',
      field: 'data_planowana',
    });
  } else if (plannedDay < today && !CLOSED_STATUSES.has(status)) {
    pushIssue(issues, {
      severity: 'critical',
      key: 'overdue',
      label: 'Po terminie',
      detail: `Termin ${plannedDay} jest w przeszlosci.`,
      action: 'Przeplanuj termin albo zamknij status.',
      field: 'data_planowana',
    });
  }
  if (!hasAnyText(task, ['opis_pracy', 'opis', 'wynik', 'notatki_wewnetrzne', 'typ_uslugi'])) {
    pushIssue(issues, {
      severity: 'critical',
      key: 'scope',
      label: 'Brak zakresu',
      detail: 'Nie ma opisu prac wystarczajacego dla ekipy.',
      action: 'Dopisz zakres, ryzyka i oczekiwany efekt.',
      field: 'opis_pracy',
    });
  }
  if (!hasAnyPositiveNumber(task, ['wartosc_planowana', 'budzet'])) {
    pushIssue(issues, {
      severity: 'critical',
      key: 'price',
      label: 'Brak ceny',
      detail: 'Zlecenie nie ma budzetu ani wartosci planowanej.',
      action: 'Uzupelnij cene przed wyslaniem do realizacji.',
      field: 'wartosc_planowana',
    });
  }
  if (!hasAnyPositiveNumber(task, ['czas_planowany_godziny', 'czas_realizacji_godz', 'czas_obslugi_min'])) {
    pushIssue(issues, {
      severity: 'critical',
      key: 'duration',
      label: 'Brak czasu',
      detail: 'Solver i kierownik nie znaja czasu obslugi.',
      action: 'Dodaj planowany czas pracy.',
      field: 'czas_planowany_godziny',
    });
  }
  if (TEAM_REQUIRED_STATUSES.has(status) && !(task.ekipa_id || task.ekipa_nazwa)) {
    pushIssue(issues, {
      severity: 'critical',
      key: 'team',
      label: 'Brak ekipy',
      detail: 'Status wymaga wlasciciela wykonania.',
      action: 'Przypisz ekipe albo cofnij status.',
      field: 'ekipa_id',
    });
  }
  if (EVIDENCE_REQUIRED_STATUSES.has(status) && toNumber(task.photo_total) === 0) {
    pushIssue(issues, {
      severity: 'warning',
      key: 'photos',
      label: 'Brak zdjec',
      detail: 'Dokumentacja terenowa nie potwierdza zakresu.',
      action: 'Dodaj zdjecie ogolne, dojazd albo szkic.',
      field: 'photo_total',
    });
  }
  if (needsEquipment && toNumber(task.equipment_reserved_count) === 0) {
    pushIssue(issues, {
      severity: 'warning',
      key: 'equipment',
      label: 'Sprzet bez rezerwacji',
      detail: 'Zakres sugeruje sprzet, ale nie widac rezerwacji.',
      action: 'Zarezerwuj sprzet lub zmien wymagania.',
      field: 'equipment_reserved_count',
    });
  }
  if ((task.pin_lat == null || task.pin_lng == null) && hasText(task.adres)) {
    pushIssue(issues, {
      severity: 'warning',
      key: 'gps',
      label: 'Brak pinezki GPS',
      detail: 'Trasa bedzie mniej dokladna.',
      action: 'Dodaj pinezke lokalizacji.',
      field: 'pin_lat',
    });
  }
  if (value > 0 && hours > 0 && value / hours < 180) {
    pushIssue(issues, {
      severity: 'warning',
      key: 'margin',
      label: 'Niska stawka godzinowa',
      detail: `${Math.round(value / hours)} PLN/h przy planowanym czasie.`,
      action: 'Sprawdz cene, czas albo zakres.',
      field: 'wartosc_planowana',
    });
  }

  const criticalCount = issues.filter((issue) => issue.severity === 'critical').length;
  const warningCount = issues.filter((issue) => issue.severity === 'warning').length;
  const infoCount = issues.filter((issue) => issue.severity === 'info').length;
  const qualityScore = Math.max(0, Math.min(100, 100 - criticalCount * 18 - warningCount * 8 - infoCount * 3));

  return {
    task_id: task.id,
    task_numer: task.numer || `#${task.id}`,
    client: task.klient_nazwa || null,
    status,
    planned_day: plannedDay || null,
    value,
    quality_score: qualityScore,
    blocker_count: criticalCount,
    warning_count: warningCount,
    ready_for_dispatch: criticalCount === 0,
    issues,
  };
}

const severityRank = (item) => item.blocker_count * 100 + item.warning_count * 20 + (100 - item.quality_score);

function buildDispatchAdvisor({ tasks = [], teamsCount = 0, date, today } = {}) {
  const taskQuality = tasks.map((task) => analyzeTaskQuality(task, { today }));
  const blockers = taskQuality.filter((item) => item.blocker_count > 0);
  const warnings = taskQuality.filter((item) => item.blocker_count === 0 && item.warning_count > 0);
  const ready = taskQuality.filter((item) => item.ready_for_dispatch);
  const overdue = taskQuality.filter((item) => item.issues.some((issue) => issue.key === 'overdue'));
  const unassigned = taskQuality.filter((item) => item.issues.some((issue) => issue.key === 'team'));
  const missingGps = taskQuality.filter((item) => item.issues.some((issue) => issue.key === 'gps'));
  const lowMargin = taskQuality.filter((item) => item.issues.some((issue) => issue.key === 'margin'));
  const totalValue = taskQuality.reduce((sum, item) => sum + item.value, 0);
  const avgQuality = taskQuality.length
    ? Math.round(taskQuality.reduce((sum, item) => sum + item.quality_score, 0) / taskQuality.length)
    : 100;

  const recommendations = [];
  if (blockers.length) {
    recommendations.push({
      priority: 'high',
      title: `Napraw ${blockers.length} zlecen przed solverem`,
      rationale: 'Zlecenia z brakami krytycznymi moga dac zly plan albo utknac w realizacji.',
      suggested_action: 'Otworz liste ryzyk i uzupelnij pierwszy brak krytyczny w kazdym zleceniu.',
      risk: 'high',
    });
  }
  if (overdue.length) {
    recommendations.push({
      priority: 'high',
      title: `Przeplanuj ${overdue.length} pozycji po terminie`,
      rationale: 'Przeterminowane zadania znieksztalcaja kolejke dyspozytora.',
      suggested_action: 'Ustaw nowy termin albo zamknij status, jesli praca jest zakonczona.',
      risk: 'high',
    });
  }
  if (unassigned.length) {
    recommendations.push({
      priority: 'medium',
      title: `Przypisz ekipy do ${unassigned.length} zlecen`,
      rationale: 'Status wymaga wlasciciela, ale zlecenie nie ma ekipy.',
      suggested_action: 'Uruchom solver lub przypisz ekipe recznie do zlecen o najwyzszej wartosci.',
      risk: 'medium',
    });
  }
  if (missingGps.length) {
    recommendations.push({
      priority: 'medium',
      title: `Dodaj pinezki GPS do ${missingGps.length} adresow`,
      rationale: 'Bez wspolrzednych solver bazuje na przyblizeniach.',
      suggested_action: 'Uzupelnij pin_lat i pin_lng dla zlecen z adresem.',
      risk: 'medium',
    });
  }
  if (lowMargin.length) {
    recommendations.push({
      priority: 'medium',
      title: `Zweryfikuj marze w ${lowMargin.length} zleceniach`,
      rationale: 'Planowana wartosc na godzine jest niska wzgledem czasu.',
      suggested_action: 'Porownaj czas, zakres i cene przed zatwierdzeniem planu.',
      risk: 'medium',
    });
  }
  if (!recommendations.length) {
    recommendations.push({
      priority: 'low',
      title: 'Plan wyglada gotowo',
      rationale: 'Nie widac krytycznych brakow w danych dla dyspozytora.',
      suggested_action: 'Uruchom podglad planu i sprawdz ograniczenia tras.',
      risk: 'low',
    });
  }

  return {
    source: 'rules',
    date,
    metrics: {
      tasks_total: taskQuality.length,
      ready_for_dispatch: ready.length,
      blocked: blockers.length,
      warnings: warnings.length,
      overdue: overdue.length,
      unassigned: unassigned.length,
      missing_gps: missingGps.length,
      low_margin: lowMargin.length,
      teams_available: teamsCount,
      total_value: totalValue,
      avg_quality: avgQuality,
    },
    recommendations: recommendations.slice(0, 5),
    top_tasks: taskQuality
      .slice()
      .sort((a, b) => severityRank(b) - severityRank(a) || b.value - a.value)
      .slice(0, 8),
  };
}

module.exports = {
  analyzeTaskQuality,
  buildDispatchAdvisor,
};
