import { useEffect, useState, useRef, useCallback } from 'react';
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
    { label: 'Nowe zlecenia',   sub: 'Oczekują na przypisanie', value: stats.nowe || 0,         icon: 'nowe',       color: 'var(--accent)', path: '/zlecenia' },
    { label: 'W realizacji',    sub: 'Ekipy aktualnie w terenie', value: stats.w_realizacji || 0, icon: 'realizacja', color: '#FBBF24', path: '/zlecenia' },
    { label: 'Zakończone',      sub: 'Zrealizowane zlecenia',   value: stats.zakonczone || 0,    icon: 'zakonczone', color: '#34d399', path: '/zlecenia' },
    ...(!isWorker && !isWyceniajacy ? [{ label: 'Wartość zleceń', sub: 'Łącznie w systemie', value: sumaWartosci, icon: 'wartosc', color: 'var(--accent)', suffix: ' PLN' }] : []),
  ];

  const quickLinks = [
    { label: 'Nowe zlecenie',  sub: 'Utwórz zlecenie',       path: '/nowe-zlecenie', color: 'var(--accent)', roles: ['Dyrektor','Administrator','Kierownik'] },
    { label: 'Planowanie',     sub: 'Przypisz ekipy',         path: '/kierownik',     color: 'var(--accent)', roles: ['Dyrektor','Administrator','Kierownik'] },
    { label: 'Ekipy',          sub: 'Zarządzaj ekipami',      path: '/ekipy',         color: 'var(--accent)', roles: ['Dyrektor','Administrator','Kierownik'] },
    { label: 'Raporty',        sub: 'Analiza wydajności',     path: '/raporty',           color: 'var(--accent-dk)', roles: ['Dyrektor','Administrator','Kierownik','Brygadzista','Specjalista'] },
    { label: 'Flota i sprzęt', sub: 'Pojazdy i narzędzia',   path: '/flota',             color: '#FBBF24', roles: ['Dyrektor','Administrator','Kierownik','Brygadzista','Magazynier'] },
    { label: 'Harmonogram',    sub: 'Kalendarz zleceń',       path: '/harmonogram',       color: '#60A5FA', roles: ['Dyrektor','Administrator','Kierownik','Brygadzista','Specjalista','Magazynier'] },
    { label: 'Kal. wycen',     sub: 'Wyceny w terenie',       path: '/wycena-kalendarz',  color: 'var(--accent)', roles: ['Wyceniający','Specjalista','Kierownik','Dyrektor','Administrator'] },
    { label: 'Rozliczenie wyc.', sub: 'Stawka + % realizacji', path: '/wynagrodzenie-wyceniajacych', color: '#34D399', roles: ['Wyceniający','Kierownik','Dyrektor','Administrator'] },
    { label: 'Oddziały',       sub: 'Zarządzanie',            path: '/oddzialy',          color: '#60A5FA', roles: ['Dyrektor','Administrator'] },
    { label: 'Użytkownicy',    sub: 'Konta i uprawnienia',    path: '/uzytkownicy',       color: '#F87171', roles: ['Dyrektor','Administrator'] },
    { label: 'Role',           sub: 'Uprawnienia pracowników',path: '/zarzadzaj-rolami',  color: '#F59E0B', roles: ['Dyrektor','Administrator'] },
    { label: 'Księgowość',     sub: 'Faktury i rozliczenia',  path: '/ksiegowosc',        color: '#FBBF24', roles: ['Dyrektor','Administrator','Kierownik'] },
  ].filter(i => i.roles.includes(user?.rola));

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

        {/* ─── KPI ─────────────────────────────────────────────────────────── */}
        {!isWyceniajacy && (
          <div style={d.kpiGrid}>
            {kpiData.map((k, i) => (
              <div key={k.label}
                onClick={() => k.path && navigate(k.path)}
                onMouseEnter={() => setHovered(`kpi${i}`)}
                onMouseLeave={() => setHovered(null)}
                style={{ ...d.kpiCard, borderTopColor: k.color, cursor: k.path ? 'pointer' : 'default',
                  transform: hovered === `kpi${i}` ? 'translateY(-4px)' : 'none',
                  boxShadow: hovered === `kpi${i}` ? `0 8px 24px rgba(0,0,0,0.4)` : '0 2px 8px rgba(0,0,0,0.3)',
                }}>
                <div style={{ ...d.kpiIcon, background: k.color + '18', color: k.color }}>
                  {KPI_ICONS[k.icon]}
                </div>
                <div style={{ ...d.kpiNum, color: k.color }}>
                  <AnimatedNumber value={k.value} />{k.suffix || ''}
                </div>
                <div style={d.kpiLabel}>{k.label}</div>
                <div style={d.kpiSub}>{k.sub}</div>
              </div>
            ))}
          </div>
        )}

        <div style={d.commandGrid}>
          <div style={d.commandCard}>
            <div style={d.commandTitle}>Centrum operacyjne</div>
            <div style={d.commandText}>Priorytetowe akcje na teraz</div>
            <div style={d.commandButtons}>
              <button style={d.commandBtnAccent} onClick={() => navigate('/zlecenia')}>Zarządzaj zleceniami</button>
              <button style={d.commandBtnGhost} onClick={() => navigate('/harmonogram')}>Sprawdź harmonogram</button>
              <button style={d.commandBtnGhost} onClick={() => navigate('/powiadomienia')}>Powiadomienia</button>
            </div>
          </div>
          <div style={d.commandCard}>
            <div style={d.commandTitle}>Pipeline live</div>
            <div style={d.pipelineRow}>
              <span style={d.pipelineLabel}>Nowe</span>
              <span style={d.pipelineValue}>{statusCounts.Nowe || 0}</span>
            </div>
            <div style={d.pipelineRow}>
              <span style={d.pipelineLabel}>Zaplanowane</span>
              <span style={d.pipelineValue}>{statusCounts.Zaplanowane || 0}</span>
            </div>
            <div style={d.pipelineRow}>
              <span style={d.pipelineLabel}>W realizacji</span>
              <span style={d.pipelineValue}>{statusCounts.W_Realizacji || 0}</span>
            </div>
            <div style={d.pipelineRow}>
              <span style={d.pipelineLabel}>Zakończone</span>
              <span style={d.pipelineValue}>{statusCounts.Zakonczone || 0}</span>
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

          {/* Szybki dostęp */}
          <div style={{ ...d.card, ...(isWyceniajacy ? { gridColumn: '1 / -1' } : {}) }}>
            <div style={d.cardHeader}>
              <span style={d.cardTitle}>Szybki dostęp</span>
            </div>
            <div style={isWyceniajacy ? d.qlGridWide : d.qlGrid}>
              {quickLinks.map((item, i) => (
                <div key={item.path}
                  onClick={() => navigate(item.path)}
                  onMouseEnter={() => setHovered(`ql${i}`)}
                  onMouseLeave={() => setHovered(null)}
                  style={{ ...d.qlItem,
                    background: hovered === `ql${i}` ? 'rgba(255,255,255,0.06)' : 'var(--bg-card2)',
                    borderColor: hovered === `ql${i}` ? item.color + '55' : 'var(--border2)',
                    transform: hovered === `ql${i}` ? 'translateY(-2px)' : 'none',
                  }}>
                  <div style={{ ...d.qlIcon, background: item.color + '18', color: item.color }}>
                    {QL_ICONS[item.path] || <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="10"/></svg>}
                  </div>
                  <div style={d.qlLabel}>{item.label}</div>
                  <div style={d.qlSub}>{item.sub}</div>
                </div>
              ))}
            </div>
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

  // KPI
  kpiGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 24 },
  kpiCard: {
    background: 'linear-gradient(150deg, var(--bg-card) 0%, var(--bg-card2) 100%)',
    borderRadius: 18, padding: 20, borderTop: '3px solid var(--border2)',
    border: '1px solid var(--border2)', transition: 'all 0.2s',
  },
  kpiIcon: { width: 44, height: 44, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  kpiNum: { fontSize: 28, fontWeight: 800, marginBottom: 4 },
  kpiLabel: { fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 2 },
  kpiSub: { fontSize: 11, color: 'var(--text-muted)' },
  commandGrid: { display: 'grid', gridTemplateColumns: '1.3fr .9fr', gap: 16, marginBottom: 20 },
  commandCard: {
    background: 'linear-gradient(145deg, var(--bg-card) 0%, var(--bg-card2) 100%)',
    border: '1px solid var(--border2)',
    borderRadius: 16,
    padding: 18,
    boxShadow: 'var(--shadow-sm)',
  },
  commandTitle: { fontSize: 16, fontWeight: 800, color: 'var(--text)' },
  commandText: { marginTop: 4, fontSize: 12, color: 'var(--text-muted)' },
  commandButtons: { marginTop: 14, display: 'flex', gap: 10, flexWrap: 'wrap' },
  commandBtnAccent: {
    padding: '10px 14px', borderRadius: 10, border: '1px solid rgba(5,150,105,0.45)',
    background: 'linear-gradient(180deg, #34d399 0%, #059669 100%)', color: '#052E16', cursor: 'pointer', fontWeight: 700, fontSize: 13,
  },
  commandBtnGhost: {
    padding: '10px 14px', borderRadius: 10, border: '1px solid var(--border2)',
    background: 'var(--bg-deep)', color: 'var(--text-sub)', cursor: 'pointer', fontWeight: 700, fontSize: 13,
  },
  pipelineRow: { marginTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: 6 },
  pipelineLabel: { fontSize: 12, color: 'var(--text-sub)', fontWeight: 600 },
  pipelineValue: { fontSize: 17, color: '#6ee7b7', fontWeight: 800 },

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

  // Quick links
  qlGrid: { display: 'flex', flexDirection: 'column', gap: 8 },
  qlGridWide: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 },
  qlItem: {
    display: 'flex', flexDirection: 'column', gap: 6, padding: 14,
    borderRadius: 12, cursor: 'pointer',
    borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border)',
    transition: 'all 0.18s', boxShadow: 'var(--shadow-sm)',
  },
  qlIcon: { width: 36, height: 36, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  qlLabel: { fontSize: 13, fontWeight: 700, color: 'var(--text)' },
  qlSub: { fontSize: 11, color: 'var(--text-muted)' },
};
