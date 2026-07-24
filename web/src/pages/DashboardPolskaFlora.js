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
import { RefCard, StatusPill, Money, Icon } from './reference/ArborReferenceComponents';
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

  const decisionRows = (moneyPreviewRows.length
    ? moneyPreviewRows.map((r) => ({ task: r.task, label: r.label, path: r.path }))
    : visibleFieldTasks.map((task) => ({ task, label: statusText(task.status), path: `/zlecenia/${task.id || ''}` }))
  ).slice(0, 6);

  return (
    // Skórę .arbor-os-shell zakłada ProtectedRoute; sidebar to realna nawigacja,
    // a treść main odwzorowuje makietę Polska Flora (Centrum operacyjne).
    <div>
      <CommandSidebar active="dashboard" user={user} />
      <main className="arbor-os-main pf-dash">
        <StatusMessage message={error || ''} tone={error ? 'error' : undefined} style={error ? undefined : { display: 'none' }} />

        <header className="ref-topbar">
          <div className="ref-title-block">
            <small>Arbor OS · {branchLabel || 'Polska Flora'}</small>
            <h1>Centrum operacyjne</h1>
            <p>{`Witaj, ${user?.imie || 'Ania'}. Przegląd operacji w czasie rzeczywistym i priorytet na szybkie decyzje.`}</p>
          </div>
          <div className="ref-actions">
            <form onSubmit={submitSearch} className="pf-dash-search">
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Szukaj zlecenia…"
                aria-label="Szukaj zlecenia"
              />
            </form>
            <button className="ref-button" type="button" onClick={() => navigate('/harmonogram')}><Icon name="calendar" /> Grafik</button>
            <button className="ref-button is-primary" type="button" onClick={() => navigate('/nowe-zlecenie')}><Icon name="plus" /> Nowe zlecenie</button>
          </div>
        </header>

        <section className="ref-hero-dark" style={{ padding: 28, marginBottom: 18 }}>
          <div className="ref-grid two" style={{ alignItems: 'center' }}>
            <div>
              <small>{monthLabel || dzisiaj || 'Dzisiaj'}</small>
              <h2 style={{ margin: '8px 0 10px', fontSize: 'clamp(26px, 3.4vw, 46px)', lineHeight: 1.03 }}>Plan dnia jest pod kontrolą</h2>
              <p style={{ maxWidth: 560, margin: 0 }}>
                {`W realizacji: ${inProgressTasks.length}. Do decyzji: ${riskTotal + readiness.blockedTasks.length}. Ekipy w terenie: ${activeCrewNames.size || crewRows.filter((crew) => crew.active).length}.`}
              </p>
            </div>
            <div className="ref-grid three">
              <div><strong>{completionRate}%</strong><span>terminowości</span></div>
              <div><strong>{visibleFieldTasks.length}</strong><span>tras dziś</span></div>
              <div><strong>{marginPercent}%</strong><span>marży</span></div>
            </div>
          </div>
        </section>

        <section className="ref-grid kpis" data-kpis>
          {kpis.map((kpi) => (
            <button
              className="ref-kpi"
              type="button"
              key={kpi.label}
              onClick={() => navigate(kpi.path)}
              style={{ cursor: 'pointer', textAlign: 'left', font: 'inherit', border: 'none' }}
            >
              <small>{kpi.label}</small>
              <strong>{kpi.value}</strong>
              <span>{kpi.hint}</span>
            </button>
          ))}
        </section>

        <div className="ref-grid two" style={{ marginTop: 18 }}>
          <RefCard title="Zlecenia do decyzji">
            <div className="ref-list">
              {decisionRows.length ? decisionRows.map(({ task, label, path }, index) => (
                <button
                  className="ref-list-row"
                  type="button"
                  key={`${task?.id || 'row'}-${index}`}
                  onClick={() => navigate(path)}
                  style={{ cursor: 'pointer', textAlign: 'left', font: 'inherit', width: '100%', border: 'none', background: 'transparent' }}
                >
                  <div>
                    <strong>{`#${task?.id || '—'} · ${task?.typ_uslugi || task?.tytul || task?.adres || 'Zlecenie'}`}</strong>
                    <small>{taskLocation(task, branchLabel)}</small>
                  </div>
                  <StatusPill tone={/piln|termin/i.test(label) ? 'red' : /realiz|toku/i.test(label) ? 'orange' : 'olive'}>{label}</StatusPill>
                  <Money>{formatMoney(task?.wartosc_planowana || task?.wartosc || 0)}</Money>
                </button>
              )) : (
                <div className="ref-list-row">
                  <div><strong>Brak zleceń do decyzji</strong><small>wszystko obsłużone</small></div>
                </div>
              )}
            </div>
          </RefCard>

          <RefCard title="Ekipy w terenie">
            <div className="ref-list">
              {crewRows.length ? crewRows.map((crew) => (
                <div className="ref-list-row" key={crew.name}>
                  <div>
                    <strong>{crew.name}</strong>
                    <small>{crew.location}</small>
                  </div>
                  <StatusPill tone={crew.active ? 'olive' : 'sand'}>{crew.active ? 'W terenie' : 'Wolna'}</StatusPill>
                  <span style={{ fontWeight: 800, color: '#5d6a0b' }}>{crew.percent}%</span>
                </div>
              )) : (
                <div className="ref-list-row">
                  <div><strong>Brak aktywnych ekip</strong><small>{branchLabel || 'Polska Flora'}</small></div>
                </div>
              )}
            </div>
          </RefCard>
        </div>
      </main>
    </div>
  );
}
