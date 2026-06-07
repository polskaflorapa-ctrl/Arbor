import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../api';
import { Button } from '../components/ui/Button';
import { readStoredUser } from '../utils/readStoredUser';
import { getStoredToken } from '../utils/storedToken';
import { ArrowLeft, Printer } from 'lucide-react';

const MANAGEMENT_ROLES = new Set(['Administrator', 'Dyrektor', 'Kierownik']);
const FIELD_ROLES = new Set(['Brygadzista', 'Pomocnik', 'Pomocnik bez doświadczenia']);

const SETTLEMENT_LABELS = {
  hourly: 'Stawka godzinowa',
  daily: 'Stawka dzienna',
  fixed: 'Stała miesięczna',
  percent_revenue: '% od przychodu',
  percent_margin: '% od marży',
  mixed: 'Mix: fix + % + bonus',
  b2b: 'B2B / indywidualnie',
};

const BHP_CHECKLIST = [
  'Pracownik sprawdził kask, okulary, ochronniki słuchu, rękawice i odzież ochronną.',
  'Strefa pracy, upadku gałęzi i dostęp osób postronnych zostały zabezpieczone.',
  'Drzewo, martwe konary, linie energetyczne i warunki pogodowe zostały ocenione przed startem.',
  'Pilarki, rębak, liny, uprzęże i pozostały sprzęt są sprawne oraz używane zgodnie z instrukcją.',
  'Apteczka, łączność, osoba asekurująca i plan awaryjny są dostępne na miejscu.',
  'Zdjęcia, raport mobilny i uwagi po realizacji są przekazywane w ARBOR-OS.',
];

const OFFICE_CHECKLIST = [
  'Dane klientów, pracowników i kontrahentów są przetwarzane wyłącznie w systemach firmowych.',
  'CRM, zlecenia, harmonogram i follow-upy są aktualizowane w dniu wykonania pracy.',
  'Dokumenty finansowe i kadrowe są opisywane oraz przekazywane do właściwego obiegu.',
  'Ustalenia telefoniczne i mailowe są przypisane do klienta, zlecenia albo osoby odpowiedzialnej.',
  'Sprawy niedomknięte mają właściciela, termin i status widoczny dla zespołu.',
  'Konto imienne, hasła i dostęp do systemu są używane zgodnie z zasadami bezpieczeństwa.',
];

const PRINT_CSS = `
  @page { size: A4; margin: 12mm; }
  @media print {
    body { background: #fff !important; }
    .position-card-page { background: #fff !important; padding: 0 !important; }
    .position-card-sheet {
      border: 0 !important;
      box-shadow: none !important;
      max-width: none !important;
      padding: 0 !important;
    }
    .no-print { display: none !important; }
    .print-avoid-break { break-inside: avoid; page-break-inside: avoid; }
  }
`;

function formatDateTime(value) {
  if (!value) return 'brak';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'brak';
  return date.toLocaleString('pl-PL', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function fullName(row) {
  return row?.employee_name || [row?.imie, row?.nazwisko].filter(Boolean).join(' ') || row?.login || 'Pracownik';
}

function isFieldWorker(card) {
  const role = String(card?.employee_role || card?.rola || '');
  const position = String(card?.stanowisko || '').toLowerCase();
  return FIELD_ROLES.has(role) || position.includes('arbor') || position.includes('pilarz') || position.includes('teren');
}

function splitLines(value) {
  return String(value || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function formatMoney(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num === 0) return '';
  return `${num.toLocaleString('pl-PL', { maximumFractionDigits: 0 })} PLN`;
}

function formatSettlement(card) {
  const parts = [];
  if (card?.fixed_amount_pln) parts.push(`fix ${formatMoney(card.fixed_amount_pln)}`);
  if (card?.daily_rate_pln) parts.push(`${formatMoney(card.daily_rate_pln)} / dzień`);
  if (card?.hourly_rate_pln) parts.push(`${formatMoney(card.hourly_rate_pln)} / h`);
  if (card?.revenue_percent) parts.push(`${card.revenue_percent}% przychodu`);
  if (card?.margin_percent) parts.push(`${card.margin_percent}% marży`);
  return parts.length ? parts.join(' · ') : SETTLEMENT_LABELS[card?.settlement_type] || 'indywidualnie';
}

function statusLabel(card) {
  if (!card?.updated_at) return 'Brak opublikowanej karty';
  if (card.acknowledgement_status === 'confirmed') return 'Podpisano przez pracownika';
  return 'Do podpisu pracownika';
}

function Detail({ label, value }) {
  return (
    <div style={S.detail}>
      <span style={S.detailLabel}>{label}</span>
      <strong style={S.detailValue}>{value || 'brak'}</strong>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section className="print-avoid-break" style={S.section}>
      <h2 style={S.sectionTitle}>{title}</h2>
      {children}
    </section>
  );
}

function BulletList({ items, emptyText }) {
  if (!items.length) {
    return <div style={S.emptyLine}>{emptyText}</div>;
  }
  return (
    <ol style={S.list}>
      {items.map((item, index) => (
        <li key={`${item}-${index}`} style={S.listItem}>{item}</li>
      ))}
    </ol>
  );
}

export default function KartaStanowiskaDruk() {
  const navigate = useNavigate();
  const { userId } = useParams();
  const [user, setUser] = useState(null);
  const [card, setCard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  useEffect(() => {
    async function loadCard() {
      setLoading(true);
      setMessage('');
      try {
        const res = await api.get(`/position-cards/${userId}`, { dedupe: false });
        setCard(res.data || null);
      } catch (err) {
        setMessage(err?.response?.data?.error || 'Nie udało się załadować karty stanowiska.');
      } finally {
        setLoading(false);
      }
    }

    const stored = readStoredUser();
    if (!getStoredToken() || !stored) {
      navigate('/');
      return;
    }
    setUser(stored);
    loadCard();
  }, [navigate, userId]);

  const allowed = user && (MANAGEMENT_ROLES.has(user.rola) || Number(user.id) === Number(userId));
  const fieldWorker = isFieldWorker(card);
  const responsibilities = useMemo(() => splitLines(card?.obowiazki), [card?.obowiazki]);
  const criteria = useMemo(() => splitLines(card?.kryteria), [card?.kryteria]);
  const checklist = fieldWorker ? BHP_CHECKLIST : OFFICE_CHECKLIST;

  return (
    <div className="position-card-page" style={S.page}>
      <style>{PRINT_CSS}</style>
      <div className="no-print" style={S.actions}>
        <Button type="button" variant="outline" leftIcon={ArrowLeft} onClick={() => navigate('/kadry-dokumenty')}>Wróć do rejestru</Button>
        <Button type="button" leftIcon={Printer} onClick={() => window.print()} disabled={!card || !allowed}>
          Drukuj / PDF
        </Button>
      </div>

      <main className="position-card-sheet" style={S.sheet}>
        {loading ? (
          <div style={S.emptyState}>Ładowanie dokumentu...</div>
        ) : !allowed ? (
          <div style={S.emptyState}>Ten dokument jest dostępny tylko dla kadry zarządzającej albo przypisanego pracownika.</div>
        ) : message ? (
          <div style={S.emptyState}>{message}</div>
        ) : card ? (
          <>
            <header style={S.header}>
              <div>
                <div style={S.brand}>ARBOR-OS</div>
                <h1 style={S.title}>{fieldWorker ? 'Karta stanowiska i BHP' : 'Karta stanowiska pracy'}</h1>
                <p style={S.subtitle}>Dokument kadrowy przygotowany do podpisu, wydruku lub zapisania jako PDF.</p>
              </div>
              <div style={S.statusBox}>
                <span style={S.statusLabel}>Status</span>
                <strong style={S.statusValue}>{statusLabel(card)}</strong>
                <span style={S.statusMeta}>Wersja: {formatDateTime(card.updated_at)}</span>
              </div>
            </header>

            <section className="print-avoid-break" style={S.detailsGrid}>
              <Detail label="Pracownik" value={fullName(card)} />
              <Detail label="Rola" value={card.employee_role} />
              <Detail label="Stanowisko" value={card.stanowisko} />
              <Detail label="Typ dokumentu" value={fieldWorker ? 'Karta stanowiska + BHP terenowe' : 'Karta stanowiska pracy biurowej'} />
              <Detail label="Cenny produkt" value={card.cenny_produkt} />
              <Detail label="Podpis pracownika" value={card.acknowledged_at ? formatDateTime(card.acknowledged_at) : 'brak'} />
            </section>

            <Section title="Zakres odpowiedzialności">
              <BulletList items={responsibilities} emptyText="Do uzupełnienia w profilu pracownika." />
            </Section>

            <Section title="Kryteria oceny pracy">
              <BulletList items={criteria} emptyText="Do uzupełnienia przez przełożonego." />
            </Section>

            <Section title="Warunki rozliczenia">
              <div style={S.settlementLead}>{formatSettlement(card)}</div>
              <div style={S.settlementGrid}>
                <Detail label="Typ" value={SETTLEMENT_LABELS[card.settlement_type] || card.settlement_type} />
                <Detail label="Fix" value={formatMoney(card.fixed_amount_pln)} />
                <Detail label="Dzień" value={card.daily_rate_pln ? `${formatMoney(card.daily_rate_pln)} / dzień` : ''} />
                <Detail label="Godzina" value={card.hourly_rate_pln ? `${formatMoney(card.hourly_rate_pln)} / h` : ''} />
                <Detail label="% przychodu" value={card.revenue_percent ? `${card.revenue_percent}%` : ''} />
                <Detail label="% marży" value={card.margin_percent ? `${card.margin_percent}%` : ''} />
              </div>
              {card.bonus_rules ? <p style={S.note}><strong>Bonusy i dodatki:</strong> {card.bonus_rules}</p> : null}
              {card.settlement_notes ? <p style={S.note}><strong>Uwagi:</strong> {card.settlement_notes}</p> : null}
            </Section>

            <Section title={fieldWorker ? 'Lista BHP dla pracy terenowej' : 'Karta stanowiska pracy biurowej'}>
              <BulletList items={checklist} emptyText="" />
            </Section>

            <Section title="Oświadczenie pracownika">
              <p style={S.statement}>
                Potwierdzam, że zapoznałem/am się z zakresem obowiązków, zasadami bezpieczeństwa,
                kryteriami oceny pracy oraz warunkami rozliczenia wskazanymi w tej karcie.
              </p>
              <div style={S.signatureGrid}>
                <div style={S.signatureBox}>
                  <span>Data i podpis pracownika</span>
                </div>
                <div style={S.signatureBox}>
                  <span>Podpis przełożonego</span>
                </div>
                <div style={S.signatureBox}>
                  <span>{fieldWorker ? 'Potwierdzenie instruktażu BHP' : 'Potwierdzenie przekazania stanowiska'}</span>
                </div>
              </div>
            </Section>

            <footer style={S.footer}>
              Wygenerowano: {formatDateTime(new Date().toISOString())}
              {card.updated_by_name ? ` · Ostatnio edytował/a: ${card.updated_by_name}` : ''}
              {card.acknowledged_by_name ? ` · Podpisał/a: ${card.acknowledged_by_name}` : ''}
            </footer>
          </>
        ) : (
          <div style={S.emptyState}>Brak danych dokumentu.</div>
        )}
      </main>
    </div>
  );
}

const S = {
  page: {
    minHeight: '100vh',
    background: 'var(--bg)',
    padding: '22px 18px 42px',
    color: '#172018',
  },
  actions: {
    maxWidth: 1040,
    margin: '0 auto 12px',
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 8,
    flexWrap: 'wrap',
  },
  primaryBtn: {
    minHeight: 40,
    border: '1px solid #2F7D4F',
    borderRadius: 8,
    background: '#E8F6ED',
    color: '#25643F',
    padding: '8px 12px',
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: 13,
    fontWeight: 900,
  },
  secondaryBtn: {
    minHeight: 40,
    border: '1px solid var(--glass-border)',
    borderRadius: 8,
    background: 'var(--surface-glass)',
    color: 'var(--text-sub)',
    padding: '8px 12px',
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: 13,
    fontWeight: 850,
  },
  sheet: {
    maxWidth: 1040,
    margin: '0 auto',
    background: '#fff',
    border: '1px solid #D8DED6',
    borderRadius: 8,
    boxShadow: '0 18px 48px rgba(20, 31, 22, 0.14)',
    padding: 28,
  },
  header: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) 280px',
    gap: 20,
    alignItems: 'start',
    borderBottom: '2px solid #1F2A22',
    paddingBottom: 18,
    marginBottom: 18,
  },
  brand: { color: '#2F7D4F', fontSize: 12, fontWeight: 950, letterSpacing: 0, textTransform: 'uppercase' },
  title: { margin: '4px 0 8px', color: '#142017', fontSize: 30, lineHeight: 1.1, fontWeight: 950 },
  subtitle: { margin: 0, color: '#53605A', fontSize: 14, lineHeight: 1.45, fontWeight: 700 },
  statusBox: {
    border: '1px solid #D8DED6',
    borderRadius: 8,
    background: '#F7FAF7',
    padding: 12,
  },
  statusLabel: { display: 'block', color: '#6B766F', fontSize: 11, fontWeight: 900, textTransform: 'uppercase' },
  statusValue: { display: 'block', color: '#1F5E3A', fontSize: 16, fontWeight: 950, marginTop: 4 },
  statusMeta: { display: 'block', color: '#647067', fontSize: 12, fontWeight: 700, marginTop: 8 },
  detailsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: 8,
    marginBottom: 16,
  },
  detail: {
    border: '1px solid #D8DED6',
    borderRadius: 8,
    padding: '9px 10px',
    minHeight: 58,
    background: '#FBFCFB',
  },
  detailLabel: { display: 'block', color: '#6B766F', fontSize: 10, fontWeight: 900, textTransform: 'uppercase' },
  detailValue: { display: 'block', color: '#1B251E', fontSize: 13, lineHeight: 1.35, fontWeight: 900, marginTop: 4 },
  section: {
    borderTop: '1px solid #D8DED6',
    paddingTop: 14,
    marginTop: 14,
  },
  sectionTitle: { margin: '0 0 10px', color: '#142017', fontSize: 16, lineHeight: 1.25, fontWeight: 950 },
  list: { margin: 0, paddingLeft: 20, color: '#27342B', fontSize: 13, lineHeight: 1.5, fontWeight: 650 },
  listItem: { marginBottom: 5 },
  emptyLine: {
    border: '1px dashed #C8D1C8',
    borderRadius: 8,
    padding: '10px 12px',
    color: '#6B766F',
    fontSize: 13,
    fontWeight: 750,
  },
  settlementLead: {
    border: '1px solid #BFDAC7',
    borderRadius: 8,
    background: '#F0F8F2',
    color: '#1F5E3A',
    padding: '10px 12px',
    fontSize: 14,
    fontWeight: 950,
    marginBottom: 8,
  },
  settlementGrid: { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 },
  note: { margin: '8px 0 0', color: '#344039', fontSize: 13, lineHeight: 1.45, fontWeight: 650 },
  statement: { margin: 0, color: '#27342B', fontSize: 13, lineHeight: 1.55, fontWeight: 700 },
  signatureGrid: { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10, marginTop: 22 },
  signatureBox: {
    minHeight: 84,
    border: '1px solid #AEB8AF',
    borderRadius: 8,
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'center',
    padding: 10,
    color: '#58635C',
    fontSize: 11,
    fontWeight: 850,
    textAlign: 'center',
  },
  footer: {
    borderTop: '1px solid #D8DED6',
    marginTop: 18,
    paddingTop: 10,
    color: '#6B766F',
    fontSize: 11,
    fontWeight: 700,
  },
  emptyState: {
    border: '1px dashed #C8D1C8',
    borderRadius: 8,
    padding: 18,
    color: '#53605A',
    fontSize: 14,
    fontWeight: 850,
  },
};
