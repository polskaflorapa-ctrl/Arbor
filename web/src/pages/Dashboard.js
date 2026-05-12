import { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import Sidebar from '../components/Sidebar';
import StatusMessage from '../components/StatusMessage';
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
const SALES_DIRECTOR_ROLES = ['Dyrektor Sprzedazy', 'Dyrektor Sprzedaży', 'Dyrektor dzialu sprzedaz', 'Dyrektor działu sprzedaż'];

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
  '/misja-dnia':    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/><path d="M6 19h4"/></svg>,
  '/autoplan-dnia': <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 15c4-8 12-8 16 0"/><path d="M8 15c2-4 6-4 8 0"/><circle cx="12" cy="16" r="2"/><path d="M12 4v3"/><path d="M4.9 6.9l2.1 2.1"/><path d="M19.1 6.9 17 9"/></svg>,
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
  if (['/flota', '/magazyn', '/rezerwacje-sprzetu'].includes(path)) return 'fleetMagazyn';
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
    letterSpacing: '0',
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
  const [payrollClose, setPayrollClose] = useState({
    export_allowed: true,
    pending_count: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [hovered, setHovered] = useState(null);
  const [viewportWidth, setViewportWidth] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 1280));
  const navigate = useNavigate();

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

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
      try {
        const month = new Date().toISOString().slice(0, 7);
        const pRes = await api.get('/payroll/month-close-status', {
          headers: h,
          params: { month },
        });
        setPayrollClose({
          export_allowed: pRes.data?.export_allowed !== false,
          pending_count: Number(pRes.data?.pending_count) || 0,
        });
      } catch {
        setPayrollClose({ export_allowed: true, pending_count: 0 });
      }
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
  const canCreateTasks = ['Prezes', 'Dyrektor', 'Kierownik'].includes(user?.rola);
  const canSeePayroll = ['Prezes', 'Dyrektor', 'Kierownik'].includes(user?.rola);
  const isCompact = viewportWidth < 720;
  const isNarrow = viewportWidth < 1120;
  const sumaWartosci = ostatnie.reduce((s, z) => s + (parseFloat(z.wartosc_planowana) || 0), 0);
  const statusCounts = ostatnie.reduce((acc, z) => {
    const key = z.status || 'Nowe';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const dzisiaj = new Date().toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' });

  const kpiData = [
    { label: 'Nowe zlecenia', sub: 'Oczekują na przypisanie', value: stats.nowe || 0, icon: 'nowe', path: '/zlecenia' },
    { label: 'W realizacji', sub: 'Ekipy aktualnie w terenie', value: stats.w_realizacji || 0, icon: 'realizacja', path: '/zlecenia' },
    { label: 'Zakończone', sub: 'Zrealizowane zlecenia', value: stats.zakonczone || 0, icon: 'zakonczone', path: '/zlecenia' },
    ...(!isWorker && !isWyceniajacy
      ? [{ label: 'Wartość zleceń', sub: 'Łącznie w systemie', value: sumaWartosci, icon: 'wartosc', suffix: ' PLN', path: '/zlecenia' }]
      : []),
    ...(canSeePayroll
      ? [{
          label: payrollClose.export_allowed ? 'Payroll: eksport OK' : 'Payroll: eksport zablokowany',
          sub: payrollClose.export_allowed
            ? 'Miesiąc gotowy do eksportu'
            : `Brakuje raportów dnia: ${payrollClose.pending_count}`,
          value: payrollClose.pending_count,
          icon: payrollClose.export_allowed ? 'zakonczone' : 'realizacja',
          path: '/rozliczenia-ekip',
        }]
      : []),
  ];

  const quickLinks = useMemo(() => [
    { label: 'Misja dnia',     sub: 'Dzisiejszy plan, postęp i aktywne tematy', path: '/misja-dnia', color: 'var(--accent)', roles: ['Prezes','Dyrektor',...SALES_DIRECTOR_ROLES,'Kierownik','Brygadzista','Specjalista','Pomocnik','Pomocnik bez doświadczenia','Wyceniający','Magazynier'] },
    { label: 'Autoplan dnia',  sub: 'Warianty przypisań ekip i szybkie apply', path: '/autoplan-dnia', color: '#22D3EE', roles: ['Prezes','Dyrektor','Kierownik','Brygadzista','Specjalista'] },
    { label: 'Nowe zlecenie',  sub: 'Utwórz zlecenie',       path: '/nowe-zlecenie', color: 'var(--accent)', roles: ['Prezes','Dyrektor','Kierownik'] },
    { label: 'Planowanie',     sub: 'Przypisz ekipy',         path: '/kierownik',     color: 'var(--accent)', roles: ['Prezes','Dyrektor','Kierownik'] },
    { label: 'Ekipy',          sub: 'Zarządzaj ekipami',      path: '/ekipy',         color: 'var(--accent)', roles: ['Prezes','Dyrektor','Kierownik'] },
    { label: 'Raporty',        sub: 'Analiza wydajności',     path: '/raporty',           color: 'var(--accent-dk)', roles: ['Prezes','Dyrektor','Kierownik','Brygadzista','Specjalista'] },
    { label: 'Flota i sprzęt', sub: 'Pojazdy i narzędzia',   path: '/flota',             color: '#FBBF24', roles: ['Prezes','Dyrektor','Kierownik','Brygadzista','Magazynier'] },
    { label: 'Magazyn',        sub: 'Stan lokalny (jak w aplikacji mobilnej)', path: '/magazyn', color: '#A3E635', roles: ['Prezes','Dyrektor','Kierownik','Brygadzista','Magazynier'] },
    { label: 'Rezerwacje sprzętu', sub: 'Kalendarz rezerwacji', path: '/rezerwacje-sprzetu', color: '#22D3EE', roles: ['Prezes','Dyrektor','Kierownik','Brygadzista','Magazynier'] },
    { label: 'Harmonogram',    sub: 'Kalendarz zleceń',       path: '/harmonogram',       color: '#60A5FA', roles: ['Prezes','Dyrektor',...SALES_DIRECTOR_ROLES,'Kierownik','Brygadzista','Specjalista','Magazynier'] },
    { label: 'Wyceny',         sub: 'Kalendarz, oględziny, zatwierdzanie', path: '/wycena-kalendarz',  color: 'var(--accent)', roles: ['Wyceniający','Specjalista','Kierownik','Prezes','Dyrektor'] },
    { label: 'Rozliczenie wyc.', sub: 'Stawka + % realizacji', path: '/wynagrodzenie-wyceniajacych', color: '#34D399', roles: ['Wyceniający','Kierownik','Prezes','Dyrektor'] },
    { label: 'Oddziały',       sub: 'Zarządzanie',            path: '/oddzialy',          color: '#60A5FA', roles: ['Prezes','Dyrektor'] },
    { label: 'Użytkownicy',    sub: 'Konta i uprawnienia',    path: '/uzytkownicy',       color: '#F87171', roles: ['Prezes','Dyrektor','Dyrektor Sprzedazy','Dyrektor Sprzedaży','Dyrektor dzialu sprzedaz','Dyrektor działu sprzedaż'] },
    { label: 'Role',           sub: 'Uprawnienia pracowników',path: '/zarzadzaj-rolami',  color: '#F59E0B', roles: ['Prezes','Dyrektor'] },
    { label: 'Księgowość',     sub: 'Faktury i rozliczenia',  path: '/ksiegowosc',        color: '#FBBF24', roles: ['Prezes','Dyrektor','Kierownik'] },
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

  const formatMoney = (value) => `${(Number(value) || 0).toLocaleString('pl-PL')} PLN`;
  const statusLabel = (value) => String(value || 'Nowe').replace('_', ' ');
  const shortDate = (value) => {
    if (!value) return 'Brak terminu';
    try {
      return new Date(value).toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit' });
    } catch {
      return 'Brak terminu';
    }
  };

  const dashboardKpis = kpiData.slice(0, 6).map((item, index) => ({
    ...item,
    tone: ['var(--warning)', 'var(--info)', 'var(--success)', 'var(--accent)', '#eab308', '#fb7185'][index] || 'var(--accent)',
    trend: index === 0 ? 'otwarte tematy' : index === 1 ? 'teren dzisiaj' : index === 2 ? 'zamknięte' : index === 3 ? 'wartość' : 'status',
  }));

  const teamRanking = useMemo(() => {
    const map = new Map();
    for (const z of ostatnie) {
      const name = z.ekipa_nazwa || z.ekipa || 'Bez przypisanej ekipy';
      const prev = map.get(name) || { name, count: 0, value: 0, branch: z.miasto || z.oddzial_nazwa || '' };
      prev.count += 1;
      prev.value += Number(z.wartosc_rzeczywista || z.wartosc_planowana || 0);
      if (!prev.branch) prev.branch = z.miasto || z.oddzial_nazwa || '';
      map.set(name, prev);
    }
    return Array.from(map.values())
      .sort((a, b) => b.value - a.value || b.count - a.count)
      .slice(0, 5);
  }, [ostatnie]);

  const scheduleItems = useMemo(() => [...ostatnie]
    .sort((a, b) => new Date(a.data_planowana || a.data_zaplanowana || 0) - new Date(b.data_planowana || b.data_zaplanowana || 0))
    .slice(0, 6), [ostatnie]);

  const alertItems = [
    {
      title: payrollClose.export_allowed ? 'Payroll gotowy do eksportu' : 'Payroll wymaga raportów',
      sub: payrollClose.export_allowed ? 'Miesiąc można zamykać bez blokad.' : `Brakuje raportów dnia: ${payrollClose.pending_count}`,
      tone: payrollClose.export_allowed ? 'ok' : 'warn',
    },
    {
      title: `${statusCounts.Nowe || 0} nowych zleceń`,
      sub: 'Tematy czekające na przypisanie lub pierwszą decyzję.',
      tone: (statusCounts.Nowe || 0) > 0 ? 'info' : 'ok',
    },
    {
      title: `${statusCounts.W_Realizacji || 0} prac w terenie`,
      sub: 'Aktywne zlecenia do pilnowania operacyjnego.',
      tone: 'field',
    },
  ];

  const opsIndicators = [
    { label: 'Wykonanie zleceń', value: stats.zakonczone || 0, total: Math.max((stats.nowe || 0) + (stats.w_realizacji || 0) + (stats.zakonczone || 0), 1) },
    { label: 'Prace w toku', value: stats.w_realizacji || 0, total: Math.max((stats.nowe || 0) + (stats.w_realizacji || 0), 1) },
    { label: 'Gotowość payroll', value: payrollClose.export_allowed ? 1 : 0, total: 1 },
  ];

  return (
    <div style={d.root}>
      <Sidebar />
      <div style={{ ...d.content, ...(isCompact ? d.contentCompact : {}) }}>
        <StatusMessage message={error || ''} tone={error ? 'error' : undefined} style={d.errorBanner} />

        <header style={{ ...d.topBar, ...(isCompact ? d.topBarCompact : {}) }}>
          <div style={d.topTitleGroup}>
            <div style={d.pageTitle}>Dashboard</div>
            <div style={d.topMeta}>
              {dzisiaj} · {user?.rola || 'Użytkownik'}{user?.oddzial_nazwa ? ` · ${user.oddzial_nazwa}` : ''}
            </div>
          </div>
          <div style={{ ...d.topActions, ...(isCompact ? d.topActionsCompact : {}) }}>
            <button type="button" onClick={() => navigate('/misja-dnia')} style={d.secondaryAction}>
              {QL_ICONS['/misja-dnia']}
              Misja dnia
            </button>
            {canCreateTasks && (
              <button type="button" onClick={() => navigate('/nowe-zlecenie')} style={d.primaryAction}>
                {QL_ICONS['/nowe-zlecenie']}
                Nowe zlecenie
              </button>
            )}
          </div>
        </header>

        {!isWyceniajacy && (
          <section style={{ ...d.kpiGrid, ...(isNarrow ? d.kpiGridNarrow : {}), ...(isCompact ? d.kpiGridCompact : {}) }}>
            {dashboardKpis.map((k, i) => (
              <button
                key={k.label}
                type="button"
                disabled={!k.path}
                onClick={() => k.path && navigate(k.path)}
                onMouseEnter={() => setHovered(`kpiCard${i}`)}
                onMouseLeave={() => setHovered(null)}
                style={{
                  ...d.kpiCard,
                  ...(hovered === `kpiCard${i}` ? d.kpiCardHover : {}),
                }}
              >
                <span style={{ ...d.kpiIcon, color: k.tone, borderColor: `${k.tone}55`, background: `${k.tone}18` }}>
                  {KPI_ICONS[k.icon]}
                </span>
                <span style={d.kpiCardBody}>
                  <span style={d.kpiCardLabel}>{k.label}</span>
                  <span style={d.kpiCardValue}>
                    {k.suffix ? formatMoney(k.value) : k.label.startsWith('Payroll') ? (payrollClose.export_allowed ? 'OK' : k.value) : <AnimatedNumber value={k.value} />}
                  </span>
                  <span style={d.kpiCardTrend}>{k.sub}</span>
                </span>
              </button>
            ))}
          </section>
        )}

        <section style={{ ...d.boardGrid, ...(isNarrow ? d.gridSingle : {}) }}>
          <div style={d.panel}>
            <div style={d.panelHeader}>
              <div>
                <div style={d.panelTitle}>{isBrygadzista ? 'Moje zlecenia' : 'Ostatnie zlecenia'}</div>
                <div style={d.panelSub}>Najświeższe tematy operacyjne</div>
              </div>
              <button type="button" onClick={() => navigate('/zlecenia')} style={d.panelLink}>Zobacz wszystkie</button>
            </div>
            {loading ? (
              <div style={d.emptyState}><div style={d.spinner} /></div>
            ) : ostatnie.length === 0 ? (
              <div style={d.emptyState}>Brak zleceń</div>
            ) : (
              <div style={d.table}>
                <div style={{ ...d.tableRow, ...d.tableHead }}>
                  <span>ID</span><span>Klient</span><span>Lokalizacja</span><span>Status</span><span>Termin</span><span>Wartość</span>
                </div>
                {ostatnie.slice(0, 6).map((z) => (
                  <button
                    key={z.id}
                    type="button"
                    onClick={() => navigate(`/zlecenia/${z.id}`)}
                    style={d.tableRow}
                  >
                    <span style={d.tableCode}>#{z.id}</span>
                    <span style={d.tableStrong}>{z.klient_nazwa || 'Klient'}</span>
                    <span>{z.miasto || z.oddzial_nazwa || '-'}</span>
                    <span style={{ ...d.statusBadge, background: STATUS_BG[z.status], color: STATUS_KOLOR[z.status] || 'var(--text-sub)' }}>{statusLabel(z.status)}</span>
                    <span>{shortDate(z.data_planowana || z.data_zaplanowana)}</span>
                    <span style={d.tableMoney}>{formatMoney(z.wartosc_planowana || z.wartosc_rzeczywista)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div style={d.panel}>
            <div style={d.panelHeader}>
              <div>
                <div style={d.panelTitle}>Ranking brygad</div>
                <div style={d.panelSub}>Najlepsze ekipy z widocznych zleceń</div>
              </div>
              <button type="button" onClick={() => navigate('/ranking-brygad')} style={d.panelLink}>Raport</button>
            </div>
            <div style={d.rankList}>
              {(teamRanking.length ? teamRanking : [{ name: 'Brak danych', count: 0, value: 0, branch: '' }]).map((team, index) => (
                <button key={`${team.name}-${index}`} type="button" onClick={() => navigate('/ranking-brygad')} style={d.rankRow}>
                  <span style={{ ...d.rankPlace, ...(index === 0 ? d.rankPlaceLead : {}) }}>{index + 1}</span>
                  <span style={d.rankLeaf}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                      <path d="M12 22V12M12 12C12 7 7 3 3 3c0 4 2 8 5 10M12 12C12 7 17 3 21 3c0 4-2 8-5 10"/>
                    </svg>
                  </span>
                  <span style={d.rankName}>
                    <strong>{team.name}</strong>
                    <small>{team.branch || 'Oddział'}</small>
                  </span>
                  <span style={d.rankMetric}>{team.count}</span>
                  <span style={d.rankMetric}>{formatMoney(team.value)}</span>
                </button>
              ))}
            </div>
          </div>
        </section>

        <section style={{ ...d.lowerGrid, ...(isNarrow ? d.gridSingle : {}) }}>
          <div style={d.panel}>
            <div style={d.panelTitle}>Harmonogram prac</div>
            <div style={d.timeline}>
              {scheduleItems.length === 0 ? <div style={d.emptyLine}>Brak zaplanowanych zleceń.</div> : scheduleItems.map((z) => (
                <button key={`sch-${z.id}`} type="button" onClick={() => navigate(`/zlecenia/${z.id}`)} style={d.timelineRow}>
                  <span style={d.timelineDate}>{shortDate(z.data_planowana || z.data_zaplanowana)}</span>
                  <span style={d.timelineName}>{z.typ_uslugi || z.klient_nazwa || 'Zlecenie'}</span>
                  <span style={d.timelineBranch}>{z.miasto || z.oddzial_nazwa || '-'}</span>
                </button>
              ))}
            </div>
          </div>

          <div style={d.panel}>
            <div style={d.panelTitle}>Alerty i powiadomienia</div>
            <div style={d.alertList}>
              {alertItems.map((item) => (
                <div key={item.title} style={d.alertRow}>
                  <span style={{ ...d.alertDot, ...(item.tone === 'warn' ? d.alertWarn : item.tone === 'ok' ? d.alertOk : d.alertInfo) }} />
                  <span>
                    <strong>{item.title}</strong>
                    <small>{item.sub}</small>
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div style={d.panel}>
            <div style={d.panelHeader}>
              <div style={d.panelTitle}>Wskaźniki operacyjne</div>
              <button type="button" onClick={() => navigate('/raporty')} style={d.panelLink}>Raporty</button>
            </div>
            <div style={d.opsList}>
              {opsIndicators.map((item) => {
                const pct = Math.min(100, Math.round((item.value / item.total) * 100));
                return (
                  <div key={item.label} style={d.opsRow}>
                    <span>{item.label}</span>
                    <strong>{pct}%</strong>
                    <span style={d.progress}><span style={{ ...d.progressFill, width: `${pct}%` }} /></span>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section style={d.quickPanel}>
          <div style={d.panelHeader}>
            <div>
              <div style={d.panelTitle}>Szybki dostęp</div>
              <div style={d.panelSub}>Najczęstsze akcje dla tej roli</div>
            </div>
          </div>
          {quickLinkSections.map((section) => (
            <div key={section.key} style={d.quickSection}>
              <div style={d.quickSectionTitle}>{section.title}</div>
              <div style={d.quickGrid}>
                {section.items.map((item, i) => (
                  <button key={`${item.path}-${i}`} type="button" onClick={() => navigate(item.path)} style={d.quickTile}>
                    <span style={d.quickIcon}>{QL_ICONS[item.path] || CMD_ICONS.zlecenia}</span>
                    <span>
                      <strong>{item.label}</strong>
                      <small>{item.sub}</small>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}

const d = {
  root: {
    display: 'flex',
    minHeight: '100vh',
    width: '100%',
    maxWidth: '100vw',
    overflowX: 'hidden',
    background: 'var(--forest-pattern), linear-gradient(180deg, rgba(20,53,31,0.28) 0%, var(--bg-deep) 100%)',
  },
  content: { flex: 1, padding: '28px 32px', overflowX: 'hidden', minWidth: 0, maxWidth: '100%', position: 'relative' },
  contentCompact: {
    flex: '0 0 calc(100vw - 76px)',
    width: 'calc(100vw - 76px)',
    maxWidth: 'calc(100vw - 76px)',
    padding: '28px 10px 28px 14px',
  },
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
    background: 'linear-gradient(135deg, rgba(18,35,22,0.96) 0%, rgba(12,22,15,0.96) 48%, rgba(33,44,22,0.9) 100%)',
    border: '1px solid var(--border2)', overflow: 'hidden',
    boxShadow: 'var(--shadow-md)',
  },
  heroCompact: {
    padding: '26px 16px 20px',
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 18,
    borderRadius: 16,
    width: '100%',
    maxWidth: '100%',
    boxSizing: 'border-box',
  },
  heroBg: {
    position: 'absolute',
    inset: 0,
    background: 'var(--forest-pattern), linear-gradient(100deg, transparent 0%, rgba(155,217,87,0.1) 52%, rgba(138,106,62,0.1) 100%)',
    opacity: 0.72,
    pointerEvents: 'none',
  },
  heroLeft: { position: 'relative' },
  heroLeftCompact: { minWidth: 0 },
  heroGreeting: { fontSize: 26, fontWeight: 800, color: 'var(--text)', marginBottom: 4 },
  heroGreetingCompact: { fontSize: 24, lineHeight: 1.18 },
  heroDate: { fontSize: 13, color: 'var(--text-muted)', marginBottom: 12, textTransform: 'capitalize' },
  rolaBadge: { display: 'inline-block', borderRadius: 20, padding: '4px 14px', fontSize: 12, fontWeight: 700 },
  heroBtn: {
    display: 'flex', alignItems: 'center', gap: 8, padding: '12px 20px',
    background: 'var(--accent)', color: 'var(--on-accent)', border: '1px solid var(--border2)', borderRadius: 12,
    fontSize: 14, fontWeight: 700, cursor: 'pointer', transition: 'background 0.2s',
    position: 'relative', flexShrink: 0, boxShadow: 'var(--shadow-sm)',
  },
  heroBtnCompact: {
    width: 'calc(100vw - 116px)',
    alignSelf: 'stretch',
    justifyContent: 'center',
    minHeight: 46,
    maxWidth: '100%',
  },

  kpiSection: { marginBottom: 24 },
  kpiValue: {
    flexShrink: 0,
    minWidth: 56,
    textAlign: 'right',
    fontSize: 20,
    fontWeight: 650,
    letterSpacing: '0',
    fontVariantNumeric: 'tabular-nums',
    color: 'var(--text)',
  },
  kpiValueCompact: {
    width: 'calc(100% - 42px)',
    minWidth: 'calc(100% - 42px)',
    marginLeft: 42,
    textAlign: 'left',
    fontSize: 18,
    maxWidth: '100%',
    whiteSpace: 'normal',
  },
  insetGroup: INSET_LIST.group,
  insetGroupLift: { ...INSET_LIST.group, marginTop: 12 },
  insetHairline: INSET_LIST.hairline,
  insetRow: INSET_LIST.row,
  insetRowCompact: { gap: 10, padding: '11px 12px', minHeight: 50 },
  kpiRowCompact: { flexWrap: 'wrap' },
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
    letterSpacing: '0',
    fontVariantNumeric: 'tabular-nums',
    color: 'var(--text)',
  },
  commandGrid: { display: 'grid', gridTemplateColumns: '1.3fr .9fr', gap: 16, marginBottom: 20 },
  gridSingle: { gridTemplateColumns: 'minmax(0, 1fr)' },
  commandCard: {
    background: 'var(--forest-pattern), linear-gradient(145deg, var(--bg-card) 0%, var(--bg-card2) 100%)',
    border: '1px solid var(--border2)',
    borderRadius: 16,
    padding: 18,
    boxShadow: 'var(--shadow-sm)',
  },
  commandTitle: { fontSize: 16, fontWeight: 700, letterSpacing: '0', color: 'var(--text)' },
  commandText: { marginTop: 4, fontSize: 12, fontWeight: 500, color: 'var(--text-muted)' },

  // Main grid
  mainGrid: { display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 20 },
  card: {
    background: 'var(--forest-pattern), linear-gradient(150deg, var(--bg-card) 0%, var(--bg-card2) 100%)',
    borderRadius: 18, padding: 20, border: '1px solid var(--border2)', boxShadow: 'var(--shadow-sm)'
  },
  cardCompact: { padding: 16, borderRadius: 14, maxWidth: '100%', overflow: 'hidden', boxSizing: 'border-box' },
  cardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  cardHeaderCompact: { alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' },
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
  zRowCompact: { alignItems: 'stretch', gap: 8, padding: '10px 10px 10px 12px' },
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
  topBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 18,
    marginBottom: 18,
  },
  topBarCompact: { flexDirection: 'column', alignItems: 'stretch' },
  topTitleGroup: { minWidth: 0 },
  pageTitle: { fontSize: 20, fontWeight: 800, color: 'var(--text)', lineHeight: 1.15 },
  topMeta: { marginTop: 5, fontSize: 13, fontWeight: 600, color: 'var(--text-sub)' },
  topActions: { display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 },
  topActionsCompact: { width: '100%', display: 'grid', gridTemplateColumns: '1fr', alignItems: 'stretch' },
  primaryAction: {
    minHeight: 42,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: '0 16px',
    borderRadius: 8,
    border: '1px solid rgba(155,217,87,0.45)',
    background: 'linear-gradient(180deg, var(--accent), var(--accent-dk))',
    color: 'var(--on-accent)',
    fontSize: 14,
    fontWeight: 800,
    cursor: 'pointer',
    boxShadow: '0 14px 32px rgba(155,217,87,0.16)',
  },
  secondaryAction: {
    minHeight: 42,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: '0 14px',
    borderRadius: 8,
    border: '1px solid var(--border2)',
    background: 'rgba(10, 20, 12, 0.72)',
    color: 'var(--text-sub)',
    fontSize: 13,
    fontWeight: 750,
    cursor: 'pointer',
  },
  kpiGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(6, minmax(0, 1fr))',
    gap: 12,
    marginBottom: 14,
  },
  kpiGridNarrow: { gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' },
  kpiGridCompact: { gridTemplateColumns: 'minmax(0, 1fr)' },
  kpiCard: {
    minHeight: 104,
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 8,
    border: '1px solid rgba(191,225,146,0.16)',
    background: 'var(--forest-pattern), linear-gradient(155deg, rgba(20,34,24,0.94), rgba(10,18,12,0.94))',
    color: 'var(--text)',
    cursor: 'pointer',
    textAlign: 'left',
    boxShadow: 'var(--shadow-sm)',
  },
  kpiCardHover: { transform: 'translateY(-1px)', borderColor: 'var(--border2)' },
  kpiIcon: {
    width: 42,
    height: 42,
    borderRadius: 8,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    borderWidth: 1,
    borderStyle: 'solid',
  },
  kpiCardBody: { display: 'flex', flexDirection: 'column', minWidth: 0 },
  kpiCardLabel: { fontSize: 11, fontWeight: 800, color: 'var(--text-sub)', textTransform: 'uppercase' },
  kpiCardValue: { marginTop: 6, fontSize: 24, fontWeight: 850, color: 'var(--text)', lineHeight: 1.05 },
  kpiCardTrend: { marginTop: 7, fontSize: 12, fontWeight: 600, color: 'var(--accent)' },
  boardGrid: { display: 'grid', gridTemplateColumns: '1.14fr .86fr', gap: 12, marginBottom: 12 },
  lowerGrid: { display: 'grid', gridTemplateColumns: '1.1fr .85fr .9fr', gap: 12, marginBottom: 12 },
  panel: {
    minWidth: 0,
    borderRadius: 8,
    border: '1px solid rgba(191,225,146,0.18)',
    background: 'var(--forest-pattern), linear-gradient(155deg, rgba(18,32,22,0.94), rgba(9,17,12,0.95))',
    boxShadow: 'var(--shadow-sm)',
    overflow: 'hidden',
  },
  panelHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    padding: '14px 14px 12px',
    borderBottom: '1px solid rgba(191,225,146,0.12)',
  },
  panelTitle: { fontSize: 15, fontWeight: 850, color: 'var(--text)' },
  panelSub: { marginTop: 4, fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' },
  panelLink: {
    border: '1px solid var(--border2)',
    borderRadius: 8,
    background: 'rgba(155,217,87,0.1)',
    color: 'var(--accent)',
    minHeight: 32,
    padding: '0 10px',
    fontSize: 12,
    fontWeight: 800,
    cursor: 'pointer',
  },
  table: { overflowX: 'hidden' },
  tableRow: {
    width: '100%',
    minWidth: 0,
    display: 'grid',
    gridTemplateColumns: '44px minmax(116px,1.35fr) 84px 96px 58px 86px',
    gap: 8,
    alignItems: 'center',
    padding: '11px 12px',
    border: 'none',
    borderBottom: '1px solid rgba(191,225,146,0.1)',
    background: 'transparent',
    color: 'var(--text-sub)',
    textAlign: 'left',
    font: 'inherit',
    fontSize: 11,
    cursor: 'pointer',
  },
  tableHead: { color: 'var(--text-muted)', fontSize: 10, fontWeight: 850, textTransform: 'uppercase', cursor: 'default' },
  tableCode: { color: 'var(--text-muted)', fontWeight: 750 },
  tableStrong: { color: 'var(--text)', fontWeight: 750, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  tableMoney: { color: 'var(--text)', fontWeight: 800, textAlign: 'right', whiteSpace: 'nowrap' },
  rankList: { padding: '4px 12px 12px' },
  rankRow: {
    width: '100%',
    display: 'grid',
    gridTemplateColumns: '34px 34px minmax(0,1fr) 44px 112px',
    gap: 10,
    alignItems: 'center',
    padding: '10px 0',
    border: 'none',
    borderBottom: '1px solid rgba(191,225,146,0.1)',
    background: 'transparent',
    color: 'var(--text-sub)',
    textAlign: 'left',
    cursor: 'pointer',
  },
  rankPlace: { width: 26, height: 26, borderRadius: '50%', display: 'grid', placeItems: 'center', color: 'var(--text-muted)', border: '1px solid var(--border)' },
  rankPlaceLead: { color: '#eab308', borderColor: 'rgba(234,179,8,0.5)', background: 'rgba(234,179,8,0.12)' },
  rankLeaf: { color: 'var(--accent)', display: 'grid', placeItems: 'center' },
  rankName: { display: 'flex', flexDirection: 'column', minWidth: 0 },
  rankMetric: { fontSize: 12, fontWeight: 800, color: 'var(--text)' },
  timeline: { padding: '6px 14px 14px' },
  timelineRow: {
    width: '100%',
    display: 'grid',
    gridTemplateColumns: '58px minmax(0,1fr) 92px',
    gap: 10,
    alignItems: 'center',
    minHeight: 38,
    border: 'none',
    borderBottom: '1px solid rgba(191,225,146,0.1)',
    background: 'transparent',
    color: 'var(--text-sub)',
    textAlign: 'left',
    cursor: 'pointer',
    font: 'inherit',
    fontSize: 12,
  },
  timelineDate: { color: 'var(--info)', fontWeight: 800 },
  timelineName: { color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  timelineBranch: { textAlign: 'right', color: 'var(--text-muted)' },
  emptyLine: { padding: '14px 0', color: 'var(--text-muted)', fontSize: 13 },
  alertList: { padding: '8px 14px 14px' },
  alertRow: { display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 0', borderBottom: '1px solid rgba(191,225,146,0.1)' },
  alertDot: { width: 10, height: 10, borderRadius: '50%', flexShrink: 0, marginTop: 5 },
  alertWarn: { background: 'var(--warning)' },
  alertOk: { background: 'var(--success)' },
  alertInfo: { background: 'var(--info)' },
  opsList: { padding: '10px 14px 14px' },
  opsRow: { display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 44px', gap: 10, alignItems: 'center', marginBottom: 12, color: 'var(--text-sub)', fontSize: 12 },
  progress: { gridColumn: '1 / -1', height: 6, borderRadius: 999, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' },
  progressFill: { display: 'block', height: '100%', borderRadius: 999, background: 'linear-gradient(90deg, var(--accent-dk), var(--accent))' },
  quickPanel: {
    borderRadius: 8,
    border: '1px solid rgba(191,225,146,0.16)',
    background: 'var(--forest-pattern), linear-gradient(155deg, rgba(18,32,22,0.9), rgba(9,17,12,0.94))',
    boxShadow: 'var(--shadow-sm)',
    paddingBottom: 14,
  },
  quickGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 8, padding: '0 14px' },
  quickTile: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    minHeight: 58,
    padding: '10px 12px',
    borderRadius: 8,
    border: '1px solid rgba(191,225,146,0.12)',
    background: 'rgba(5,10,7,0.64)',
    color: 'var(--text)',
    textAlign: 'left',
    cursor: 'pointer',
  },
  quickIcon: { width: 30, height: 30, borderRadius: 8, display: 'grid', placeItems: 'center', color: 'var(--accent)', border: '1px solid var(--border2)', flexShrink: 0 },
  quickSectionWrapFirst: { marginTop: 8 },
  quickSectionWrap: { marginTop: 20 },
  quickSection: { marginTop: 16 },
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
