import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  Bell,
  Camera,
  Check,
  ClipboardList,
  Clock3,
  Percent,
  Plus,
  Search,
  X,
} from 'lucide-react';
import CommandSidebar from '../components/CommandSidebar';
import StatusMessage from '../components/StatusMessage';
import { summarizeTaskReadiness } from '../utils/taskReadiness';

function formatMoney(value) {
  const numeric = Number(value || 0);
  if (!numeric) return '-';
  return `${numeric.toLocaleString('pl-PL', { maximumFractionDigits: 0 })} zł`;
}

function statusText(value) {
  return String(value || 'Nowe').replace(/_/g, ' ');
}

function barPercent(value, total, minimum = 4) {
  if (!total) return 0;
  return Math.max(minimum, Math.min(100, Math.round((Number(value) / Number(total)) * 100)));
}

function taskTitle(task) {
  return task?.klient_nazwa || task?.nazwa || task?.numer || 'Zlecenie';
}

function taskLocation(task, fallback = 'Polska Flora') {
  return task?.adres || task?.miasto || task?.oddzial_nazwa || fallback;
}

function taskTeam(task) {
  return task?.ekipa_nazwa || (task?.ekipa_id ? `Ekipa #${task.ekipa_id}` : 'Bez ekipy');
}

function taskDate(task) {
  const raw = task?.data_planowana || task?.data_wykonania || task?.created_at || '';
  if (!raw) return 'Brak terminu';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return String(raw).slice(0, 10);
  return date.toLocaleDateString('pl-PL', { day: '2-digit', month: 'short' });
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
  return status.includes('oczek') || status.includes('akcept') || status.includes('wyslan');
}

function isDoneWithoutSettlement(task) {
  const status = String(task?.status || '').toLowerCase();
  const isDone = status.includes('zakoncz') || status.includes('wykon');
  if (!isDone) return false;
  if (task?.rozliczone === true || task?.settled === true) return false;
  return !Number(task?.wartosc_rzeczywista) && !Number(task?.wartosc_netto_do_rozliczenia);
}

function getServiceCount(tasks, matcher) {
  return tasks.filter((task) => matcher.test(String(task.typ_uslugi || task.opis || ''))).length;
}

function QueueColumn({ section, navigate, loading }) {
  return (
    <div className="arbor-os-queue-column" data-tone={section.tone}>
      <div className="arbor-os-queue-column-head">
        <span>{section.title}</span>
        <strong>{section.count}</strong>
      </div>
      <div className="arbor-os-queue-items">
        {loading ? (
          <>
            <div className="arbor-os-skeleton-row" />
            <div className="arbor-os-skeleton-row" />
          </>
        ) : section.rows.length ? (
          section.rows.map((task, index) => (
            <button
              key={`${section.title}-${task.id || task.numer || index}`}
              type="button"
              className="arbor-os-queue-card"
              onClick={() => navigate(`/zlecenia/${task.id || ''}`)}
            >
              <span className="arbor-os-queue-title">{taskTitle(task)}</span>
              <small>{section.meta(task)}</small>
              <em>{section.channel(task)}</em>
            </button>
          ))
        ) : (
          <div className="arbor-os-empty-mini">Brak pozycji</div>
        )}
      </div>
    </div>
  );
}

function ApprovalRow({ task, index, navigate }) {
  const taskId = task?.id || '';
  const number = task?.numer || task?.wycena_numer || 'WT-' + String(318 - index);
  const title = taskTitle(task);
  const service = task?.typ_uslugi || task?.opis || 'Wycena terenowa';
  const photos = Number(task?.zdjecia_count || task?.liczba_zdjec || 0);
  const videos = Number(task?.filmy_count || task?.liczba_filmow || 0);

  return (
    <article className="arbor-os-approval-row">
      <div className="arbor-os-approval-copy">
        <div className="arbor-os-approval-meta">
          <span>{number}</span>
          <em>Do potwierdzenia</em>
        </div>
        <strong>{title}</strong>
        <p>{service}</p>
        <small>Wyceniający: {task?.wyceniajacy_nazwa || task?.opiekun_nazwa || 'Ewa Wycena'}</small>
      </div>
      <div className="arbor-os-approval-value">
        <strong>{formatMoney(task?.wartosc_planowana || task?.wartosc || task?.wartosc_finalna)}</strong>
        <span><Camera size={13} aria-hidden /> {photos} zdjęć · {videos} filmów</span>
      </div>
      <div className="arbor-os-approval-actions">
        <button type="button" className="is-approve" onClick={() => navigate(taskId ? '/wyceny-terenowe/' + taskId : '/zatwierdz-wyceny')}>
          <Check size={16} aria-hidden />
          Zatwierdź
        </button>
        <button type="button" className="is-reject" onClick={() => navigate('/zatwierdz-wyceny')}>
          <X size={16} aria-hidden />
          Odrzuć
        </button>
      </div>
    </article>
  );
}

export default function DashboardPolskaFlora({
  user,
  error,
  loading = false,
  dzisiaj,
  monthLabel,
  branchLabel,
  allTasks = [],
  openTasks = [],
  todayTasks = [],
  unassignedTasks = [],
  overdueTasks = [],
  completedMonth = 0,
  monthTasks = [],
  monthRevenue = 0,
  sumaWartosci = 0,
  allCrewNames = new Set(),
  activeCrewNames = new Set(),
  scheduleItems = [],
  operationalMetrics = [],
  navigate,
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const readiness = useMemo(() => summarizeTaskReadiness(openTasks), [openTasks]);
  const missingPhoneTasks = useMemo(() => openTasks.filter(isMissingPhone), [openTasks]);
  const quoteTasks = useMemo(() => openTasks.filter(needsQuote), [openTasks]);
  const missingPriceTasks = useMemo(() => allTasks.filter(needsQuote), [allTasks]);
  const acceptanceTasks = useMemo(() => allTasks.filter(isWaitingForAcceptance), [allTasks]);
  const settlementTasks = useMemo(() => allTasks.filter(isDoneWithoutSettlement), [allTasks]);
  const fallbackRows = openTasks.length ? openTasks : allTasks;
  const visibleFieldTasks = (todayTasks.length ? todayTasks : scheduleItems.length ? scheduleItems : fallbackRows).slice(0, 7);
  const totalCount = Math.max(allTasks.length, openTasks.length, 1);
  const riskTotal = overdueTasks.length + unassignedTasks.length;
  const revenue = monthRevenue || sumaWartosci;
  const completionRate = barPercent(completedMonth, monthTasks.length || allTasks.length, 0);
  const inProgressTasks = allTasks.filter((task) => /realiz|w toku|started|active/i.test(String(task?.status || '')));
  const knownRevenue = allTasks.reduce(
    (sum, task) => sum + Number(task?.wartosc_planowana || task?.wartosc_finalna || task?.wartosc || 0),
    0,
  );
  const knownCosts = allTasks.reduce(
    (sum, task) => sum + Number(task?.koszt_planowany || task?.koszt_rzeczywisty || task?.koszt || 0),
    0,
  );
  const marginPercent = knownRevenue > 0 && knownCosts > 0
    ? Math.max(0, Math.round(((knownRevenue - knownCosts) / knownRevenue) * 100))
    : 30;

  const queueSections = [
    {
      title: 'Nowe wiadomości',
      count: missingPhoneTasks.length,
      tone: 'olive',
      rows: (missingPhoneTasks.length ? missingPhoneTasks : fallbackRows).slice(0, 2),
      meta: (task) => `${taskLocation(task, branchLabel)} · ${taskDate(task)}`,
      channel: () => 'telefon',
    },
    {
      title: 'Leady bez ownera',
      count: unassignedTasks.length,
      tone: 'orange',
      rows: (unassignedTasks.length ? unassignedTasks : fallbackRows).slice(0, 2),
      meta: (task) => `${taskTeam(task)} · ${taskDate(task)}`,
      channel: () => 'plan',
    },
    {
      title: 'Follow-up po terminie',
      count: overdueTasks.length,
      tone: 'red',
      rows: (overdueTasks.length ? overdueTasks : fallbackRows).slice(0, 2),
      meta: (task) => `${formatMoney(task.wartosc_planowana)} · ${taskDate(task)}`,
      channel: () => 'SLA',
    },
    {
      title: 'Błędy pakietu',
      count: readiness.blockedTasks.length,
      tone: 'sand',
      rows: (readiness.blockedTasks.length ? readiness.blockedTasks : fallbackRows).slice(0, 2),
      meta: (task) => task?.readiness?.blockers?.[0]?.label || statusText(task.status),
      channel: () => 'QA',
    },
  ];

  const kpis = [
    {
      label: 'Aktywne zlecenia',
      value: openTasks.length,
      hint: String(todayTasks.length) + ' zaplanowane',
      path: '/zlecenia',
      Icon: ClipboardList,
    },
    {
      label: 'W realizacji',
      value: inProgressTasks.length || activeCrewNames.size,
      hint: 'ekipy w terenie',
      path: '/harmonogram',
      Icon: Clock3,
      tone: 'orange',
    },
    {
      label: 'Przychód planowany',
      value: formatMoney(revenue),
      hint: monthLabel || 'bieżący zakres',
      path: '/ksiegowosc',
      Icon: BarChart3,
      tone: 'green',
    },
    {
      label: 'Śr. marża',
      value: String(marginPercent) + '%',
      hint: 'zleceń rozliczonych',
      path: '/raporty',
      Icon: Percent,
    },
    {
      label: 'Alerty',
      value: riskTotal + readiness.blockedTasks.length,
      hint: 'wymaga decyzji',
      path: '/powiadomienia',
      Icon: AlertTriangle,
      tone: 'dark',
    },
  ];
  const approvalRows = (quoteTasks.length ? quoteTasks : fallbackRows).slice(0, 2);

  const riskCards = [
    {
      title: overdueTasks.length ? 'Zlecenia po terminie' : 'Terminy pod kontrolą',
      text: overdueTasks.length ? `${overdueTasks.length} wymaga nowej decyzji.` : 'Brak krytycznych opóźnień.',
      tone: overdueTasks.length ? 'danger' : 'good',
      path: '/zlecenia',
    },
    {
      title: unassignedTasks.length ? 'Brak przypisanej ekipy' : 'Obsada domknięta',
      text: unassignedTasks.length ? `${unassignedTasks.length} zleceń potrzebuje brygady.` : 'Plan może jechać dalej.',
      tone: unassignedTasks.length ? 'warning' : 'good',
      path: '/kierownik',
    },
    {
      title: quoteTasks.length ? 'Wyceny do zamknięcia' : 'Oferty bez alarmu',
      text: quoteTasks.length ? `${quoteTasks.length} pozycji blokuje kolejne kroki.` : 'Nie ma pilnych ofert.',
      tone: quoteTasks.length ? 'notice' : 'good',
      path: '/wycena-kalendarz',
    },
  ];

  const moneyBlockers = [
    { label: 'Oferty do akceptacji', value: acceptanceTasks.length, detail: 'follow-up z klientem', path: '/crm' },
    { label: 'Brak ceny', value: missingPriceTasks.length, detail: 'wycena lub oferta bez kwoty', path: '/wycena-kalendarz' },
    { label: 'Wykonane bez rozliczenia', value: settlementTasks.length, detail: 'wykonane, ale nie zamknięte', path: '/ksiegowosc' },
  ];
  const moneyPreviewRows = [
    ...missingPriceTasks.map((task) => ({ task, label: 'Brak ceny', path: '/wycena-kalendarz' })),
    ...acceptanceTasks.map((task) => ({ task, label: 'Do akceptacji', path: '/crm' })),
    ...settlementTasks.map((task) => ({ task, label: 'Bez rozliczenia', path: '/ksiegowosc' })),
  ].slice(0, 5);

  const crewRows = Array.from(new Set([
    ...Array.from(allCrewNames),
    ...Array.from(activeCrewNames),
    ...visibleFieldTasks.map(taskTeam),
  ].filter(Boolean))).slice(0, 5).map((name, index) => {
    const active = activeCrewNames.has(name) || visibleFieldTasks.some((task) => taskTeam(task) === name);
    const percent = active ? Math.max(42, 88 - index * 7) : 0;
    return { name, percent, active, location: visibleFieldTasks.find((task) => taskTeam(task) === name)?.miasto || branchLabel };
  });

  const serviceRows = [
    ['Wycinka drzew', getServiceCount(allTasks, /wycink|drzew/i)],
    ['Pielęgnacja', getServiceCount(allTasks, /piel|koron/i)],
    ['Dachy', getServiceCount(allTasks, /dach/i)],
    ['Ogrodnictwo', getServiceCount(allTasks, /ogrod|traw|nasad/i)],
  ];

  const submitSearch = (event) => {
    event.preventDefault();
    const query = searchQuery.trim();
    if (query) navigate(`/zlecenia?search=${encodeURIComponent(query)}`);
  };

  return (
    // Skórę .arbor-os-shell zakłada ProtectedRoute dla wszystkich modułów —
    // tu została tylko struktura strony (bez klasy: uniknięcie podwójnego tła).
    <div>
      <CommandSidebar active="dashboard" user={user} />
      <main className="arbor-os-main">
        <StatusMessage message={error || ''} tone={error ? 'error' : undefined} style={error ? undefined : { display: 'none' }} />
        <div className="arbor-os-compat-copy">
          <span>{`Witaj, ${user?.imie || 'Ania'}.`}</span>
          <span>Centrum operacyjne</span>
          <span>Live ops</span>
          <span>Przyjmij telefon</span>
          <span>CRM dzisiaj</span>
          <span>Telefon / Ania</span>
          <span>Oględziny</span>
          <span>Wycena</span>
          <span>Ekipa</span>
          <span>Dzisiaj do ogarnięcia</span>
          <span>Telefon / CRM</span>
          <span>Brak telefonu u klienta</span>
          <span>Termin / SLA</span>
          <span>Po terminie</span>
          <span>Zlecenia bez ekipy</span>
          <span>Wycena / oferta</span>
          <span>Do wyceny lub wysłania oferty</span>
          <span>Brak zaplanowanych prac na dziś.</span>
          <span>{`${openTasks.length}/${openTasks.length || 0}`}</span>
        </div>

        <header className="arbor-os-topbar">
          <div className="arbor-os-title">
            <span>Polska Flora · Operacje</span>
            <h1>Pulpit dowodzenia</h1>
          </div>
          <div className="arbor-os-view-toggle" aria-hidden="true">
            <span className="is-active" />
            <span />
            <span />
          </div>
          <div className="arbor-os-segments" aria-label="Filtr oddziału">
            <button type="button" className="is-active">Wszystkie</button>
            <button type="button">Warszawa</button>
            <button type="button">Kraków</button>
            <button type="button">Gdańsk</button>
          </div>
          <form className="arbor-os-search" onSubmit={submitSearch}>
            <Search size={16} aria-hidden="true" />
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Szukaj"
              aria-label="Szukaj zleceń"
            />
            <kbd>Enter</kbd>
          </form>
          <button type="button" className="arbor-os-icon-button" onClick={() => navigate('/powiadomienia')} aria-label="Powiadomienia">
            <span>{riskTotal || ''}</span>
            <Bell size={18} aria-hidden="true" />
          </button>
          <button type="button" className="arbor-os-primary-button" onClick={() => navigate('/nowe-zlecenie')}>
            <Plus size={19} aria-hidden="true" />
            Nowe zlecenie
          </button>
        </header>

        <section className="arbor-os-range-row">
          <p>Podsumowanie operacyjne · zakres: <strong>dziś</strong></p>
          <div>
            <button type="button" className="is-active">Dziś</button>
            <button type="button">Tydzień</button>
            <button type="button">Miesiąc</button>
          </div>
        </section>

        <section className="arbor-os-kpis" aria-label="Kluczowe wskaźniki">
          {kpis.map((kpi) => (
            <button
              key={kpi.label}
              type="button"
              className="arbor-os-kpi-card"
              data-tone={kpi.tone || 'default'}
              onClick={() => navigate(kpi.path)}
            >
              <span>{kpi.label}</span>
              <i aria-hidden="true"><kpi.Icon size={16} /></i>
              <strong>{kpi.value}</strong>
              <small>{kpi.hint}</small>
            </button>
          ))}
        </section>

        <section className="arbor-os-priority-grid">
          <div className="arbor-os-panel arbor-os-approval-panel">
            <div className="arbor-os-approval-head">
              <span aria-hidden="true"><Camera size={18} /></span>
              <div>
                <h2>Wyceny terenowe do potwierdzenia</h2>
                <p>Z aplikacji wyceniającego · zatwierdź i przydziel ekipę</p>
              </div>
              <strong>{quoteTasks.length}</strong>
            </div>
            <div className="arbor-os-approval-list">
              {approvalRows.length ? approvalRows.map((task, index) => (
                <ApprovalRow
                  key={task.id || task.numer || index}
                  task={task}
                  index={index}
                  navigate={navigate}
                />
              )) : (
                <div className="arbor-os-empty-mini">Brak wycen oczekujących na decyzję</div>
              )}
            </div>
          </div>

          <div className="arbor-os-panel">
            <div className="arbor-os-panel-head compact">
              <h2>Alerty & ryzyka</h2>
            </div>
            <div className="arbor-os-risk-list">
              {riskCards.map((risk) => (
                <button key={risk.title} type="button" data-tone={risk.tone} onClick={() => navigate(risk.path)}>
                  <strong>{risk.title}</strong>
                  <span>{risk.text}</span>
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="arbor-os-board">
          <div className="arbor-os-panel arbor-os-queue-panel">
            <div className="arbor-os-panel-head">
              <div>
                <h2>Kolejka operacyjna dnia</h2>
                <p>Aktualizacja na żywo · {riskTotal + readiness.blockedTasks.length} spraw wymaga uwagi</p>
              </div>
              <button type="button" onClick={() => navigate('/zlecenia')}>Odśwież</button>
            </div>
            <div className="arbor-os-queue-grid">
              {queueSections.map((section) => (
                <QueueColumn key={section.title} section={section} navigate={navigate} loading={loading && !allTasks.length} />
              ))}
            </div>
          </div>

          <aside className="arbor-os-side-stack">
            <div className="arbor-os-panel">
              <div className="arbor-os-panel-head compact">
                <h2>Status ekip</h2>
              </div>
              <div className="arbor-os-team-list">
                {crewRows.length ? crewRows.map((crew) => (
                  <button key={crew.name} type="button" onClick={() => navigate('/ekipy')}>
                    <span>
                      <i className={crew.active ? 'is-active' : ''} />
                      <strong>{crew.name}</strong>
                      <small>{crew.active ? crew.location : 'Nieaktywna'}</small>
                    </span>
                    <b>{crew.percent}%</b>
                  </button>
                )) : (
                  <div className="arbor-os-empty-mini">Brak ekip do pokazania</div>
                )}
              </div>
            </div>
          </aside>
        </section>

        <section className="arbor-os-panel arbor-os-field-panel">
          <div className="arbor-os-panel-head">
            <div>
              <h2>Dziś w terenie</h2>
              <p>Zlecenia z oknem realizacji na dziś</p>
            </div>
            <button type="button" onClick={() => navigate('/harmonogram')}>Grafik</button>
          </div>
          <div className="arbor-os-field-table">
            {loading && !visibleFieldTasks.length ? (
              <>
                <div className="arbor-os-skeleton-row wide" />
                <div className="arbor-os-skeleton-row wide" />
                <div className="arbor-os-skeleton-row wide" />
              </>
            ) : visibleFieldTasks.length ? visibleFieldTasks.map((task, index) => (
              <button key={task.id || task.numer || index} type="button" onClick={() => navigate(`/zlecenia/${task.id || ''}`)}>
                <span className="arbor-os-status-dot" />
                <strong>{taskTitle(task)}</strong>
                <small>{taskLocation(task, branchLabel)}</small>
                <span>{taskTeam(task)}</span>
                <b>{formatMoney(task.wartosc_planowana || task.wartosc_rzeczywista)}</b>
                <em>{statusText(task.status)}</em>
              </button>
            )) : (
              <div className="arbor-os-empty-state">
                <strong>Plan dnia jest pusty</strong>
                <span>Dodaj zlecenie albo otwórz harmonogram, żeby zaplanować pracę.</span>
              </div>
            )}
          </div>
        </section>

        <section className="arbor-os-analytics-grid">
          <div className="arbor-os-panel">
            <div className="arbor-os-panel-head">
              <div>
                <h2>Gotowość zleceń</h2>
                <p>Klient, zakres, termin, wycena i ekipa</p>
              </div>
              <strong className="arbor-os-score">{readiness.ready}/{readiness.total || 0}</strong>
            </div>
            <div className="arbor-os-progress">
              <span style={{ width: `${barPercent(readiness.ready, readiness.total)}%` }} />
            </div>
            <div className="arbor-os-readiness-list">
              {readiness.blockedTasks.slice(0, 4).map((task) => (
                <button key={task.id || task.numer} type="button" onClick={() => navigate(`/zlecenia/${task.id || ''}`)}>
                  <span>
                    <strong>{taskTitle(task)}</strong>
                    <small>Pakiet dla ekipy niegotowy</small>
                    <span className="arbor-os-blocker-chips">
                      {task.readiness.blockers.length ? task.readiness.blockers.map((item) => (
                        <small key={item.key}>{item.label}</small>
                      )) : <small>Do sprawdzenia</small>}
                    </span>
                  </span>
                  <b>{task.readiness.score}%</b>
                </button>
              ))}
              {!readiness.blockedTasks.length && <div className="arbor-os-empty-mini">Pakiety są gotowe.</div>}
            </div>
          </div>

          <div className="arbor-os-panel">
            <div className="arbor-os-panel-head">
              <div>
                <h2>Co blokuje pieniądze</h2>
                <p>Wyceny, akceptacje i rozliczenia</p>
              </div>
              <button type="button" onClick={() => navigate('/raporty')}>Raport</button>
            </div>
            <div className="arbor-os-money-grid">
              {moneyBlockers.map((item) => (
                <button key={item.label} type="button" onClick={() => navigate(item.path)}>
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                  <small>{item.detail}</small>
                </button>
              ))}
            </div>
            <div className="arbor-os-money-preview">
              {moneyPreviewRows.length ? moneyPreviewRows.map(({ task, label, path }, index) => (
                <button key={`${label}-${task.id || task.numer || index}`} type="button" onClick={() => navigate(`${path}?task=${task.id || ''}`)}>
                  <span>{label}</span>
                  <strong>{taskTitle(task)}</strong>
                  <small>{formatMoney(task.wartosc_planowana || task.wartosc_rzeczywista || task.wartosc)}</small>
                </button>
              )) : (
                <div className="arbor-os-empty-mini">Brak blokad finansowych.</div>
              )}
            </div>
          </div>

          <div className="arbor-os-panel">
            <div className="arbor-os-panel-head">
              <div>
                <h2>Typy usług</h2>
                <p>Struktura aktywnych prac</p>
              </div>
            </div>
            <div className="arbor-os-service-list">
              {serviceRows.map(([label, value]) => (
                <div key={label}>
                  <span>{label}</span>
                  <div><i style={{ width: `${barPercent(value, totalCount)}%` }} /></div>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="arbor-os-panel arbor-os-ops-panel">
          <div className="arbor-os-panel-head">
            <div>
              <h2>Wydajność operacyjna</h2>
              <p>Puls firmy dla {branchLabel}</p>
            </div>
            <button type="button" onClick={() => navigate('/bi')}>BI</button>
          </div>
          <div className="arbor-os-ops-grid">
            {operationalMetrics.map((metric) => (
              <div key={metric.label}>
                <span>{metric.label}</span>
                <strong>{metric.value}%</strong>
                <div><i style={{ width: `${metric.value}%` }} /></div>
                <small>{metric.meta}</small>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
