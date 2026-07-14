import { useEffect, useMemo, useState } from 'react';
import { Check, FileText, Phone } from 'lucide-react';
import { useParams } from 'react-router-dom';
import BrandLogo from '../components/BrandLogo';

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,96}$/;

const DEMO_PORTAL = Object.freeze({
  officePhone: '+48221002030',
  order: {
    id: '#1042',
    title: 'Pielęgnacja i wycinka — al. Klonowa 5',
    address: 'al. Klonowa 5, Warszawa',
    status: 'W realizacji',
    statusTone: 'orange',
    eta: '14 czerwca',
    value: '6 800 zł',
    progress: 68,
    progressLabel: 'Etap 4 z 5 · ekipa na miejscu',
  },
  team: {
    name: 'Jan Kowalski',
    role: 'Brygadzista',
    size: '4-osobowa ekipa',
    initials: 'JK',
    phone: '+48500100100',
    phoneLabel: 'Zadzwoń do brygadzisty',
  },
  steps: [
    { label: 'Zlecenie przyjęte', time: '12.06 · 08:12', state: 'done' },
    { label: 'Wycena zaakceptowana', time: '12.06 · 14:40', state: 'done' },
    { label: 'Ekipa przydzielona · A1', time: '13.06 · 09:40', state: 'done' },
    { label: 'Prace w toku', time: 'dziś · 10:05', state: 'current' },
    { label: 'Odbiór i rozliczenie', time: 'planowane 14.06', state: 'next' },
  ],
  scope: [
    { label: 'Wycinka 3 topoli (zagrożenie)', done: true },
    { label: 'Pielęgnacja koron — 5 drzew', done: true },
    { label: 'Frezowanie pni', done: false },
    { label: 'Uprzątnięcie i wywóz', done: false },
  ],
  documents: [
    { name: 'Oferta.pdf', meta: 'PDF · 240 kB', tone: 'olive' },
    { name: 'Umowa.pdf', meta: 'PDF · 180 kB', tone: 'green' },
    { name: 'Zdjęcia „przed”', meta: '4 pliki', tone: 'orange' },
  ],
});

const PUBLIC_STAGE = Object.freeze({
  Nowe: 0,
  Wycena_Terenowa: 1,
  Do_Zatwierdzenia: 1,
  Zaplanowane: 2,
  W_Realizacji: 3,
  Zakonczone: 4,
});

const STAGE_LABELS = Object.freeze([
  'Zlecenie przyjęte',
  'Wycena zaakceptowana',
  'Ekipa przydzielona',
  'Prace w toku',
  'Odbiór i rozliczenie',
]);

const STAGE_PROGRESS = Object.freeze([18, 36, 52, 68, 100]);

function formatDate(value, fallback = 'Termin do potwierdzenia') {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toLocaleDateString('pl-PL', { day: 'numeric', month: 'long' });
}

function formatTimelineTime(value) {
  if (!value) return 'status aktualny';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'status aktualny';
  return date.toLocaleString('pl-PL', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function initials(value) {
  const letters = String(value || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
  return letters || 'PF';
}

function stageTime(timeline, index, plannedDate) {
  const statusesByStage = [
    ['Nowe'],
    ['Wycena_Terenowa', 'Do_Zatwierdzenia'],
    ['Zaplanowane'],
    ['W_Realizacji'],
    ['Zakonczone'],
  ];
  const match = (timeline || []).find((event) => statusesByStage[index].includes(event.status));
  if (match?.at) return formatTimelineTime(match.at);
  if (index === 4 && plannedDate) return `planowane ${formatDate(plannedDate)}`;
  return index === 0 ? 'status przyjęty' : 'oczekuje';
}

export function mapTrackingPayload(payload) {
  const task = payload?.task || {};
  const timeline = Array.isArray(payload?.timeline) ? payload.timeline : [];
  const isCancelled = task.status === 'Anulowane';
  const currentStage = isCancelled ? 0 : (PUBLIC_STAGE[task.status] ?? 0);
  const teamName = task.team_visible || 'Ekipa zostanie potwierdzona';
  const service = task.service || 'Usługa terenowa';

  return {
    officePhone: task.branch?.phone || null,
    order: {
      id: `#${task.id || '—'}`,
      title: service,
      address: task.address || 'Adres zostanie potwierdzony',
      status: task.status_label || 'Status zlecenia',
      statusTone: isCancelled ? 'red' : task.status === 'Zakonczone' ? 'green' : 'orange',
      eta: task.planned_date_label || formatDate(task.planned_date),
      value: null,
      progress: isCancelled ? 0 : STAGE_PROGRESS[currentStage],
      progressLabel: isCancelled
        ? 'Realizacja anulowana'
        : `Etap ${currentStage + 1} z 5 · ${String(task.status_label || 'status aktualny').toLowerCase()}`,
    },
    team: {
      name: teamName,
      role: task.team_visible ? 'Przydzielona ekipa' : 'Obsługa zlecenia',
      size: task.branch?.name || 'Polska Flora',
      initials: initials(teamName),
      phone: task.branch?.phone || null,
      phoneLabel: 'Zadzwoń do biura',
    },
    steps: STAGE_LABELS.map((label, index) => ({
      label,
      time: stageTime(timeline, index, task.planned_date),
      state: index < currentStage ? 'done' : index === currentStage ? 'current' : 'next',
    })),
    scope: [{ label: service, done: task.status === 'Zakonczone' }],
    documents: [],
  };
}

function trackingEndpoint(token) {
  const configured = String(process.env.REACT_APP_API_URL || '').trim();
  if (/^https?:\/\//i.test(configured)) {
    try {
      const url = new URL(configured.replace(/\/api\/?$/i, ''));
      return `${url.origin}/track/${encodeURIComponent(token)}`;
    } catch {
      // Same-origin fallback below.
    }
  }
  return `/track/${encodeURIComponent(token)}`;
}

async function loadTrackingPortal(token, signal) {
  const response = await fetch(trackingEndpoint(token), {
    method: 'GET',
    headers: { Accept: 'application/json' },
    credentials: 'omit',
    cache: 'no-store',
    referrerPolicy: 'no-referrer',
    signal,
  });
  if (!response.ok) {
    const error = new Error(response.status === 404
      ? 'Link statusu jest nieprawidłowy albo wygasł.'
      : 'Nie udało się pobrać aktualnego statusu.');
    error.status = response.status;
    throw error;
  }
  return mapTrackingPayload(await response.json());
}

function PhoneIcon() {
  return <Phone aria-hidden="true" size={15} strokeWidth={2} />;
}

function PortalHeader({ phone }) {
  return (
    <header className="client-portal-header">
      <div className="client-portal-brand" aria-label="Polska Flora — Portal klienta">
        <BrandLogo background="light" className="client-portal-logo" />
        <span>Portal klienta</span>
      </div>
      {phone ? (
        <a className="client-portal-office-call" href={`tel:${phone}`}>
          <PhoneIcon />
          Biuro obsługi
        </a>
      ) : null}
    </header>
  );
}

function LoadingState() {
  return (
    <main className="client-portal-main" aria-busy="true">
      <section className="client-portal-state-card" role="status" aria-live="polite">
        <span className="client-portal-loader" aria-hidden="true" />
        <h1>Pobieramy status zlecenia</h1>
        <p>To potrwa tylko chwilę.</p>
      </section>
    </main>
  );
}

function ErrorState({ message }) {
  return (
    <main className="client-portal-main">
      <section className="client-portal-state-card" role="alert">
        <h1>Nie możemy otworzyć tego zlecenia</h1>
        <p>{message}</p>
        <a href="tel:+48221002030"><PhoneIcon /> Skontaktuj się z biurem obsługi</a>
      </section>
    </main>
  );
}

function PortalHero({ order }) {
  return (
    <section className="client-portal-hero" aria-labelledby="client-portal-order-title">
      <div className="client-portal-hero-top">
        <div>
          <p className="client-portal-order-number">Zlecenie {order.id}</p>
          <h1 id="client-portal-order-title">{order.title}</h1>
          <p className="client-portal-address">{order.address}</p>
        </div>
        <div className="client-portal-eta">
          <span className={`client-portal-status is-${order.statusTone}`}>{order.status}</span>
          <small>Planowany termin</small>
          <strong>{order.eta}</strong>
        </div>
      </div>
      <div
        className="client-portal-progress"
        role="progressbar"
        aria-label="Postęp realizacji"
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow={order.progress}
      >
        <span style={{ width: `${order.progress}%` }} />
      </div>
      <p className="client-portal-progress-label">{order.progressLabel}</p>
    </section>
  );
}

function TimelineCard({ steps }) {
  return (
    <section className="client-portal-card client-portal-timeline-card">
      <h2>Status realizacji</h2>
      <ol className="client-portal-timeline">
        {steps.map((step) => (
          <li className={`is-${step.state}`} key={step.label}>
            <span className="client-portal-step-track" aria-hidden="true">
              <span className="client-portal-step-dot">
                {step.state === 'done' ? <Check size={14} strokeWidth={3.2} /> : null}
                {step.state === 'current' ? <span /> : null}
              </span>
              <span className="client-portal-step-line" />
            </span>
            <span className="client-portal-step-copy">
              <strong>{step.label}</strong>
              <small>{step.time}</small>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function TeamCard({ team }) {
  return (
    <section className="client-portal-card client-portal-team-card">
      <h2>Twoja ekipa</h2>
      <div className="client-portal-team-person">
        <span className="client-portal-team-avatar" aria-hidden="true">{team.initials}</span>
        <span>
          <strong>{team.name}</strong>
          <small>{team.role} · {team.size}</small>
        </span>
      </div>
      {team.phone ? (
        <a className="client-portal-team-call" href={`tel:${team.phone}`}>
          <PhoneIcon />
          {team.phoneLabel}
        </a>
      ) : null}
    </section>
  );
}

function ScopeCard({ scope, value }) {
  return (
    <section className="client-portal-card client-portal-scope-card">
      <h2>Zakres prac</h2>
      <ul>
        {scope.map((item) => (
          <li key={item.label}>
            <span className={item.done ? 'is-done' : ''} aria-hidden="true">
              {item.done ? <Check size={11} strokeWidth={3.4} /> : null}
            </span>
            {item.label}
          </li>
        ))}
      </ul>
      {value ? (
        <div className="client-portal-order-value">
          <span>Wartość zlecenia</span>
          <strong>{value}</strong>
        </div>
      ) : null}
    </section>
  );
}

function DocumentsCard({ documents }) {
  if (!documents.length) return null;
  return (
    <section className="client-portal-card client-portal-documents-card">
      <h2>Dokumenty</h2>
      <div className="client-portal-documents">
        {documents.map((document) => (
          <article className="client-portal-document" key={document.name}>
            <span className={`client-portal-document-icon is-${document.tone}`} aria-hidden="true">
              <FileText size={18} strokeWidth={1.9} />
            </span>
            <span>
              <strong>{document.name}</strong>
              <small>{document.meta}</small>
            </span>
          </article>
        ))}
      </div>
    </section>
  );
}

export default function ClientPortal() {
  const { token } = useParams();
  const [portal, setPortal] = useState(() => (token ? null : DEMO_PORTAL));
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) {
      setPortal(DEMO_PORTAL);
      setError('');
      return undefined;
    }
    if (!TOKEN_PATTERN.test(token)) {
      setPortal(null);
      setError('Link statusu ma nieprawidłowy format. Sprawdź, czy został skopiowany w całości.');
      return undefined;
    }

    const controller = new AbortController();
    setPortal(null);
    setError('');
    loadTrackingPortal(token, controller.signal)
      .then(setPortal)
      .catch((loadError) => {
        if (loadError?.name !== 'AbortError') {
          setError(loadError?.message || 'Nie udało się pobrać aktualnego statusu.');
        }
      });
    return () => controller.abort();
  }, [token]);

  const officePhone = useMemo(
    () => portal?.officePhone || (!token ? '+48221002030' : null),
    [portal, token]
  );

  return (
    <div className="client-portal-shell">
      <PortalHeader phone={officePhone} />
      {error ? <ErrorState message={error} /> : null}
      {!error && !portal ? <LoadingState /> : null}
      {!error && portal ? (
        <main className="client-portal-main">
          <PortalHero order={portal.order} />
          <div className="client-portal-layout">
            <TimelineCard steps={portal.steps} />
            <div className="client-portal-side">
              <TeamCard team={portal.team} />
              <ScopeCard scope={portal.scope} value={portal.order.value} />
            </div>
          </div>
          <DocumentsCard documents={portal.documents} />
          <p className="client-portal-footer">
            Polska Flora · pielęgnacja i wycinka drzew · portal aktualizowany na żywo
          </p>
        </main>
      ) : null}
    </div>
  );
}
