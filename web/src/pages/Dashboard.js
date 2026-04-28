import { Fragment, useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import Sidebar from '../components/Sidebar';
import StatusMessage from '../components/StatusMessage';
import { getRolaColor } from '../theme';
import { getApiErrorMessage } from '../utils/apiError';
import { readStoredUser } from '../utils/readStoredUser';
import { getStoredToken, authHeaders } from '../utils/storedToken';

const STATUS_KOLOR = {
  Nowe: 'var(--accent)', Zaplanowane: 'var(--info)',
  W_Realizacji: 'var(--warning)', Zakonczone: '#047857', Anulowane: 'var(--danger)',
};
const STATUS_BG = {
  Nowe: 'var(--accent-surface)', Zaplanowane: 'rgba(112,182,255,0.16)',
  W_Realizacji: 'rgba(248,201,107,0.16)', Zakonczone: 'rgba(52,211,153,0.16)', Anulowane: 'rgba(255,127,169,0.16)',
};

function AnimatedNumber({ value, duration = 900 }) {
  const [display, setDisplay] = useState(0);
  const raf = useRef(null);
  useEffect(() => {
    const start = Date.now();
    const end = parseFloat(value) || 0;
    const tick = () => {
      const p = Math.min((Date.now() - start) / duration, 1);
      setDisplay(Math.round(end * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [value, duration]);
  return <span>{display.toLocaleString('pl-PL')}</span>;
}

// SVG ikony KPI i quick links
const KPI_ICONS = {
  nowe:       <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><line x1="9" y1="12" x2="15" y2="12"/></svg>,
  realizacja: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>,
  zakonczone: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>,
  wartosc:    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>,
};
const QL_ICONS = {
  '/nowe-zlecenie': <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>,
  '/kierownik':     <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>,
  '/ekipy':         <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  '/raporty':       <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>,
  '/flota':         <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="1" y="3" width="15" height="13" rx="2"/><path d="M16 8h4l3 5v3h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>,
  '/harmonogram':   <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
  '/oddzialy':      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>,
  '/uzytkownicy':   <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>,
  '/ksiegowosc':    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>,
  '/wycena-kalendarz': <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><rect x="7" y="14" width="4" height="4" rx="0.5"/></svg>,
  '/wynagrodzenie-wyceniajacych': <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>,
  '/zarzadzaj-rolami': <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>,
};

const QL_CHEVRON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

const CMD_ICONS = {
  zlecenia: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
      <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
      <rect x="9" y="3" width="6" height="4" rx="1" />
      <line x1="9" y1="12" x2="15" y2="12" />
    </svg>
  ),
  harmonogram: QL_ICONS['/harmonogram'],
  powiadomienia: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  ),
};

/** Wspólne style listy „inset” (KPI, centrum operacyjne). Kategorie skrótów web — ścieżki jak na mobilce. */
const WEB_QUICK_CAT_ORDER = ['operations', 'quotes', 'fleetMagazyn', 'reports', 'finance', 'administration'];

const WEB_QUICK_CAT_TITLE = {
  operations: 'Operacje i plan',
  quotes: 'Wyceny i teren',
  fleetMagazyn: 'Flota i sprzęt',
  reports: 'Raporty',
  finance: 'Finanse',
  administration: 'Administracja',
};

function webQuickCategory(path) {
  if (['/zarzadzaj-rolami', '/uzytkownicy', '/oddzialy'].includes(path)) return 'administration';
  if (path === '/ksiegowosc' || path === '/wynagrodzenie-wyceniajacych') return 'finance';
  if (path === '/raporty') return 'reports';
  if (path === '/wycena-kalendarz') return 'quotes';
  if (['/flota'].includes(path)) return 'fleetMagazyn';
  return 'operations';
}

const INSET_LIST = {
  group: {
    borderRadius: 12,
    overflow: 'hidden',
    border: '1px solid var(--border2)',
    background: 'var(--bg-deep)',
  },
  hairline: {
    height: 1,
    marginLeft: 56,
    background: 'var(--border2)',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    width: '100%',
    minHeight: 52,
    padding: '12px 14px',
    border: 'none',
    cursor: 'pointer',
    textAlign: 'left',
    font: 'inherit',
    color: 'inherit',
    transition: 'background 0.12s ease',
    boxSizing: 'border-box',
  },
  iconTile: {
    width: 32,
    height: 32,
    borderRadius: 8,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    color: 'var(--text-sub)',
    background: 'var(--bg-card2)',
    border: '1px solid var(--border2)',
  },
  rowTexts: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    alignItems: 'flex-start',
  },
  rowTitle: {
    fontSize: 16,
    fontWeight: 600,
    letterSpacing: '-0.02em',
    color: 'var(--text)',
    lineHeight: 1.25,
  },
  rowSub: {
    fontSize: 12,
    fontWeight: 500,
    color: 'var(--text-muted)',
    lineHeight: 1.3,
  },
  rowChevron: {
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    color: 'var(--text-muted)',
    opacity: 0.75,
  },
};

export default function Dashboard() {
  const [user, setUser] = useState(null);
  const [stats, setStats] = useState({ nowe: 0, w_realizacji: 0, zakonczone: 0 });
  const [ostatnie, setOstatnie] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [hovered, setHovered] = useState(null);
  const navigate = useNavigate();

  const loadAll = useCallback(async () => {
    try {
      setError('');
      const token = getStoredToken();
      const h = authHeaders(token);
      const [sRes, zRes] = await Promise.all([
        api.get('/tasks/stats', { headers: h }),
        api.get('/tasks/wszystkie', { headers: h }),
      ]);
      setStats(sRes.data);
      setOstatnie(Array.isArray(zRes.data) ? zRes.data.slice(0, 8) : []);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Nie udało się załadować danych dashboardu.'));
    }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (!getStoredToken()) { navigate('/'); return; }
    const u = readStoredUser();
    if (u) setUser(u);
    loadAll();
  }, [navigate, loadAll]);

  const isBrygadzista = user?.rola === 'Brygadzista';
  const isSpecjalista = user?.rola === 'Specjalista';
  const isWyceniajacy = user?.rola === 'Wyceniający';
  const isMagazynier  = user?.rola === 'Magazynier';
  const isPomocnik    = user?.rola === 'Pomocnik' || user?.rola === 'Pomocnik bez doświadczenia';
  const isWorker      = isBrygadzista || isSpecjalista || isPomocnik || isMagazynier;
  const sumaWartosci = ostatnie.reduce((s, z) => s + (parseFloat(z.wartosc_planowana) || 0), 0);
  const statusCounts = ostatnie.reduce((acc, z) => {
    const key = z.status || 'Nowe';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const dzisiaj = new Date().toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' });
  const rolaColor = getRolaColor(user?.rola);

  const kpiData = [
    { label: 'Nowe zlecenia', sub: 'Oczekują na przypisanie', value: stats.nowe || 0, icon: 'nowe', path: '/zlecenia' },
    { label: 'W realizacji', sub: 'Ekipy aktualnie w terenie', value: stats.w_realizacji || 0, icon: 'realizacja', path: '/zlecenia' },
    { label: 'Zakończone', sub: 'Zrealizowane zlecenia', value: stats.zakonczone || 0, icon: 'zakonczone', path: '/zlecenia' },
    ...(!isWorker && !isWyceniajacy
      ? [{ label: 'Wartość zleceń', sub: 'Łącznie w systemie', value: sumaWartosci, icon: 'wartosc', suffix: ' PLN', path: '/zlecenia' }]
      : []),
  ];

  const quickLinks = useMemo(() => [
    { label: 'Nowe zlecenie',  sub: 'Utwórz zlecenie',       path: '/nowe-zlecenie', color: 'var(--accent)', roles: ['Dyrektor','Administrator','Kierownik'] },
    { label: 'Planowanie',     sub: 'Przypisz ekipy',         path: '/kierownik',     color: 'var(--accent)', roles: ['Dyrektor','Administrator','Kierownik'] },
    { label: 'Ekipy',          sub: 'Zarządzaj ekipami',      path: '/ekipy',         color: 'var(--accent)', roles: ['Dyrektor','Administrator','Kierownik'] },
    { label: 'Raporty',        sub: 'Analiza wydajności',     path: '/raporty',           color: 'var(--accent-dk)', roles: ['Dyrektor','Administrator','Kierownik','Brygadzista','Specjalista'] },
    { label: 'Flota i sprzęt', sub: 'Pojazdy i narzędzia',   path: '/flota',             color: '#FBBF24', roles: ['Dyrektor','Administrator','Kierownik','Brygadzista','Magazynier'] },
    { label: 'Harmonogram',    sub: 'Kalendarz zleceń',       path: '/harmonogram',       color: '#60A5FA', roles: ['Dyrektor','Administrator','Kierownik','Brygadzista','Specjalista','Magazynier'] },
    { label: 'Wyceny',         sub: 'Kalendarz, oględziny, zatwierdzanie', path: '/wycena-kalendarz',  color: 'var(--accent)', roles: ['Wyceniający','Specjalista','Kierownik','Dyrektor','Administrator'] },
    { label: 'Rozliczenie wyc.', sub: 'Stawka + % realizacji', path: '/wynagrodzenie-wyceniajacych', color: '#34D399', roles: ['Wyceniający','Kierownik','Dyrektor','Administrator'] },
    { label: 'Oddziały',       sub: 'Zarządzanie',            path: '/oddzialy',          color: '#60A5FA', roles: ['Dyrektor','Administrator'] },
    { label: 'Użytkownicy',    sub: 'Konta i uprawnienia',    path: '/uzytkownicy',       color: '#F87171', roles: ['Dyrektor','Administrator'] },
    { label: 'Role',           sub: 'Uprawnienia pracowników',path: '/zarzadzaj-rolami',  color: '#F59E0B', roles: ['Dyrektor','Administrator'] },
    { label: 'Księgowość',     sub: 'Faktury i rozliczenia',  path: '/ksiegowosc',        color: '#FBBF24', roles: ['Dyrektor','Administrator','Kierownik'] },
  ].filter(i => i.roles.includes(user?.rola)), [user?.rola]);

  const quickLinkSections = useMemo(() => {
    const by = Object.fromEntries(WEB_QUICK_CAT_ORDER.map((k) => [k, []]));
    for (const item of quickLinks) {
      const c = webQuickCategory(item.path);
      (by[c] ?? by.operations).push(item);
    }
    return WEB_QUICK_CAT_ORDER
      .filter((k) => by[k].length > 0)
      .map((key) => ({
        key,
        title: WEB_QUICK_CAT_TITLE[key],
        items: by[key],
      }));
  }, [quickLinks]);

  return (
    <div style={d.root}>
      <Sidebar />
      <div style={d.content}>
        <StatusMessage message={error || ''} tone={error ? 'error' : undefined} style={d.errorBanner} />

        {/* ─── HERO HEADER ─────────────────────────────────────────────────── */}
        <div style={d.hero}>
          <div style={d.heroBg} />
          <div style={d.heroLeft}>
            <div style={d.heroGreeting}>Dzień dobry, {user?.imie}</div>
            <div style={d.heroDate}>{dzisiaj}</div>
            <div style={{ ...d.rolaBadge, background: rolaColor + '22', color: rolaColor }}>
              {user?.rola}{user?.oddzial_nazwa ? ` · ${user.oddzial_nazwa}` : ''}
            </div>
          </div>
          {!isBrygadzista && !isWyceniajacy && (
            <button onClick={() => navigate('/nowe-zlecenie')} style={d.heroBtn}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--accent-dk)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'var(--accent)'; }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Nowe zlecenie
            </button>
          )}
        </div>

        {/* ─── KPI (grupa inset, jak iOS) ───────────────────────────────────── */}
        {!isWyceniajacy && (
          <div style={d.kpiSection}>
            <div style={d.insetGroup}>
              {kpiData.map((k, i) => (
                <Fragment key={k.label}>
                  {i > 0 ? <div style={d.insetHairline} /> : null}
                  <button
                    type="button"
                    disabled={!k.path}
                    onClick={() => k.path && navigate(k.path)}
                    onMouseEnter={() => k.path && setHovered(`kpi${i}`)}
                    onMouseLeave={() => setHovered(null)}
                    style={{
                      ...d.insetRow,
                      cursor: k.path ? 'pointer' : 'default',
                      opacity: k.path ? 1 : 0.92,
                      background: hovered === `kpi${i}` && k.path ? 'rgba(255,255,255,0.06)' : 'var(--bg-deep)',
                    }}
                  >
                    <span style={d.insetIconTile}>{KPI_ICONS[k.icon]}</span>
                    <span style={d.insetRowTexts}>
                      <span style={d.insetRowTitle}>{k.label}</span>
                      <span style={d.insetRowSub}>{k.sub}</span>
                    </span>
                    <span style={d.kpiValue}>
                      <AnimatedNumber value={k.value} />
                      {k.suffix || ''}
                    </span>
                  </button>
                </Fragment>
              ))}
            </div>
          </div>
        )}

        <div style={d.commandGrid}>
          <div style={d.commandCard}>
            <div style={d.commandTitle}>Centrum operacyjne</div>
            <div style={d.commandText}>Priorytetowe akcje na teraz</div>
            <div style={d.insetGroupLift}>
              {[
                { label: 'Zarządzaj zleceniami', sub: 'Lista i statusy zleceń', path: '/zlecenia', icon: 'zlecenia' },
                { label: 'Sprawdź harmonogram', sub: 'Plan dnia i ekip', path: '/harmonogram', icon: 'harmonogram' },
                { label: 'Powiadomienia', sub: 'Alerty systemowe', path: '/powiadomienia', icon: 'powiadomienia' },
              ].map((row, i) => (
                <Fragment key={row.path}>
                  {i > 0 ? <div style={d.insetHairline} /> : null}
                  <button
                    type="button"
                    onClick={() => navigate(row.path)}
                    onMouseEnter={() => setHovered(`cmd${i}`)}
                    onMouseLeave={() => setHovered(null)}
                    style={{
                      ...d.insetRow,
                      background: hovered === `cmd${i}` ? 'rgba(255,255,255,0.06)' : 'var(--bg-deep)',
                    }}
                  >
                    <span style={d.insetIconTile}>{CMD_ICONS[row.icon]}</span>
                    <span style={d.insetRowTexts}>
                      <span style={d.insetRowTitle}>{row.label}</span>
                      <span style={d.insetRowSub}>{row.sub}</span>
                    </span>
                    <span style={d.insetRowChevron}>{QL_CHEVRON}</span>
                  </button>
                </Fragment>
              ))}
            </div>
          </div>
          <div style={d.commandCard}>
            <div style={d.commandTitle}>Pipeline live</div>
            <div style={d.commandText}>Zlecenia w ostatniej próbce (max 8)</div>
            <div style={d.insetGroupLift}>
              {[
                { label: 'Nowe', value: statusCounts.Nowe || 0 },
                { label: 'Zaplanowane', value: statusCounts.Zaplanowane || 0 },
                { label: 'W realizacji', value: statusCounts.W_Realizacji || 0 },
                { label: 'Zakończone', value: statusCounts.Zakonczone || 0 },
              ].map((row, i) => (
                <Fragment key={row.label}>
                  {i > 0 ? <div style={d.pipeHairline} /> : null}
                  <div style={d.pipeRow}>
                    <span style={d.pipeLabel}>{row.label}</span>
                    <span style={d.pipeValue}>{row.value}</span>
                  </div>
                </Fragment>
              ))}
            </div>
          </div>
        </div>

        {/* ─── GŁÓWNA SIATKA ───────────────────────────────────────────────── */}
        <div style={d.mainGrid}>

          {/* Ostatnie zlecenia */}
          {!isWyceniajacy && (
            <div style={d.card}>
              <div style={d.cardHeader}>
                <span style={d.cardTitle}>{isBrygadzista ? 'Moje zlecenia' : 'Ostatnie zlecenia'}</span>
                <button onClick={() => navigate('/zlecenia')} style={d.seeAll}>
                  Wszystkie
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="9 18 15 12 9 6"/></svg>
                </button>
              </div>

              {loading ? (
                <div style={d.emptyState}>
                  <div style={d.spinner} />
                  <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 12 }}>Ładowanie...</p>
                </div>
              ) : ostatnie.length === 0 ? (
                <div style={d.emptyState}>
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#334155" strokeWidth="1.5" strokeLinecap="round"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/></svg>
                  <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 8 }}>Brak zleceń</p>
                </div>
              ) : ostatnie.map((z, i) => (
                <div key={z.id}
                  onClick={() => navigate(`/zlecenia/${z.id}`)}
                  onMouseEnter={() => setHovered(`z${z.id}`)}
                  onMouseLeave={() => setHovered(null)}
                  style={{ ...d.zRow, borderLeftColor: STATUS_KOLOR[z.status] || '#334155',
                    background: hovered === `z${z.id}` ? 'rgba(255,255,255,0.04)' : 'transparent' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={d.zKlient}>{z.klient_nazwa}</div>
                    <div style={d.zMeta}>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#64748B" strokeWidth="2" strokeLinecap="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                      {z.adres}{z.typ_uslugi ? ` · ${z.typ_uslugi}` : ''}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <span style={{ ...d.statusBadge, background: STATUS_BG[z.status], color: STATUS_KOLOR[z.status] || '#94A3B8' }}>
                      {z.status?.replace('_', ' ')}
                    </span>
                    {!isBrygadzista && z.wartosc_planowana && (
                      <div style={d.zWartosc}>{parseFloat(z.wartosc_planowana).toLocaleString('pl-PL')} PLN</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Szybki dostęp — kategorie + listy inset (iOS) */}
          <div style={{ ...d.card, ...(isWyceniajacy ? { gridColumn: '1 / -1' } : {}) }}>
            <div style={d.cardHeader}>
              <span style={d.cardTitle}>Szybki dostęp</span>
            </div>
            {quickLinks.length === 0 ? (
              <div style={d.qlEmpty}>Brak skrótów dla tej roli.</div>
            ) : (
              quickLinkSections.map((sec, si) => (
                <div key={sec.key} style={si === 0 ? d.quickSectionWrapFirst : d.quickSectionWrap}>
                  <div style={d.quickSectionTitle}>{sec.title}</div>
                  <div style={d.insetGroup}>
                    {sec.items.map((item, i) => (
                      <Fragment key={`${sec.key}-${item.path}-${i}`}>
                        {i > 0 ? <div style={d.insetHairline} /> : null}
                        <button
                          type="button"
                          onClick={() => navigate(item.path)}
                          onMouseEnter={() => setHovered(`ql-${sec.key}-${i}`)}
                          onMouseLeave={() => setHovered(null)}
                          style={{
                            ...d.insetRow,
                            background: hovered === `ql-${sec.key}-${i}` ? 'rgba(255,255,255,0.06)' : 'var(--bg-deep)',
                          }}
                        >
                          <span style={d.insetIconTile}>
                            {QL_ICONS[item.path] || (
                              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                                <circle cx="12" cy="12" r="10" />
                              </svg>
                            )}
                          </span>
                          <span style={d.insetRowTexts}>
                            <span style={d.insetRowTitle}>{item.label}</span>
                            <span style={d.insetRowSub}>{item.sub}</span>
                          </span>
                          <span style={d.insetRowChevron}>{QL_CHEVRON}</span>
                        </button>
                      </Fragment>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const d = {
  root: { display: 'flex', minHeight: '100vh', background: 'linear-gradient(180deg, var(--bg) 0%, var(--bg-deep) 100%)' },
  content: { flex: 1, padding: '28px 32px', overflowX: 'hidden', minWidth: 0, position: 'relative' },
  errorBanner: {
    padding: '10px 14px',
    borderRadius: 10,
    border: '1px solid #EF9A9A',
    background: '#FFEBEE',
    color: '#C62828',
    marginBottom: 16,
    fontSize: 14,
    fontWeight: 600,
  },

  // Hero
  hero: {
    position: 'relative', borderRadius: 20, padding: '28px 32px', marginBottom: 24,
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    background: 'linear-gradient(145deg, var(--bg-card) 0%, var(--bg-card2) 100%)',
    border: '1px solid var(--border2)', overflow: 'hidden',
    boxShadow: 'var(--shadow-md)',
  },
  heroBg: {
    position: 'absolute', top: -60, right: -60, width: 200, height: 200,
    borderRadius: '50%', background: 'radial-gradient(circle, rgba(52,211,153,0.14) 0%, transparent 70%)',
    pointerEvents: 'none',
  },
  heroLeft: { position: 'relative' },
  heroGreeting: { fontSize: 26, fontWeight: 800, color: 'var(--text)', marginBottom: 4 },
  heroDate: { fontSize: 13, color: 'var(--text-muted)', marginBottom: 12, textTransform: 'capitalize' },
  rolaBadge: { display: 'inline-block', borderRadius: 20, padding: '4px 14px', fontSize: 12, fontWeight: 700 },
  heroBtn: {
    display: 'flex', alignItems: 'center', gap: 8, padding: '12px 20px',
    background: 'var(--accent)', color: 'var(--on-accent)', border: '1px solid var(--border2)', borderRadius: 12,
    fontSize: 14, fontWeight: 700, cursor: 'pointer', transition: 'background 0.2s',
    position: 'relative', flexShrink: 0, boxShadow: 'var(--shadow-sm)',
  },

  kpiSection: { marginBottom: 24 },
  kpiValue: {
    flexShrink: 0,
    minWidth: 56,
    textAlign: 'right',
    fontSize: 20,
    fontWeight: 650,
    letterSpacing: '-0.03em',
    fontVariantNumeric: 'tabular-nums',
    color: 'var(--text)',
  },
  insetGroup: INSET_LIST.group,
  insetGroupLift: { ...INSET_LIST.group, marginTop: 12 },
  insetHairline: INSET_LIST.hairline,
  insetRow: INSET_LIST.row,
  insetIconTile: INSET_LIST.iconTile,
  insetRowTexts: INSET_LIST.rowTexts,
  insetRowTitle: INSET_LIST.rowTitle,
  insetRowSub: INSET_LIST.rowSub,
  insetRowChevron: INSET_LIST.rowChevron,
  pipeHairline: {
    height: 1,
    marginLeft: 14,
    marginRight: 14,
    background: 'var(--border2)',
  },
  pipeRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 48,
    padding: '11px 14px',
    background: 'var(--bg-deep)',
  },
  pipeLabel: { fontSize: 15, fontWeight: 500, color: 'var(--text-sub)' },
  pipeValue: {
    fontSize: 17,
    fontWeight: 600,
    letterSpacing: '-0.02em',
    fontVariantNumeric: 'tabular-nums',
    color: 'var(--text)',
  },
  commandGrid: { display: 'grid', gridTemplateColumns: '1.3fr .9fr', gap: 16, marginBottom: 20 },
  commandCard: {
    background: 'linear-gradient(145deg, var(--bg-card) 0%, var(--bg-card2) 100%)',
    border: '1px solid var(--border2)',
    borderRadius: 16,
    padding: 18,
    boxShadow: 'var(--shadow-sm)',
  },
  commandTitle: { fontSize: 16, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text)' },
  commandText: { marginTop: 4, fontSize: 12, fontWeight: 500, color: 'var(--text-muted)' },

  // Main grid
  mainGrid: { display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 20 },
  card: {
    background: 'linear-gradient(150deg, var(--bg-card) 0%, var(--bg-card2) 100%)',
    borderRadius: 18, padding: 20, border: '1px solid var(--border2)', boxShadow: 'var(--shadow-sm)'
  },
  cardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  cardTitle: { fontSize: 15, fontWeight: 700, color: 'var(--text)' },
  seeAll: { fontSize: 12, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 },

  emptyState: { display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '32px 0' },
  spinner: { width: 28, height: 28, border: '2px solid var(--border2)', borderTop: '2px solid #34D399', borderRadius: '50%', animation: 'spin 0.8s linear infinite' },

  // Zlecenia
  zRow: {
    display: 'flex', alignItems: 'center', padding: '10px 10px 10px 14px',
    borderLeft: '3px solid #334155', borderRadius: '0 10px 10px 0',
    marginBottom: 6, cursor: 'pointer', transition: 'all 0.15s',
  },
  zKlient: { fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  zMeta: { fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 },
  statusBadge: { fontSize: 11, fontWeight: 700, borderRadius: 8, padding: '3px 10px', display: 'inline-block', marginBottom: 3 },
  zWartosc: { fontSize: 12, fontWeight: 700, color: 'var(--accent)' },

  qlEmpty: {
    padding: '18px 14px',
    fontSize: 13,
    color: 'var(--text-muted)',
    textAlign: 'center',
  },
  quickSectionWrapFirst: { marginTop: 8 },
  quickSectionWrap: { marginTop: 20 },
  quickSectionTitle: {
    fontSize: 12,
    fontWeight: 700,
    color: 'var(--text-muted)',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    marginBottom: 8,
    marginLeft: 2,
  },
};
