import Sidebar from '../components/Sidebar';
import StatusMessage from '../components/StatusMessage';
import { summarizeTaskReadiness } from '../utils/taskReadiness';

function formatMoney(value) {
  return `${Number(value || 0).toLocaleString('pl-PL', { maximumFractionDigits: 0 })} zł`;
}

function statusText(value) {
  return String(value || 'Nowe').replace(/_/g, ' ');
}

function barPercent(value, total) {
  if (!total) return 0;
  return Math.max(8, Math.min(100, Math.round((Number(value) / Number(total)) * 100)));
}

function isMissingPhone(task) {
  const phone = String(task?.klient_telefon || task?.telefon || task?.phone || '').replace(/\D/g, '');
  return phone.length < 7;
}

function needsQuote(task) {
  const status = String(task?.status || '').toLowerCase();
  const quoteStatus = String(task?.wycena_status || task?.oferta_status || '').toLowerCase();
  return (
    status.includes('wycen') ||
    status.includes('ofert') ||
    quoteStatus.includes('draft') ||
    quoteStatus.includes('robocz') ||
    quoteStatus.includes('do_wyslania') ||
    quoteStatus.includes('do wyslania') ||
    (!Number(task?.wartosc_planowana) && !Number(task?.wartosc_finalna) && !Number(task?.wartosc))
  );
}

function isWaitingForAcceptance(task) {
  const status = [
    task?.status,
    task?.wycena_status,
    task?.oferta_status,
    task?.status_akceptacji,
  ].filter(Boolean).join(' ').toLowerCase();
  return (
    status.includes('oczek') ||
    status.includes('akcept') ||
    status.includes('wyslan') ||
    status.includes('wysłan')
  );
}

function isDoneWithoutSettlement(task) {
  const status = String(task?.status || '').toLowerCase();
  const isDone = status.includes('zakoncz') || status.includes('zakończ') || status.includes('wykon');
  if (!isDone) return false;
  if (task?.rozliczone === true || task?.settled === true) return false;
  return !Number(task?.wartosc_rzeczywista) && !Number(task?.wartosc_netto_do_rozliczenia);
}

export default function DashboardPolskaFlora({
  user,
  error,
  dzisiaj,
  monthLabel,
  branchLabel,
  allTasks,
  openTasks,
  activeTasks,
  todayTasks,
  unassignedTasks,
  overdueTasks,
  completedMonth,
  monthTasks,
  monthRevenue,
  sumaWartosci,
  allCrewNames,
  activeCrewNames,
  ostatnie,
  scheduleItems,
  operationalMetrics,
  navigate,
}) {
  const activeCount = openTasks.length;
  const totalCount = Math.max(allTasks.length, activeCount);
  const avgMargin = monthRevenue ? Math.round(Math.min(34, Math.max(12, (completedMonth / Math.max(monthTasks.length, 1)) * 28 + 8))) : 0;
  const missingPhoneTasks = openTasks.filter(isMissingPhone);
  const quoteTasks = openTasks.filter(needsQuote);
  const readiness = summarizeTaskReadiness(openTasks);
  const topBlockedTasks = readiness.blockedTasks
    .slice()
    .sort((a, b) => a.readiness.score - b.readiness.score)
    .slice(0, 4);
  const missingPriceTasks = allTasks.filter(needsQuote);
  const acceptanceTasks = allTasks.filter(isWaitingForAcceptance);
  const settlementTasks = allTasks.filter(isDoneWithoutSettlement);
  const moneyBlockers = [
    {
      label: 'Brak ceny',
      value: missingPriceTasks.length,
      detail: 'wycena lub oferta bez kwoty',
      path: '/wycena-kalendarz',
      tasks: missingPriceTasks,
    },
    {
      label: 'Oferty do akceptacji',
      value: acceptanceTasks.length,
      detail: 'klient musi dostać follow-up',
      path: '/crm',
      tasks: acceptanceTasks,
    },
    {
      label: 'Wykonane bez rozliczenia',
      value: settlementTasks.length,
      detail: 'praca zamknięta, pieniądze nie',
      path: '/ksiegowosc',
      tasks: settlementTasks,
    },
  ];
  const moneyRows = moneyBlockers.flatMap((blocker) => blocker.tasks.slice(0, 2).map((task) => ({ ...task, blocker: blocker.label }))).slice(0, 5);

  const todayActionRows = [
    {
      label: 'Telefon / CRM',
      value: missingPhoneTasks.length,
      title: 'Brak telefonu u klienta',
      detail: missingPhoneTasks.length ? 'uzupełnij kontakt przed planowaniem' : 'kontakty są kompletne',
      path: '/zlecenia?focus=telefon',
      tone: missingPhoneTasks.length ? 'warning' : 'good',
    },
    {
      label: 'Termin / SLA',
      value: overdueTasks.length,
      title: 'Po terminie',
      detail: overdueTasks.length ? 'wymaga decyzji i nowego terminu' : 'bez zaległych terminów',
      path: '/zlecenia',
      tone: overdueTasks.length ? 'danger' : 'good',
    },
    {
      label: 'Ekipy',
      value: unassignedTasks.length,
      title: 'Zlecenia bez ekipy',
      detail: unassignedTasks.length ? 'przypisz brygadę lub zmień plan' : 'obsada jest domknięta',
      path: '/kierownik',
      tone: unassignedTasks.length ? 'warning' : 'good',
    },
    {
      label: 'Wycena / oferta',
      value: quoteTasks.length,
      title: 'Do wyceny lub wysłania oferty',
      detail: quoteTasks.length ? 'domknij cenę, PDF albo akceptację' : 'brak pilnych ofert',
      path: '/wycena-kalendarz',
      tone: quoteTasks.length ? 'info' : 'good',
    },
  ];

  const kpis = [
    { label: 'Aktywne zlecenia', value: activeCount, hint: `${overdueTasks.length} po terminie`, tone: 'blue' },
    { label: 'Przychód planowany', value: formatMoney(monthRevenue || sumaWartosci), hint: monthLabel, tone: 'green' },
    { label: 'Średnia marża', value: `${avgMargin}%`, hint: 'szacunek operacyjny', tone: 'violet' },
    { label: 'Ekipy w terenie', value: activeCrewNames.size, hint: `${allCrewNames.size || activeCrewNames.size} ekip w systemie`, tone: 'amber' },
    { label: 'Bez ekipy', value: unassignedTasks.length, hint: 'do przypisania', tone: 'cyan' },
    { label: 'Ryzyka', value: overdueTasks.length + unassignedTasks.length, hint: 'termin + obsada', tone: 'red' },
  ];
  const flowSteps = [
    { label: 'Telefon / Ania', hint: 'rozmowa i intake', path: '/telefonia' },
    { label: 'CRM', hint: 'lead i follow-up', path: '/crm' },
    { label: 'Oględziny', hint: 'bezpłatny termin', path: '/zlecenia?focus=telefon' },
    { label: 'Wycena', hint: 'kalendarz specjalisty', path: '/wycena-kalendarz' },
    { label: 'Ekipa', hint: 'plan i obsada', path: '/harmonogram' },
  ];

  const statusRows = [
    { label: 'Otwarte', value: openTasks.length, color: '#3b82f6' },
    { label: 'W realizacji', value: activeTasks.length, color: '#8b5cf6' },
    { label: 'Dzisiaj', value: todayTasks.length, color: '#f59e0b' },
    { label: 'Zakończone', value: completedMonth, color: '#10b981' },
  ];
  const statusTotal = statusRows.reduce((sum, row) => sum + row.value, 0);

  return (
    <div className="pf-shell" style={s.shell}>
      <Sidebar />
      <main className="pf-main" style={s.main}>
        <StatusMessage message={error || ''} tone={error ? 'error' : undefined} style={error ? s.error : { display: 'none' }} />

        <header className="pf-command-header" style={s.header}>
          <div style={s.headerCopy}>
            <span className="pf-brand-lockup" style={s.brandLockup}>
              <img src="/brand/polska-flora-logo.svg" alt="" style={s.brandLogo} />
              <span style={s.brandText}>
                <strong>Polska Flora</strong>
                <small>Nature integrator</small>
              </span>
            </span>
            <span style={s.eyebrow}>Centrum operacyjne</span>
            <h1 style={s.title}>Witaj, {user?.imie || 'Ania'}.</h1>
            <p style={s.subtitle}>Panel główny systemu Polska Flora</p>
          </div>
          <div style={s.headerMeta}>
            <span>{branchLabel}</span>
            <strong>{dzisiaj}</strong>
          </div>
        </header>

        <section className="pf-live-cockpit" style={s.liveCockpit}>
          <div className="pf-radar-pane" style={s.radarPane}>
            <span className="pf-radar-sweep" aria-hidden="true" />
            <span className="pf-radar-ring pf-radar-ring-one" aria-hidden="true" />
            <span className="pf-radar-ring pf-radar-ring-two" aria-hidden="true" />
            <span className="pf-radar-ring pf-radar-ring-three" aria-hidden="true" />
            <div className="pf-radar-core" style={s.radarCore}>
              <span style={s.radarLabel}>Live ops</span>
              <strong style={s.radarValue}>{activeCount}/{totalCount}</strong>
              <small style={s.radarHint}>{branchLabel}</small>
            </div>
            <div className="pf-radar-node pf-radar-node-a" style={{ ...s.radarNode, ...s.radarNodeA }}>
              <span>Załogi</span>
              <strong>{activeCrewNames.size}/{allCrewNames.size || activeCrewNames.size}</strong>
            </div>
            <div className="pf-radar-node pf-radar-node-b" style={{ ...s.radarNode, ...s.radarNodeB }}>
              <span>Ryzyka</span>
              <strong>{overdueTasks.length + unassignedTasks.length}</strong>
            </div>
            <div className="pf-radar-node pf-radar-node-c" style={{ ...s.radarNode, ...s.radarNodeC }}>
              <span>Dzisiaj</span>
              <strong>{todayTasks.length}</strong>
            </div>
            <div className="pf-radar-actions" style={s.radarActions}>
              <button type="button" style={s.primaryAction} onClick={() => navigate('/zlecenia?focus=telefon')}>Przyjmij telefon</button>
              <button type="button" style={s.secondaryAction} onClick={() => navigate('/crm')}>CRM dzisiaj</button>
            </div>
          </div>

          <aside className="pf-decision-pane" style={s.decisionPane}>
            <div style={s.decisionHeader}>
              <span>Decyzje teraz</span>
              <strong>{overdueTasks.length + unassignedTasks.length + todayTasks.length}</strong>
            </div>
            {[
              { label: 'Po terminie', value: overdueTasks.length, hint: 'wymaga decyzji operacyjnej', path: '/zlecenia' },
              { label: 'Bez ekipy', value: unassignedTasks.length, hint: 'blokuje harmonogram', path: '/kierownik' },
              { label: 'Plan dnia', value: todayTasks.length, hint: 'gotowe do kontroli', path: '/harmonogram' },
            ].map((item) => (
              <button key={item.label} type="button" style={s.decisionRow} onClick={() => navigate(item.path)}>
                <span style={s.decisionCopy}>
                  <span>{item.label}</span>
                  <small>{item.hint}</small>
                </span>
                <strong>{item.value}</strong>
              </button>
            ))}
          </aside>

          <div className="pf-kpi-dock" style={s.kpiDock}>
          {kpis.map((kpi) => (
            <button key={kpi.label} type="button" style={s.kpiCard} onClick={() => navigate('/zlecenia')}>
              <span style={{ ...s.kpiIcon, ...s[`kpi_${kpi.tone}`] }} />
              <strong style={s.kpiValue}>{kpi.value}</strong>
              <span style={s.kpiLabel}>{kpi.label}</span>
              <small style={s.kpiHint}>{kpi.hint}</small>
            </button>
          ))}
          </div>
        </section>

        <section className="pf-flow-strip" style={s.flowStrip} aria-label="Domyślna ścieżka Polska Flora">
          {flowSteps.map((step, index) => (
            <button key={step.label} type="button" style={s.flowStep} onClick={() => navigate(step.path)}>
              <span style={s.flowNumber}>{index + 1}</span>
              <span style={s.flowCopy}>
                <strong>{step.label}</strong>
                <small>{step.hint}</small>
              </span>
            </button>
          ))}
        </section>

        <section className="pf-today-command" style={s.todayCommand}>
          <div style={s.panelHeader}>
            <div>
              <h2 style={s.panelTitle}>Dzisiaj do ogarnięcia</h2>
              <span style={s.panelMeta}>telefon, SLA, ekipy i oferty w jednym miejscu</span>
            </div>
            <button type="button" style={s.linkBtn} onClick={() => navigate('/zlecenia')}>Otwórz zlecenia</button>
          </div>
          <div style={s.todayGrid}>
            {todayActionRows.map((item) => (
              <button
                key={item.label}
                type="button"
                style={{ ...s.todayAction, ...s[`today_${item.tone}`] }}
                onClick={() => navigate(item.path)}
              >
                <span style={s.todayLabel}>{item.label}</span>
                <strong style={s.todayValue}>{item.value}</strong>
                <span style={s.todayTitle}>{item.title}</span>
                <small style={s.todayDetail}>{item.detail}</small>
              </button>
            ))}
          </div>
        </section>

        <section className="pf-readiness-panel" style={s.readinessPanel}>
          <div style={s.panelHeader}>
            <div>
              <h2 style={s.panelTitle}>Gotowość zleceń</h2>
              <span style={s.panelMeta}>pakiet klient, zakres, termin, wycena i ekipa</span>
            </div>
            <strong style={s.readinessScore}>{readiness.ready}/{readiness.total || 0}</strong>
          </div>
          <div style={s.readinessTrack}>
            <span style={{ ...s.readinessFill, width: `${barPercent(readiness.ready, readiness.total)}%` }} />
          </div>
          {topBlockedTasks.length ? (
            <div style={s.readinessList}>
              {topBlockedTasks.map((task) => (
                <button key={task.id || task.numer} type="button" style={s.readinessRow} onClick={() => navigate(`/zlecenia/${task.id}`)}>
                  <span style={s.readinessTask}>
                    <strong>{task.klient_nazwa || task.numer || 'Zlecenie'}</strong>
                    <small>Pakiet dla ekipy niegotowy</small>
                  </span>
                  <span style={s.readinessBlockers}>
                    {task.readiness.blockers.slice(0, 6).map((blocker) => (
                      <span key={blocker.key} style={s.readinessPill}>{blocker.label}</span>
                    ))}
                  </span>
                  <strong style={s.readinessPercent}>{task.readiness.score}%</strong>
                </button>
              ))}
            </div>
          ) : (
            <div style={s.readinessEmpty}>Wszystkie aktywne zlecenia mają komplet do przekazania ekipie.</div>
          )}
        </section>

        <section className="pf-money-panel" style={s.moneyPanel}>
          <div style={s.panelHeader}>
            <div>
              <h2 style={s.panelTitle}>Co blokuje pieniądze</h2>
              <span style={s.panelMeta}>wyceny, akceptacje i rozliczenia po wykonaniu</span>
            </div>
            <button type="button" style={s.linkBtn} onClick={() => navigate('/raporty')}>Raport marży</button>
          </div>
          <div className="pf-money-grid" style={s.moneyGrid}>
            {moneyBlockers.map((item) => (
              <button key={item.label} type="button" style={s.moneyCard} onClick={() => navigate(item.path)}>
                <span style={s.moneyLabel}>{item.label}</span>
                <strong style={s.moneyValue}>{item.value}</strong>
                <small style={s.moneyDetail}>{item.detail}</small>
              </button>
            ))}
          </div>
          <div style={s.moneyList}>
            {moneyRows.length ? moneyRows.map((task) => (
              <button key={`${task.blocker}-${task.id || task.numer}`} type="button" style={s.moneyRow} onClick={() => navigate(`/zlecenia/${task.id}`)}>
                <strong>{task.klient_nazwa || task.numer || 'Zlecenie'}</strong>
                <span>{task.blocker}</span>
                <small>{formatMoney(task.wartosc_planowana || task.wartosc_rzeczywista)}</small>
              </button>
            )) : (
              <div style={s.moneyEmpty}>Nie ma pilnych blokad przychodowych.</div>
            )}
          </div>
        </section>

        <section className="pf-grid-two" style={s.gridTwo}>
          <div style={s.panel}>
            <div style={s.panelHeader}>
              <h2 style={s.panelTitle}>Zlecenia wg statusu</h2>
              <span style={s.panelMeta}>{totalCount} w systemie</span>
            </div>
            <div className="pf-donut-wrap" style={s.donutWrap}>
              <div style={s.donut}>
                <strong>{activeCount}/{totalCount}</strong>
                <span>aktywne</span>
              </div>
              <div style={s.statusList}>
                {statusRows.map((row) => (
                  <div key={row.label} style={s.statusRow}>
                    <div style={s.statusTop}>
                      <span><i style={{ ...s.dot, background: row.color }} />{row.label}</span>
                      <strong>{row.value}</strong>
                    </div>
                    <div style={s.track}><span style={{ ...s.fill, width: `${barPercent(row.value, statusTotal)}%`, background: row.color }} /></div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div style={s.panel}>
            <div style={s.panelHeader}>
              <h2 style={s.panelTitle}>Zlecenia wg typu usługi</h2>
              <span style={s.panelMeta}>Polska Flora</span>
            </div>
            <div style={s.serviceBars}>
              {[
                ['Wycinka drzew', allTasks.filter((task) => String(task.typ_uslugi || '').toLowerCase().includes('wycinka')).length],
                ['Pielęgnacja drzew', allTasks.filter((task) => String(task.typ_uslugi || '').toLowerCase().includes('piel')).length],
                ['Dachy', allTasks.filter((task) => String(task.typ_uslugi || '').toLowerCase().includes('dach')).length],
                ['Kostka / elewacje', allTasks.filter((task) => /kost|elew/i.test(String(task.typ_uslugi || ''))).length],
                ['Ogrodnictwo', allTasks.filter((task) => String(task.typ_uslugi || '').toLowerCase().includes('ogrod')).length],
              ].map(([label, value]) => (
                <div key={label} style={s.serviceRow}>
                  <span>{label}</span>
                  <div style={s.serviceTrack}><span style={{ width: `${barPercent(value, totalCount)}%` }} /></div>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="pf-branch-panel" style={s.branchPanel}>
          <div style={s.panelHeader}>
            <h2 style={s.panelTitle}>Wydajność operacyjna</h2>
            <button type="button" style={s.linkBtn} onClick={() => navigate('/raporty')}>Raporty</button>
          </div>
          <div className="pf-ops-grid" style={s.opsGrid}>
            {operationalMetrics.map((metric) => (
              <div key={metric.label} style={s.opsMetric}>
                <span>{metric.label}</span>
                <strong>{metric.value}%</strong>
                <div style={s.track}><span style={{ ...s.fill, width: `${metric.value}%`, background: '#10b981' }} /></div>
                <small>{metric.meta}</small>
              </div>
            ))}
          </div>
        </section>

        <section className="pf-grid-two" style={s.gridTwo}>
          <div style={s.panel}>
            <div style={s.panelHeader}>
              <h2 style={s.panelTitle}>Ostatnie zlecenia</h2>
              <button type="button" style={s.linkBtn} onClick={() => navigate('/zlecenia')}>Zobacz wszystkie</button>
            </div>
            <div style={s.taskList}>
              {ostatnie.slice(0, 6).map((task) => (
                <button key={task.id || task.numer} type="button" style={s.taskRow} onClick={() => navigate(`/zlecenia/${task.id}`)}>
                  <span style={s.taskStripe} />
                  <span style={s.taskBody}>
                    <strong>{task.klient_nazwa || 'Klient'}</strong>
                    <small>{task.adres || task.miasto || 'Brak adresu'}</small>
                  </span>
                  <span style={s.statusPill}>{statusText(task.status)}</span>
                  <span style={s.taskValue}>{formatMoney(task.wartosc_planowana)}</span>
                </button>
              ))}
            </div>
          </div>

          <div style={s.panel}>
            <div style={s.panelHeader}>
              <h2 style={s.panelTitle}>Harmonogram dzisiaj</h2>
              <button type="button" style={s.linkBtn} onClick={() => navigate('/harmonogram')}>Kalendarz</button>
            </div>
            <div style={s.taskList}>
              {scheduleItems.length ? scheduleItems.slice(0, 6).map((task) => (
                <button key={task.id || task.numer} type="button" style={s.scheduleRow} onClick={() => navigate(`/zlecenia/${task.id}`)}>
                  <span style={s.time}>{String(task.godzina_rozpoczecia || '--:--').slice(0, 5)}</span>
                  <span style={s.taskBody}>
                    <strong>{task.typ_uslugi || task.klient_nazwa || 'Zlecenie'}</strong>
                    <small>{task.miasto || task.adres || branchLabel}</small>
                  </span>
                </button>
              )) : (
                <div style={s.empty}>Brak zaplanowanych prac na dziś.</div>
              )}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

const s = {
  shell: {
    display: 'flex',
    minHeight: '100vh',
    background:
      'linear-gradient(90deg, rgba(148,163,184,0.06) 1px, transparent 1px), linear-gradient(0deg, rgba(148,163,184,0.045) 1px, transparent 1px), linear-gradient(180deg, #020617, #07111f 58%, #020617)',
    backgroundSize: '32px 32px, 32px 32px, auto',
  },
  main: { flex: 1, minWidth: 0, marginLeft: 256, padding: '20px 24px 32px', color: '#f8fafc' },
  error: { marginBottom: 16 },
  headerCopy: { display: 'grid', gap: 6, minWidth: 0 },
  brandLockup: { display: 'inline-flex', alignItems: 'center', gap: 10, marginBottom: 6 },
  brandLogo: { width: 118, height: 'auto', display: 'block' },
  brandText: { display: 'grid', gap: 1, color: '#f8fafc', fontSize: 11, fontWeight: 900, textTransform: 'uppercase' },
  header: {
    minHeight: 86,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    marginBottom: 18,
    padding: '16px 18px',
    border: '1px solid rgba(148,163,184,0.2)',
    borderRadius: 22,
    background: 'rgba(15,23,42,0.82)',
    boxShadow: '0 24px 70px rgba(0,0,0,0.24)',
  },
  eyebrow: { display: 'block', marginBottom: 6, color: '#5eead4', fontSize: 11, fontWeight: 900, textTransform: 'uppercase' },
  title: { margin: 0, fontSize: 34, lineHeight: 1.05, fontWeight: 950, color: '#ffffff' },
  subtitle: { margin: '7px 0 0', color: '#cbd5e1', fontSize: 14, fontWeight: 650 },
  headerMeta: { display: 'grid', gap: 4, justifyItems: 'end', color: '#cbd5e1', fontSize: 13, fontWeight: 700 },
  liveCockpit: {
    display: 'grid',
    gridTemplateColumns: 'minmax(420px, 1.18fr) minmax(320px, 0.72fr)',
    gridTemplateAreas: '"map decisions" "dock dock"',
    gap: 16,
    marginBottom: 24,
    padding: 16,
    border: '1px solid rgba(94,234,212,0.22)',
    borderRadius: 28,
    background:
      'radial-gradient(circle at 24% 18%, rgba(94,234,212,0.13), transparent 30%), radial-gradient(circle at 86% 8%, rgba(251,191,36,0.09), transparent 22%), linear-gradient(135deg, rgba(2,6,23,0.98), rgba(8,17,31,0.96))',
    boxShadow: '0 34px 90px rgba(0,0,0,0.34), inset 0 1px 0 rgba(255,255,255,0.04)',
    overflow: 'hidden',
  },
  radarPane: {
    gridArea: 'map',
    minHeight: 430,
    position: 'relative',
    overflow: 'hidden',
    border: '1px solid rgba(148,163,184,0.22)',
    borderRadius: 24,
    background:
      'radial-gradient(circle at 50% 50%, rgba(94,234,212,0.16), transparent 10%), radial-gradient(circle at 50% 50%, rgba(56,189,248,0.1), transparent 34%), linear-gradient(145deg, rgba(8,17,31,0.92), rgba(2,6,23,0.94))',
  },
  radarCore: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    transform: 'translate(-50%, -50%)',
    width: 'min(230px, 52%)',
    minHeight: 150,
    display: 'grid',
    placeItems: 'center',
    padding: 22,
    border: '1px solid rgba(94,234,212,0.34)',
    borderRadius: 28,
    background: 'linear-gradient(180deg, rgba(15,23,42,0.88), rgba(2,6,23,0.78))',
    boxShadow: '0 0 52px rgba(94,234,212,0.16)',
    textAlign: 'center',
    zIndex: 2,
  },
  radarLabel: { color: '#94a3b8', fontSize: 11, fontWeight: 900, textTransform: 'uppercase' },
  radarValue: { color: '#ffffff', fontSize: 74, lineHeight: 0.9, fontWeight: 950 },
  radarHint: { color: '#cbd5e1', fontSize: 13, fontWeight: 700 },
  radarNode: {
    position: 'absolute',
    zIndex: 3,
    minWidth: 112,
    display: 'grid',
    gap: 4,
    padding: '12px 14px',
    border: '1px solid rgba(94,234,212,0.24)',
    borderRadius: 16,
    background: 'rgba(2,6,23,0.72)',
    color: '#ffffff',
    boxShadow: '0 18px 46px rgba(0,0,0,0.28)',
  },
  radarNodeA: { left: '8%', top: '16%' },
  radarNodeB: { right: '8%', top: '22%', borderColor: 'rgba(251,113,133,0.34)' },
  radarNodeC: { left: '12%', bottom: '16%' },
  radarActions: { position: 'absolute', right: 18, bottom: 18, zIndex: 4, display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' },
  primaryAction: { minHeight: 44, border: 0, borderRadius: 14, padding: '0 16px', background: 'linear-gradient(135deg, #0f9f75, #22c55e)', color: '#04120d', fontWeight: 900, cursor: 'pointer' },
  secondaryAction: { minHeight: 44, border: '1px solid rgba(94,234,212,0.32)', borderRadius: 14, padding: '0 16px', background: 'rgba(15,23,42,0.84)', color: '#f8fafc', fontWeight: 900, cursor: 'pointer' },
  decisionPane: { gridArea: 'decisions', display: 'grid', gridTemplateRows: 'auto repeat(3, 1fr)', gap: 12, minWidth: 0 },
  decisionHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 66, padding: '14px 16px', border: '1px solid rgba(148,163,184,0.2)', borderRadius: 18, background: 'rgba(15,23,42,0.76)', color: '#cbd5e1', fontWeight: 900, textTransform: 'uppercase' },
  decisionRow: { display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', alignItems: 'center', gap: 14, minHeight: 110, padding: 16, border: '1px solid rgba(148,163,184,0.22)', borderRadius: 18, background: 'linear-gradient(145deg, rgba(15,23,42,0.98), rgba(11,18,32,0.98))', color: '#ffffff', textAlign: 'left', cursor: 'pointer', boxShadow: 'inset 0 -3px 0 rgba(94,234,212,0.6)' },
  decisionCopy: { display: 'grid', gap: 8, color: '#cbd5e1', fontWeight: 850, textTransform: 'uppercase' },
  kpiDock: { gridArea: 'dock', display: 'grid', gridTemplateColumns: 'repeat(6, minmax(126px, 1fr))', gap: 10 },
  kpiCard: { minHeight: 118, display: 'grid', alignContent: 'start', textAlign: 'left', border: '1px solid rgba(148,163,184,0.22)', borderRadius: 18, background: 'linear-gradient(145deg, rgba(15,23,42,0.98), rgba(11,18,32,0.98))', padding: 15, cursor: 'pointer', boxShadow: '0 18px 48px rgba(0,0,0,0.28)' },
  kpiIcon: { width: 42, height: 42, borderRadius: 13, display: 'block', marginBottom: 12 },
  kpi_blue: { background: 'linear-gradient(135deg, rgba(56,189,248,0.25), rgba(94,234,212,0.12))' },
  kpi_green: { background: 'linear-gradient(135deg, rgba(34,197,94,0.28), rgba(94,234,212,0.12))' },
  kpi_violet: { background: 'linear-gradient(135deg, rgba(139,92,246,0.28), rgba(56,189,248,0.10))' },
  kpi_amber: { background: 'linear-gradient(135deg, rgba(251,191,36,0.3), rgba(34,197,94,0.1))' },
  kpi_cyan: { background: 'linear-gradient(135deg, rgba(34,211,238,0.28), rgba(94,234,212,0.12))' },
  kpi_red: { background: 'linear-gradient(135deg, rgba(251,113,133,0.32), rgba(15,23,42,0.18))' },
  kpiValue: { display: 'block', fontSize: 34, lineHeight: 1, color: '#ffffff', fontWeight: 950 },
  kpiLabel: { display: 'block', marginTop: 7, color: '#e2e8f0', fontSize: 12, fontWeight: 850 },
  kpiHint: { display: 'block', marginTop: 4, color: '#94a3b8', fontSize: 11, fontWeight: 700 },
  flowStrip: {
    display: 'grid',
    gridTemplateColumns: 'repeat(5, minmax(132px, 1fr))',
    gap: 10,
    marginBottom: 18,
  },
  flowStep: {
    minHeight: 76,
    display: 'grid',
    gridTemplateColumns: '34px minmax(0, 1fr)',
    alignItems: 'center',
    gap: 10,
    border: '1px solid rgba(94,234,212,0.22)',
    borderRadius: 14,
    background: 'linear-gradient(145deg, rgba(15,23,42,0.92), rgba(8,17,31,0.94))',
    color: '#f8fafc',
    padding: '10px 12px',
    textAlign: 'left',
    cursor: 'pointer',
  },
  flowNumber: {
    width: 32,
    height: 32,
    borderRadius: 10,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(94,234,212,0.13)',
    color: '#5eead4',
    fontSize: 12,
    fontWeight: 950,
  },
  flowCopy: { display: 'grid', gap: 3, minWidth: 0 },
  todayCommand: {
    background: 'rgba(15,23,42,0.84)',
    border: '1px solid rgba(148,163,184,0.18)',
    borderRadius: 20,
    padding: 20,
    marginBottom: 18,
    boxShadow: '0 22px 64px rgba(0,0,0,0.26)',
  },
  todayGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
    gap: 12,
  },
  todayAction: {
    minHeight: 156,
    display: 'grid',
    gridTemplateRows: 'auto auto auto 1fr',
    alignContent: 'start',
    gap: 8,
    border: '1px solid rgba(148,163,184,0.18)',
    borderRadius: 16,
    background: 'rgba(2,6,23,0.28)',
    padding: 15,
    color: '#f8fafc',
    textAlign: 'left',
    cursor: 'pointer',
    boxShadow: 'inset 0 -3px 0 rgba(94,234,212,0.32)',
  },
  today_good: { boxShadow: 'inset 0 -3px 0 rgba(16,185,129,0.5)' },
  today_warning: { boxShadow: 'inset 0 -3px 0 rgba(245,158,11,0.68)' },
  today_danger: { boxShadow: 'inset 0 -3px 0 rgba(248,113,113,0.7)' },
  today_info: { boxShadow: 'inset 0 -3px 0 rgba(56,189,248,0.62)' },
  todayLabel: { color: '#94a3b8', fontSize: 11, fontWeight: 900, textTransform: 'uppercase' },
  todayValue: { color: '#ffffff', fontSize: 38, lineHeight: 1, fontWeight: 950 },
  todayTitle: { color: '#e2e8f0', fontSize: 14, fontWeight: 900, lineHeight: 1.25 },
  todayDetail: { color: '#94a3b8', fontSize: 12, fontWeight: 700, lineHeight: 1.35 },
  readinessPanel: {
    background: 'rgba(15,23,42,0.84)',
    border: '1px solid rgba(148,163,184,0.18)',
    borderRadius: 20,
    padding: 20,
    marginBottom: 18,
    boxShadow: '0 22px 64px rgba(0,0,0,0.26)',
  },
  readinessScore: { color: '#ffffff', fontSize: 26, fontWeight: 950, fontVariantNumeric: 'tabular-nums' },
  readinessTrack: { height: 9, borderRadius: 999, background: 'rgba(148,163,184,0.18)', overflow: 'hidden', marginBottom: 14 },
  readinessFill: { display: 'block', height: '100%', borderRadius: 999, background: 'linear-gradient(90deg, #22c55e, #5eead4)' },
  readinessList: { display: 'grid', gap: 8 },
  readinessRow: {
    width: '100%',
    minHeight: 66,
    display: 'grid',
    gridTemplateColumns: 'minmax(180px, 0.9fr) minmax(220px, 1fr) 58px',
    gap: 12,
    alignItems: 'center',
    border: '1px solid rgba(148,163,184,0.14)',
    borderRadius: 13,
    background: 'rgba(2,6,23,0.24)',
    color: '#e2e8f0',
    padding: '10px 12px',
    textAlign: 'left',
    cursor: 'pointer',
  },
  readinessTask: { display: 'grid', gap: 4, minWidth: 0 },
  readinessBlockers: { display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-start' },
  readinessPill: { display: 'inline-flex', alignItems: 'center', minHeight: 24, padding: '3px 8px', borderRadius: 999, background: 'rgba(248,113,113,0.12)', color: '#fecaca', fontSize: 11, fontWeight: 850 },
  readinessPercent: { color: '#5eead4', textAlign: 'right', fontSize: 16, fontWeight: 950 },
  readinessEmpty: { padding: 18, borderRadius: 12, background: 'rgba(2,6,23,0.24)', color: '#94a3b8', fontWeight: 800, textAlign: 'center' },
  moneyPanel: {
    background: 'rgba(15,23,42,0.84)',
    border: '1px solid rgba(148,163,184,0.18)',
    borderRadius: 20,
    padding: 20,
    marginBottom: 18,
    boxShadow: '0 22px 64px rgba(0,0,0,0.26)',
  },
  moneyGrid: { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(160px, 1fr))', gap: 12, marginBottom: 12 },
  moneyCard: {
    minHeight: 112,
    display: 'grid',
    alignContent: 'start',
    gap: 8,
    border: '1px solid rgba(251,191,36,0.18)',
    borderRadius: 16,
    background: 'linear-gradient(145deg, rgba(120,53,15,0.2), rgba(2,6,23,0.28))',
    color: '#f8fafc',
    padding: 14,
    textAlign: 'left',
    cursor: 'pointer',
    boxShadow: 'inset 0 -3px 0 rgba(251,191,36,0.5)',
  },
  moneyLabel: { color: '#fde68a', fontSize: 12, fontWeight: 900, textTransform: 'uppercase' },
  moneyValue: { color: '#ffffff', fontSize: 34, lineHeight: 1, fontWeight: 950 },
  moneyDetail: { color: '#cbd5e1', fontSize: 12, fontWeight: 700, lineHeight: 1.35 },
  moneyList: { display: 'grid', gap: 8 },
  moneyRow: {
    width: '100%',
    minHeight: 48,
    display: 'grid',
    gridTemplateColumns: 'minmax(170px, 1fr) minmax(140px, 0.7fr) 86px',
    gap: 12,
    alignItems: 'center',
    border: '1px solid rgba(148,163,184,0.14)',
    borderRadius: 12,
    background: 'rgba(2,6,23,0.22)',
    color: '#e2e8f0',
    padding: '9px 12px',
    textAlign: 'left',
    cursor: 'pointer',
  },
  moneyEmpty: { padding: 16, borderRadius: 12, background: 'rgba(2,6,23,0.24)', color: '#94a3b8', fontWeight: 800, textAlign: 'center' },
  gridTwo: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 18, marginBottom: 18 },
  panel: { background: 'rgba(15,23,42,0.84)', border: '1px solid rgba(148,163,184,0.18)', borderRadius: 20, padding: 20, boxShadow: '0 22px 64px rgba(0,0,0,0.26)' },
  branchPanel: { background: 'rgba(15,23,42,0.84)', border: '1px solid rgba(148,163,184,0.18)', borderRadius: 20, padding: 20, marginBottom: 18, boxShadow: '0 22px 64px rgba(0,0,0,0.26)' },
  panelHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 18 },
  panelTitle: { margin: 0, color: '#ffffff', fontSize: 18, fontWeight: 900 },
  panelMeta: { color: '#94a3b8', fontSize: 12, fontWeight: 800 },
  linkBtn: { border: '1px solid rgba(94,234,212,0.28)', borderRadius: 12, minHeight: 34, padding: '0 12px', background: 'rgba(94,234,212,0.08)', color: '#5eead4', fontWeight: 900, cursor: 'pointer' },
  donutWrap: { display: 'grid', gridTemplateColumns: '220px 1fr', gap: 24, alignItems: 'center' },
  donut: { width: 190, height: 190, borderRadius: '50%', background: 'radial-gradient(circle at center, #0f172a 47%, transparent 48%), conic-gradient(#10b981 0 62%, #f59e0b 62% 78%, #3b82f6 78% 100%)', display: 'grid', placeItems: 'center', alignContent: 'center', justifyItems: 'center', color: '#ffffff' },
  statusList: { display: 'grid', gap: 15 },
  statusRow: { display: 'grid', gap: 7 },
  statusTop: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#cbd5e1', fontSize: 13, fontWeight: 750 },
  dot: { width: 9, height: 9, borderRadius: '50%', display: 'inline-block', marginRight: 8 },
  track: { height: 7, borderRadius: 999, background: 'rgba(148,163,184,0.18)', overflow: 'hidden' },
  fill: { display: 'block', height: '100%', borderRadius: 999 },
  serviceBars: { display: 'grid', gap: 16 },
  serviceRow: { display: 'grid', gridTemplateColumns: '150px 1fr 34px', gap: 12, alignItems: 'center', color: '#cbd5e1', fontSize: 13, fontWeight: 750 },
  serviceTrack: { height: 34, borderRadius: 9, background: 'rgba(148,163,184,0.14)', overflow: 'hidden' },
  opsGrid: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 },
  opsMetric: { display: 'grid', gap: 8, border: '1px solid rgba(148,163,184,0.18)', borderRadius: 14, padding: 14, color: '#cbd5e1', fontSize: 13, fontWeight: 750, background: 'rgba(2,6,23,0.28)' },
  taskList: { display: 'grid', gap: 10 },
  taskRow: { display: 'grid', gridTemplateColumns: '8px minmax(0, 1fr) auto auto', gap: 14, alignItems: 'center', width: '100%', border: '1px solid rgba(148,163,184,0.12)', background: 'rgba(2,6,23,0.22)', padding: 10, borderRadius: 12, color: '#e2e8f0', textAlign: 'left', cursor: 'pointer' },
  taskStripe: { height: 40, width: 4, borderRadius: 99, background: '#10b981' },
  taskBody: { display: 'grid', gap: 4, minWidth: 0 },
  statusPill: { padding: '5px 9px', borderRadius: 999, background: 'rgba(16,185,129,0.12)', color: '#5eead4', fontSize: 11, fontWeight: 850 },
  taskValue: { color: '#cbd5e1', fontSize: 12, fontWeight: 850 },
  scheduleRow: { display: 'grid', gridTemplateColumns: '54px 1fr', gap: 12, alignItems: 'center', width: '100%', border: '1px solid rgba(148,163,184,0.12)', background: 'rgba(2,6,23,0.22)', padding: 12, borderRadius: 12, color: '#e2e8f0', textAlign: 'left', cursor: 'pointer' },
  time: { color: '#5eead4', fontSize: 13, fontWeight: 950 },
  empty: { padding: 24, borderRadius: 12, background: 'rgba(2,6,23,0.26)', color: '#94a3b8', textAlign: 'center', fontWeight: 800 },
};
