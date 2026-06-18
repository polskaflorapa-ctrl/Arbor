import React, { useMemo, useState } from 'react';
import Sidebar from '../components/Sidebar';
import LocalShippingOutlined from '@mui/icons-material/LocalShippingOutlined';
import SearchOutlined from '@mui/icons-material/SearchOutlined';
import LocationOnOutlined from '@mui/icons-material/LocationOnOutlined';
import BuildOutlined from '@mui/icons-material/BuildOutlined';
import CheckCircleOutlineOutlined from '@mui/icons-material/CheckCircleOutlineOutlined';
import SpeedOutlined from '@mui/icons-material/SpeedOutlined';
import WarningAmberOutlined from '@mui/icons-material/WarningAmberOutlined';
import CloseOutlined from '@mui/icons-material/CloseOutlined';

const TYPE = {
  pojazd: { label: 'Pojazd', icon: '🚛' },
  sprzet: { label: 'Sprzet', icon: '🔧' },
};

function getId(value) {
  return value == null ? '' : String(value);
}

function normalizeStatus(value) {
  const raw = String(value || '').toLowerCase();
  if (raw.includes('serwis') || raw.includes('napraw')) return 'w_serwisie';
  if (raw.includes('uzy') || raw.includes('uży') || raw.includes('zaj')) return 'w_uzyciu';
  if (raw.includes('likwid') || raw.includes('wycof')) return 'likwidowany';
  return 'dostepny';
}

const STATUS = {
  dostepny: { label: 'Dostepny', color: '#047857', bg: '#d1fae5', icon: <CheckCircleOutlineOutlined fontSize="small" /> },
  w_uzyciu: { label: 'W uzyciu', color: '#1d4ed8', bg: '#dbeafe', icon: <SpeedOutlined fontSize="small" /> },
  w_serwisie: { label: 'W serwisie', color: '#b45309', bg: '#fef3c7', icon: <BuildOutlined fontSize="small" /> },
  likwidowany: { label: 'Zlikwidowany', color: '#b91c1c', bg: '#fee2e2', icon: <WarningAmberOutlined fontSize="small" /> },
};

function assetName(item) {
  return item.kind === 'pojazd'
    ? [item.marka, item.model].filter(Boolean).join(' ') || item.nazwa || `Pojazd #${item.id}`
    : item.nazwa || [item.typ, item.model].filter(Boolean).join(' ') || `Sprzet #${item.id}`;
}

function assetRegistration(item) {
  return item.nr_rejestracyjny || item.numer_rejestracyjny || item.serial || item.nr_seryjny || '';
}

function dueSoon(value) {
  if (!value) return false;
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return false;
  const days = (time - Date.now()) / 86400000;
  return days <= 30;
}

export default function FlotaPolskaFlora({
  pojazdy = [],
  sprzet = [],
  filtrPojazdy = [],
  filtrSprzet = [],
  oddzialy = [],
  loading = false,
  msg = null,
  canEdit = false,
  onAdd,
}) {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedAsset, setSelectedAsset] = useState(null);

  const branchById = useMemo(() => new Map(oddzialy.map((branch) => [getId(branch.id), branch])), [oddzialy]);
  const allAssets = useMemo(() => [
    ...(filtrPojazdy.length ? filtrPojazdy : pojazdy).map((item) => ({ ...item, kind: 'pojazd' })),
    ...(filtrSprzet.length ? filtrSprzet : sprzet).map((item) => ({ ...item, kind: 'sprzet' })),
  ], [filtrPojazdy, filtrSprzet, pojazdy, sprzet]);

  const filtered = allAssets.filter((item) => {
    const query = search.trim().toLowerCase();
    const status = normalizeStatus(item.status);
    const haystack = [assetName(item), assetRegistration(item), item.typ, item.marka, item.model].filter(Boolean).join(' ').toLowerCase();
    return (!query || haystack.includes(query)) && (typeFilter === 'all' || item.kind === typeFilter) && (statusFilter === 'all' || status === statusFilter);
  });

  const stats = Object.keys(STATUS).map((key) => ({ key, count: allAssets.filter((item) => normalizeStatus(item.status) === key).length }));

  return (
    <div style={ui.shell}>
      <Sidebar />
      <main style={ui.main}>
        <div style={ui.header}>
          <div>
            <h1 style={ui.title}>Sprzet</h1>
            <p style={ui.subtitle}>Zarzadzanie sprzetem i pojazdami • {filtered.length} pozycji</p>
          </div>
          <div style={ui.headerActions}>
            {msg?.text && <span style={{ ...ui.notice, ...(msg.type === 'error' ? ui.noticeError : {}) }}>{msg.text}</span>}
            {canEdit && <button type="button" style={ui.primaryButton} onClick={onAdd}>+ Dodaj zasob</button>}
          </div>
        </div>

        <div style={ui.statsGrid}>
          {stats.map(({ key, count }) => (
            <div key={key} style={ui.statCard}>
              <div style={{ ...ui.statLabel, color: STATUS[key].color }}>
                {STATUS[key].icon}
                <span>{STATUS[key].label}</span>
              </div>
              <strong style={ui.statNumber}>{count}</strong>
            </div>
          ))}
        </div>

        <div style={ui.filters}>
          <label style={ui.searchBox}>
            <SearchOutlined style={{ color: '#9ca3af', fontSize: 20 }} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Szukaj po nazwie lub numerze rejestracyjnym..." style={ui.input} />
          </label>
          <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} style={ui.select}>
            <option value="all">Wszystkie typy</option>
            <option value="pojazd">🚛 Pojazdy</option>
            <option value="sprzet">🔧 Sprzet</option>
          </select>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} style={ui.select}>
            <option value="all">Wszystkie statusy</option>
            {Object.entries(STATUS).map(([key, config]) => <option key={key} value={key}>{config.label}</option>)}
          </select>
        </div>

        {loading ? (
          <div style={ui.empty}>Ladowanie zasobow...</div>
        ) : (
          <div style={ui.assetGrid}>
            {filtered.map((item) => {
              const status = STATUS[normalizeStatus(item.status)];
              const branch = branchById.get(getId(item.oddzial_id));
              const inspectionDate = item.data_nastepnego_przegladu || item.przeglad_do || item.badanie_do;
              return (
                <button key={`${item.kind}:${item.id}`} type="button" style={ui.assetCard} onClick={() => setSelectedAsset(item)}>
                  <div style={ui.assetIcon}>{TYPE[item.kind].icon}</div>
                  <div style={ui.assetContent}>
                    <div style={ui.assetTop}>
                      <div>
                        <h3 style={ui.cardTitle}>{assetName(item)}</h3>
                        {assetRegistration(item) && <span style={ui.plate}>{assetRegistration(item)}</span>}
                      </div>
                      <span style={{ ...ui.status, background: status.bg, color: status.color }}>{status.icon}{status.label}</span>
                    </div>
                    <div style={ui.assetMeta}>
                      <span><LocationOnOutlined style={ui.tinyIcon} />{branch?.nazwa || 'Bez oddzialu'}</span>
                      <span>{item.koszt_motogodziny || item.stawka || item.koszt_godziny || 0} zl/mth</span>
                    </div>
                    {dueSoon(inspectionDate) && (
                      <div style={ui.warning}>
                        <WarningAmberOutlined fontSize="small" />
                        <span>Przeglad: {new Date(inspectionDate).toLocaleDateString('pl-PL')}</span>
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <div style={ui.empty}>
            <LocalShippingOutlined style={{ fontSize: 46, color: '#d1d5db' }} />
            <strong>Brak sprzetu</strong>
            <span>Zmien filtry lub dodaj nowy zasob.</span>
          </div>
        )}

        {selectedAsset && (
          <div style={ui.drawerLayer}>
            <button type="button" aria-label="Zamknij" style={ui.backdrop} onClick={() => setSelectedAsset(null)} />
            <aside style={ui.drawer}>
              <div style={ui.drawerHeader}>
                <h2 style={ui.drawerTitle}>Szczegoly zasobu</h2>
                <button type="button" style={ui.iconButton} onClick={() => setSelectedAsset(null)}><CloseOutlined fontSize="small" /></button>
              </div>
              <div style={ui.drawerBody}>
                <div style={ui.detailHero}>
                  <div style={ui.detailIcon}>{TYPE[selectedAsset.kind].icon}</div>
                  <div>
                    <h3 style={ui.detailTitle}>{assetName(selectedAsset)}</h3>
                    <span style={{ ...ui.status, background: STATUS[normalizeStatus(selectedAsset.status)].bg, color: STATUS[normalizeStatus(selectedAsset.status)].color }}>
                      {STATUS[normalizeStatus(selectedAsset.status)].icon}{STATUS[normalizeStatus(selectedAsset.status)].label}
                    </span>
                  </div>
                </div>
                <div style={ui.infoList}>
                  <p><span>Typ</span><strong>{TYPE[selectedAsset.kind].label}</strong></p>
                  <p><span>Numer</span><strong>{assetRegistration(selectedAsset) || '-'}</strong></p>
                  <p><span>Oddzial</span><strong>{branchById.get(getId(selectedAsset.oddzial_id))?.nazwa || '-'}</strong></p>
                  <p><span>Koszt</span><strong>{selectedAsset.koszt_motogodziny || selectedAsset.stawka || selectedAsset.koszt_godziny || 0} zl</strong></p>
                </div>
                <div style={ui.infoList}>
                  <p><span>Nastepny przeglad</span><strong>{selectedAsset.data_nastepnego_przegladu || selectedAsset.przeglad_do || '-'}</strong></p>
                  <p><span>Ubezpieczenie</span><strong>{selectedAsset.data_ubezpieczenia || selectedAsset.oc_do || '-'}</strong></p>
                </div>
              </div>
            </aside>
          </div>
        )}
      </main>
    </div>
  );
}

const ui = {
  shell: { display: 'flex', minHeight: '100vh', background: '#f8fafc', color: '#111827' },
  main: { flex: 1, padding: 28, overflowX: 'hidden' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 22 },
  title: { margin: 0, fontSize: 26, lineHeight: 1.2, fontWeight: 800, color: '#111827' },
  subtitle: { margin: '6px 0 0', color: '#6b7280', fontSize: 14 },
  headerActions: { display: 'flex', alignItems: 'center', gap: 10 },
  primaryButton: { border: 0, borderRadius: 10, background: '#059669', color: '#fff', padding: '10px 14px', fontWeight: 800, cursor: 'pointer' },
  notice: { borderRadius: 10, padding: '9px 12px', background: '#ecfdf5', color: '#047857', fontSize: 13, fontWeight: 700 },
  noticeError: { background: '#fef2f2', color: '#b91c1c' },
  statsGrid: { display: 'grid', gridTemplateColumns: 'repeat(4, minmax(120px, 1fr))', gap: 14, marginBottom: 18 },
  statCard: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 16, boxShadow: '0 8px 24px rgba(15, 23, 42, 0.04)' },
  statLabel: { display: 'flex', alignItems: 'center', gap: 8, textTransform: 'uppercase', fontSize: 12, fontWeight: 900, marginBottom: 8 },
  statNumber: { display: 'block', fontSize: 28, color: '#111827' },
  filters: { display: 'grid', gridTemplateColumns: 'minmax(240px, 1fr) 180px 180px', gap: 12, marginBottom: 18 },
  searchBox: { display: 'flex', alignItems: 'center', gap: 8, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '0 12px' },
  input: { flex: 1, border: 0, outline: 0, height: 44, fontSize: 14, color: '#111827' },
  select: { border: '1px solid #e5e7eb', borderRadius: 12, background: '#fff', padding: '0 12px', fontSize: 14, color: '#111827' },
  assetGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16 },
  assetCard: { display: 'flex', alignItems: 'flex-start', gap: 16, textAlign: 'left', border: '1px solid #e5e7eb', background: '#fff', borderRadius: 12, padding: 18, cursor: 'pointer', boxShadow: '0 8px 24px rgba(15, 23, 42, 0.04)' },
  assetIcon: { width: 48, height: 48, borderRadius: 12, background: '#f3f4f6', display: 'grid', placeItems: 'center', fontSize: 25, flex: '0 0 auto' },
  assetContent: { minWidth: 0, flex: 1 },
  assetTop: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  cardTitle: { margin: 0, fontSize: 16, color: '#111827', fontWeight: 800 },
  plate: { display: 'inline-block', marginTop: 6, borderRadius: 6, background: '#f3f4f6', padding: '3px 7px', color: '#4b5563', fontFamily: 'monospace', fontSize: 12, fontWeight: 900 },
  status: { display: 'inline-flex', alignItems: 'center', gap: 5, borderRadius: 999, padding: '5px 9px', fontSize: 12, fontWeight: 900, whiteSpace: 'nowrap' },
  assetMeta: { display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 12, color: '#6b7280', fontSize: 12 },
  tinyIcon: { fontSize: 14, verticalAlign: 'middle', marginRight: 4 },
  warning: { display: 'flex', alignItems: 'center', gap: 7, marginTop: 12, borderRadius: 10, background: '#fffbeb', border: '1px solid #fde68a', color: '#b45309', padding: '9px 10px', fontSize: 12, fontWeight: 800 },
  empty: { display: 'grid', placeItems: 'center', gap: 8, border: '1px solid #e5e7eb', borderRadius: 12, background: '#fff', padding: 36, textAlign: 'center', color: '#6b7280' },
  drawerLayer: { position: 'fixed', inset: 0, zIndex: 60, display: 'flex', justifyContent: 'flex-end' },
  backdrop: { position: 'absolute', inset: 0, border: 0, background: 'rgba(15, 23, 42, 0.42)' },
  drawer: { position: 'relative', width: 'min(100%, 430px)', background: '#fff', height: '100%', overflowY: 'auto', boxShadow: '-24px 0 60px rgba(15, 23, 42, 0.22)' },
  drawerHeader: { position: 'sticky', top: 0, zIndex: 1, background: '#fff', borderBottom: '1px solid #e5e7eb', padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  drawerTitle: { margin: 0, fontSize: 18, color: '#111827' },
  iconButton: { border: 0, borderRadius: 10, width: 36, height: 36, display: 'grid', placeItems: 'center', background: '#f3f4f6', cursor: 'pointer' },
  drawerBody: { padding: 22, display: 'grid', gap: 20 },
  detailHero: { display: 'flex', alignItems: 'center', gap: 14 },
  detailIcon: { width: 64, height: 64, borderRadius: 16, display: 'grid', placeItems: 'center', fontSize: 32, background: '#f3f4f6' },
  detailTitle: { margin: '0 0 8px', fontSize: 21, color: '#111827' },
  infoList: { display: 'grid', gap: 0, borderRadius: 12, background: '#f9fafb', padding: 14 },
};
