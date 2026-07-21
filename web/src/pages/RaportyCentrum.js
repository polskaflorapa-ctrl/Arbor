import { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import { getStoredToken } from '../utils/storedToken';
import { readStoredUser } from '../utils/readStoredUser';

const FIELD_ROLES = [
  'Dyrektor',
  'Administrator',
  'Kierownik',
  'Brygadzista',
  'Specjalista',
  'Pomocnik',
  'Pomocnik bez doswiadczenia',
];

const REPORT_MODULES = [
  {
    path: '/raporty/analityka',
    label: 'Analityka firmy',
    eyebrow: 'KPI i zarzad',
    description: 'Statusy, oddzialy, ekipy, miesiace, brygadzisci i wyniki sprzedazy.',
    metric: '360',
    tone: 'green',
  },
  {
    path: '/raporty/dzienny',
    label: 'Raport dzienny',
    eyebrow: 'Praca w terenie',
    description: 'Zlecenia dnia, czasy, materialy, opis pracy, podpis i wysylka raportu.',
    metric: 'DZIEN',
    tone: 'blue',
  },
  {
    path: '/raporty/mobilne',
    label: 'Raporty mobilne',
    eyebrow: 'KPI z aplikacji',
    description: 'Przychod, koszt, marza, godziny i wykonane zlecenia z mobilnego procesu.',
    metric: 'MOB',
    tone: 'cyan',
  },
  {
    path: '/raporty/misja-dnia',
    label: 'Misja dnia',
    eyebrow: 'Dzisiaj',
    description: 'Najwazniejszy plan dnia dla operatora: zadania, priorytety i szybkie akcje.',
    metric: 'LIVE',
    tone: 'amber',
  },
  {
    path: '/raporty/autoplan',
    label: 'Autoplan dnia',
    eyebrow: 'Planowanie',
    description: 'Automatyczna propozycja przypisania ekip i kolejki prac na dzien.',
    metric: 'AUTO',
    tone: 'cyan',
  },
  {
    path: '/raporty/kpi-tydzien',
    label: 'KPI tygodnia',
    eyebrow: 'Kontrola zmian',
    description: 'Historia apply / rollback autoplanowania i tygodniowa skutecznosc planu.',
    metric: '7D',
    tone: 'green',
  },
];

function roleCanOpenReports(user) {
  return user && (FIELD_ROLES.includes(user.rola) || String(user.rola || '').startsWith('Pomocnik bez'));
}

export default function RaportyCentrum() {
  const navigate = useNavigate();
  const user = useMemo(() => readStoredUser(), []);

  useEffect(() => {
    if (!getStoredToken()) {
      navigate('/');
      return;
    }
    if (!roleCanOpenReports(user)) {
      navigate('/dashboard');
    }
  }, [navigate, user]);

  const primary = REPORT_MODULES.slice(0, 3);
  const operational = REPORT_MODULES.slice(3);

  return (
    <div className="app-shell raporty-centrum-shell" style={S.wrap}>
      <Sidebar />
      <main className="app-main raporty-centrum-main" style={S.main}>
        <section className="raporty-centrum-hero" style={S.hero}>
          <div>
            <div style={S.eyebrow}>Centrum raportow</div>
            <h1 style={S.title}>Jedno miejsce na wyniki, raport dnia i KPI</h1>
            <p style={S.subtitle}>
              Raporty sa teraz uporzadkowane wedlug pracy firmy: zarzad, teren, mobilka i planowanie.
            </p>
          </div>
          <div style={S.heroStats}>
            <div style={S.statBox}>
              <span style={S.statLabel}>Moduly</span>
              <strong style={S.statValue}>{REPORT_MODULES.length}</strong>
            </div>
            <div style={S.statBox}>
              <span style={S.statLabel}>Menu</span>
              <strong style={S.statValue}>1</strong>
            </div>
          </div>
        </section>

        <section className="raporty-centrum-section" style={S.section}>
          <div style={S.sectionHead}>
            <div>
              <div style={S.eyebrow}>Najwazniejsze</div>
              <h2 style={S.sectionTitle}>Raporty do decyzji</h2>
            </div>
          </div>
          <div className="raporty-centrum-grid" style={S.grid}>
            {primary.map((item) => (
              <button key={item.path} type="button" className="raporty-centrum-card" style={{ ...S.card, ...S[item.tone] }} onClick={() => navigate(item.path)}>
                <span style={S.cardEyebrow}>{item.eyebrow}</span>
                <span style={S.cardTop}>
                  <strong style={S.cardTitle}>{item.label}</strong>
                  <span style={S.metric}>{item.metric}</span>
                </span>
                <span style={S.cardText}>{item.description}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="raporty-centrum-section" style={S.section}>
          <div style={S.sectionHead}>
            <div>
              <div style={S.eyebrow}>Operacyjnie</div>
              <h2 style={S.sectionTitle}>Plan dnia i kontrola wykonania</h2>
            </div>
          </div>
          <div className="raporty-centrum-compact-grid" style={S.compactGrid}>
            {operational.map((item) => (
              <button key={item.path} type="button" className="raporty-centrum-card" style={S.compactCard} onClick={() => navigate(item.path)}>
                <span style={S.cardEyebrow}>{item.eyebrow}</span>
                <strong style={S.cardTitle}>{item.label}</strong>
                <span style={S.cardText}>{item.description}</span>
              </button>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

const S = {
  wrap: { display: 'flex', minHeight: '100vh', background: '#f0ebdd' },
  main: { flex: 1, width: '100%', padding: '18px 28px 40px', maxWidth: 1240, margin: '0 auto', minWidth: 0 },
  hero: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) auto',
    gap: 18,
    alignItems: 'center',
    border: '1px solid #e0d9c8',
    borderRadius: 10,
    background: '#ffffff',
    boxShadow: '0 1px 2px rgba(15,23,42,0.04)',
    padding: '16px 18px',
    marginBottom: 12,
  },
  eyebrow: { color: 'var(--text-muted)', fontSize: 11, fontWeight: 900, textTransform: 'uppercase' },
  title: { margin: '4px 0 8px', color: 'var(--text)', fontSize: 28, lineHeight: 1.15, fontWeight: 950, letterSpacing: 0 },
  subtitle: { margin: 0, color: 'var(--text-sub)', fontSize: 14, lineHeight: 1.5, maxWidth: 680, fontWeight: 650 },
  heroStats: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(92px, 1fr))', gap: 10 },
  statBox: {
    border: '1px solid #e0d9c8',
    borderRadius: 8,
    background: '#ffffff',
    padding: '12px 14px',
    minHeight: 76,
    display: 'grid',
    alignContent: 'space-between',
  },
  statLabel: { color: 'var(--text-muted)', fontSize: 11, fontWeight: 900, textTransform: 'uppercase' },
  statValue: { color: 'var(--accent)', fontSize: 24, fontWeight: 950 },
  section: {
    border: '1px solid #e0d9c8',
    borderRadius: 10,
    background: '#ffffff',
    boxShadow: '0 1px 2px rgba(15,23,42,0.04)',
    padding: 12,
    marginBottom: 12,
  },
  sectionHead: { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 10 },
  sectionTitle: { margin: 0, color: 'var(--text)', fontSize: 17, fontWeight: 900, letterSpacing: 0 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 8 },
  compactGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 8 },
  card: {
    minHeight: 118,
    textAlign: 'left',
    border: '1px solid #e0d9c8',
    borderRadius: 8,
    background: '#ffffff',
    color: 'var(--text)',
    padding: 12,
    boxShadow: 'none',
    display: 'grid',
    gap: 9,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  compactCard: {
    minHeight: 104,
    textAlign: 'left',
    border: '1px solid #e0d9c8',
    borderRadius: 8,
    background: '#ffffff',
    color: 'var(--text)',
    padding: 12,
    boxShadow: 'none',
    display: 'grid',
    gap: 7,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  green: { borderLeft: '4px solid #5d6a0b' },
  blue: { borderLeft: '4px solid #766440' },
  cyan: { borderLeft: '4px solid #766440' },
  amber: { borderLeft: '4px solid #bd701e' },
  cardEyebrow: { color: 'var(--text-muted)', fontSize: 11, fontWeight: 900, textTransform: 'uppercase' },
  cardTop: { display: 'flex', gap: 10, alignItems: 'flex-start', justifyContent: 'space-between' },
  cardTitle: { color: 'var(--text)', fontSize: 16, lineHeight: 1.25, fontWeight: 900 },
  metric: {
    border: '1px solid #e0d9c8',
    borderRadius: 8,
    background: '#ffffff',
    color: 'var(--accent)',
    padding: '4px 8px',
    fontSize: 12,
    fontWeight: 950,
  },
  cardText: { color: 'var(--text-sub)', fontSize: 13, lineHeight: 1.45, fontWeight: 650 },
};
