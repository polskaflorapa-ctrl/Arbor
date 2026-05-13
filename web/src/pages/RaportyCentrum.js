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
    <div style={S.wrap}>
      <Sidebar />
      <main style={S.main}>
        <section style={S.hero}>
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

        <section style={S.section}>
          <div style={S.sectionHead}>
            <div>
              <div style={S.eyebrow}>Najwazniejsze</div>
              <h2 style={S.sectionTitle}>Raporty do decyzji</h2>
            </div>
          </div>
          <div style={S.grid}>
            {primary.map((item) => (
              <button key={item.path} type="button" style={{ ...S.card, ...S[item.tone] }} onClick={() => navigate(item.path)}>
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

        <section style={S.section}>
          <div style={S.sectionHead}>
            <div>
              <div style={S.eyebrow}>Operacyjnie</div>
              <h2 style={S.sectionTitle}>Plan dnia i kontrola wykonania</h2>
            </div>
          </div>
          <div style={S.compactGrid}>
            {operational.map((item) => (
              <button key={item.path} type="button" style={S.compactCard} onClick={() => navigate(item.path)}>
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
  wrap: { display: 'flex', minHeight: '100vh', background: 'var(--bg)' },
  main: { flex: 1, padding: '24px 28px 48px', maxWidth: 1180, minWidth: 0 },
  hero: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) auto',
    gap: 18,
    alignItems: 'center',
    border: '1px solid var(--border2)',
    borderRadius: 8,
    background: 'var(--bg-card)',
    boxShadow: 'var(--shadow-sm)',
    padding: 18,
    marginBottom: 14,
  },
  eyebrow: { color: 'var(--text-muted)', fontSize: 11, fontWeight: 900, textTransform: 'uppercase' },
  title: { margin: '4px 0 8px', color: 'var(--text)', fontSize: 28, lineHeight: 1.15, fontWeight: 950, letterSpacing: 0 },
  subtitle: { margin: 0, color: 'var(--text-sub)', fontSize: 14, lineHeight: 1.5, maxWidth: 680, fontWeight: 650 },
  heroStats: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(92px, 1fr))', gap: 10 },
  statBox: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'var(--bg-deep)',
    padding: '12px 14px',
    minHeight: 76,
    display: 'grid',
    alignContent: 'space-between',
  },
  statLabel: { color: 'var(--text-muted)', fontSize: 11, fontWeight: 900, textTransform: 'uppercase' },
  statValue: { color: 'var(--accent)', fontSize: 24, fontWeight: 950 },
  section: {
    border: '1px solid var(--border2)',
    borderRadius: 8,
    background: 'var(--bg-card)',
    boxShadow: 'var(--shadow-sm)',
    padding: 14,
    marginBottom: 14,
  },
  sectionHead: { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 10 },
  sectionTitle: { margin: 0, color: 'var(--text)', fontSize: 17, fontWeight: 900, letterSpacing: 0 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 10 },
  compactGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 10 },
  card: {
    minHeight: 158,
    textAlign: 'left',
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'var(--bg-deep)',
    color: 'var(--text)',
    padding: 13,
    display: 'grid',
    gap: 9,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  compactCard: {
    minHeight: 126,
    textAlign: 'left',
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'var(--bg-deep)',
    color: 'var(--text)',
    padding: 12,
    display: 'grid',
    gap: 7,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  green: { border: '1px solid rgba(52,211,153,0.28)', background: 'rgba(52,211,153,0.07)' },
  blue: { border: '1px solid rgba(96,165,250,0.28)', background: 'rgba(96,165,250,0.07)' },
  cyan: { border: '1px solid rgba(34,211,238,0.25)', background: 'rgba(34,211,238,0.06)' },
  amber: { border: '1px solid rgba(249,168,37,0.3)', background: 'rgba(249,168,37,0.08)' },
  cardEyebrow: { color: 'var(--text-muted)', fontSize: 11, fontWeight: 900, textTransform: 'uppercase' },
  cardTop: { display: 'flex', gap: 10, alignItems: 'flex-start', justifyContent: 'space-between' },
  cardTitle: { color: 'var(--text)', fontSize: 16, lineHeight: 1.25, fontWeight: 900 },
  metric: {
    border: '1px solid var(--border2)',
    borderRadius: 8,
    background: 'var(--bg-card)',
    color: 'var(--accent)',
    padding: '4px 8px',
    fontSize: 12,
    fontWeight: 950,
  },
  cardText: { color: 'var(--text-sub)', fontSize: 13, lineHeight: 1.45, fontWeight: 650 },
};
