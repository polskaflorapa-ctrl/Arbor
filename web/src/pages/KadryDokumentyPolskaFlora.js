import React from 'react';
import Sidebar from '../components/Sidebar';
import BadgeOutlined from '@mui/icons-material/BadgeOutlined';
import DescriptionOutlined from '@mui/icons-material/DescriptionOutlined';
import AssignmentTurnedInOutlined from '@mui/icons-material/AssignmentTurnedInOutlined';
import WarningAmberOutlined from '@mui/icons-material/WarningAmberOutlined';
import SearchOutlined from '@mui/icons-material/SearchOutlined';
import FileDownloadOutlined from '@mui/icons-material/FileDownloadOutlined';
import RefreshOutlined from '@mui/icons-material/RefreshOutlined';

function toneStyle(tone) {
  if (tone === 'ok' || tone === 'success') return ui.badgeOk;
  if (tone === 'danger') return ui.badgeDanger;
  return ui.badgeWarn;
}

export default function KadryDokumentyPolskaFlora({
  allowed,
  cards = [],
  filteredCards = [],
  summary,
  competencyAlerts = [],
  alertsByUser,
  roles = [],
  loading = false,
  message = '',
  query,
  setQuery,
  statusFilter,
  setStatusFilter,
  roleFilter,
  setRoleFilter,
  loadCards,
  exportCsv,
  navigate,
  fullName,
  statusMeta,
  competencyMeta,
  isFieldWorker,
  formatSettlement,
  formatDateTime,
}) {
  return (
    <div className="app-shell hr-docs-shell hr-docs-pf-shell" style={ui.shell}>
      <Sidebar />
      <main className="app-main hr-docs-main hr-docs-pf-main" style={ui.main}>
        <header className="hr-docs-header hr-docs-pf-header" style={ui.header}>
          <div>
            <h1 style={ui.title}>Kadry / Dokumenty</h1>
            <p style={ui.subtitle}>Kontrola pracownikow, kart stanowiskowych, podpisow, BHP i uprawnien • {filteredCards.length} wynikow</p>
          </div>
          <div className="hr-docs-actions" style={ui.headerActions}>
            <button type="button" style={ui.secondaryButton} onClick={loadCards}><RefreshOutlined fontSize="small" /> Odswiez</button>
            <button type="button" style={ui.primaryButton} onClick={() => navigate('/profil')}>Edytuj karte</button>
          </div>
        </header>

        {!allowed ? (
          <section className="hr-docs-panel hr-docs-empty" style={ui.empty}>
            <WarningAmberOutlined style={{ fontSize: 44, color: '#d1d5db' }} />
            <strong>Brak dostepu</strong>
            <span>Ten widok jest dostepny dla Administratora, Dyrektora i Kierownika.</span>
          </section>
        ) : (
          <>
            <section className="hr-docs-stats" style={ui.stats}>
              <Stat icon={<DescriptionOutlined fontSize="small" />} label="Zapisane karty" value={summary.saved.length} hint={`${cards.length} pracownikow w rejestrze`} />
              <Stat icon={<WarningAmberOutlined fontSize="small" />} label="Do podpisu" value={summary.pending.length} hint="wymagaja reakcji" tone="warn" />
              <Stat icon={<AssignmentTurnedInOutlined fontSize="small" />} label="Podpisane" value={summary.confirmed.length} hint="wersje potwierdzone" tone="ok" />
              <Stat icon={<DescriptionOutlined fontSize="small" />} label="Braki" value={summary.missing.length} hint="bez opublikowanej karty" tone="danger" />
              <Stat icon={<BadgeOutlined fontSize="small" />} label="Teren / BHP" value={summary.field.length} hint="role z checklistami" />
              <Stat icon={<WarningAmberOutlined fontSize="small" />} label="Wygasle" value={summary.expiredCompetencies} hint="uprawnienia po terminie" tone="danger" />
              <Stat icon={<WarningAmberOutlined fontSize="small" />} label="Do odnowienia" value={summary.expiringCompetencies || competencyAlerts.filter((item) => item.status === 'expiring').length} hint="alert 30/90 dni" tone="warn" />
            </section>

            <section className="hr-docs-panel" style={ui.panel}>
              <div className="hr-docs-toolbar" style={ui.toolbar}>
                <label style={ui.search}>
                  <SearchOutlined style={{ color: '#9ca3af', fontSize: 20 }} />
                  <input
                    style={ui.searchInput}
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Szukaj pracownika, roli, stanowiska..."
                  />
                </label>
                <select style={ui.select} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                  <option value="all">Wszystkie statusy</option>
                  <option value="pending">Do podpisu</option>
                  <option value="confirmed">Podpisane</option>
                  <option value="missing">Brak karty</option>
                </select>
                <select style={ui.select} value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>
                  <option value="all">Wszystkie role</option>
                  {roles.map((role) => <option key={role} value={role}>{role}</option>)}
                </select>
                <button type="button" style={ui.exportButton} onClick={exportCsv} disabled={!filteredCards.length}>
                  <FileDownloadOutlined fontSize="small" /> Eksport CSV
                </button>
              </div>

              {message ? <div style={ui.alert}>{message}</div> : null}
              {loading ? <div style={ui.empty}>Ladowanie rejestru dokumentow...</div> : null}
              {!loading && filteredCards.length === 0 ? (
                <div style={ui.empty}>Brak dokumentow pasujacych do filtrow.</div>
              ) : null}

              {!loading && filteredCards.length > 0 ? (
                <div className="hr-docs-list" style={ui.list}>
                  {filteredCards.map((card) => {
                    const meta = statusMeta(card);
                    const competency = competencyMeta(card, alertsByUser.get(Number(card.user_id)) || []);
                    return (
                      <article className="hr-docs-card" key={card.user_id} style={ui.card}>
                        <div style={ui.cardTop}>
                          <div style={ui.person}>
                            <div style={ui.avatar}>{String(fullName(card)).slice(0, 1).toUpperCase()}</div>
                            <div>
                              <h3 style={ui.cardTitle}>{fullName(card)}</h3>
                              <p style={ui.cardMeta}>{card.employee_role || 'brak roli'} • {card.stanowisko || 'brak stanowiska'}</p>
                            </div>
                          </div>
                          <span style={{ ...ui.statusBadge, ...toneStyle(meta.tone) }}>{meta.label}</span>
                        </div>
                        <div style={ui.metrics}>
                          <Metric label="Dokument" value={isFieldWorker(card) ? 'Karta + BHP terenowe' : 'Karta stanowiska'} />
                          <Metric label="Uprawnienia" value={competency.label} hint={competency.detail} tone={competency.tone} />
                          <Metric label="Rozliczenie" value={formatSettlement(card)} />
                          <Metric label="Wersja" value={formatDateTime(card.updated_at)} />
                          <Metric label="Podpis" value={formatDateTime(card.acknowledged_at)} tone={card.acknowledged_at ? 'success' : 'warning'} />
                          <Metric label="Potwierdzil" value={card.acknowledged_by_name || 'brak'} />
                        </div>
                        <div style={ui.cardActions}>
                          <button type="button" style={ui.rowButton} onClick={() => navigate(`/profil/${card.user_id}`)}>Profil</button>
                          <button type="button" style={ui.rowPrimary} onClick={() => navigate(`/kadry-dokumenty/druk/${card.user_id}`)}>PDF</button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : null}
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function Stat({ icon, label, value, hint, tone }) {
  const color = tone === 'danger' ? '#b91c1c' : tone === 'warn' ? '#b45309' : tone === 'ok' ? '#047857' : '#111827';
  return (
    <div style={ui.stat}>
      <div style={{ ...ui.statLabel, color }}>{icon}<span>{label}</span></div>
      <strong style={{ ...ui.statValue, color }}>{value}</strong>
      <small style={ui.statHint}>{hint}</small>
    </div>
  );
}

function Metric({ label, value, hint, tone }) {
  const color = tone === 'danger' ? '#b91c1c' : tone === 'warning' ? '#b45309' : tone === 'success' ? '#047857' : '#111827';
  return (
    <div style={ui.metric}>
      <span>{label}</span>
      <strong style={{ color }}>{value || '-'}</strong>
      {hint ? <small>{hint}</small> : null}
    </div>
  );
}

const ui = {
  shell: { display: 'flex', minHeight: '100vh', background: '#f8fafc', color: '#111827' },
  main: { flex: 1, padding: 28, overflowX: 'hidden' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 22 },
  title: { margin: 0, fontSize: 26, lineHeight: 1.2, fontWeight: 800, color: '#111827' },
  subtitle: { margin: '6px 0 0', color: '#6b7280', fontSize: 14, maxWidth: 760 },
  headerActions: { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' },
  primaryButton: { height: 40, border: 0, borderRadius: 10, background: '#059669', color: '#fff', padding: '0 14px', fontWeight: 900, cursor: 'pointer' },
  secondaryButton: { height: 40, border: '1px solid #dbe3ea', borderRadius: 10, background: '#fff', color: '#374151', padding: '0 12px', fontWeight: 900, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 },
  stats: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14, marginBottom: 18 },
  stat: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 16, boxShadow: '0 8px 24px rgba(15, 23, 42, 0.04)' },
  statLabel: { display: 'flex', alignItems: 'center', gap: 8, textTransform: 'uppercase', fontSize: 12, fontWeight: 900, marginBottom: 8 },
  statValue: { display: 'block', fontSize: 27, lineHeight: 1.1 },
  statHint: { display: 'block', marginTop: 6, color: '#6b7280', fontSize: 12 },
  panel: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 16, boxShadow: '0 8px 24px rgba(15, 23, 42, 0.04)' },
  toolbar: { display: 'grid', gridTemplateColumns: 'minmax(260px, 1fr) 180px 180px 140px', gap: 10, marginBottom: 14 },
  search: { display: 'flex', alignItems: 'center', gap: 8, border: '1px solid #dbe3ea', borderRadius: 10, padding: '0 12px', background: '#fff' },
  searchInput: { flex: 1, height: 42, border: 0, outline: 0, color: '#111827', fontSize: 14 },
  select: { height: 42, border: '1px solid #dbe3ea', borderRadius: 10, padding: '0 12px', background: '#fff', color: '#111827', fontSize: 14 },
  exportButton: { height: 42, border: '1px solid #dbe3ea', borderRadius: 10, background: '#f9fafb', color: '#374151', fontWeight: 900, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 },
  alert: { borderRadius: 10, background: '#fef2f2', color: '#b91c1c', padding: 12, marginBottom: 12, fontWeight: 800, fontSize: 13 },
  list: { display: 'grid', gap: 12 },
  card: { border: '1px solid #e5e7eb', borderRadius: 12, padding: 16, background: '#fff' },
  cardTop: { display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'flex-start', marginBottom: 14 },
  person: { display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 },
  avatar: { width: 42, height: 42, borderRadius: 999, background: 'linear-gradient(135deg, #34d399, #059669)', color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 900 },
  cardTitle: { margin: 0, color: '#111827', fontSize: 16, fontWeight: 900 },
  cardMeta: { margin: '4px 0 0', color: '#6b7280', fontSize: 13 },
  statusBadge: { borderRadius: 999, padding: '6px 10px', fontSize: 12, fontWeight: 900, whiteSpace: 'nowrap' },
  badgeOk: { color: '#047857', background: '#d1fae5' },
  badgeWarn: { color: '#b45309', background: '#fef3c7' },
  badgeDanger: { color: '#b91c1c', background: '#fee2e2' },
  metrics: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 },
  metric: { borderRadius: 10, background: '#f9fafb', padding: 10, minWidth: 0 },
  cardActions: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 },
  rowButton: { height: 34, border: '1px solid #dbe3ea', borderRadius: 9, background: '#fff', color: '#047857', padding: '0 12px', fontWeight: 900, cursor: 'pointer' },
  rowPrimary: { height: 34, border: 0, borderRadius: 9, background: '#059669', color: '#fff', padding: '0 12px', fontWeight: 900, cursor: 'pointer' },
  empty: { display: 'grid', placeItems: 'center', gap: 8, border: '1px solid #e5e7eb', borderRadius: 12, background: '#fff', padding: 36, textAlign: 'center', color: '#6b7280' },
};
