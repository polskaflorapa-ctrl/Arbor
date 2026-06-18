import { useMemo, useState } from 'react';
import Sidebar from '../components/Sidebar';
import StatusMessage from '../components/StatusMessage';

function formatMoney(value) {
  return `${Number(value || 0).toLocaleString('pl-PL', { maximumFractionDigits: 0 })} zł`;
}

function normalizeStatus(value) {
  return String(value || 'Nowe').replace(/_/g, ' ');
}

function serviceIcon(value) {
  const text = String(value || '').toLowerCase();
  if (text.includes('wycinka')) return 'W';
  if (text.includes('piel')) return 'P';
  if (text.includes('dach')) return 'D';
  if (text.includes('kost') || text.includes('elew')) return 'K';
  if (text.includes('ogrod')) return 'O';
  return 'PF';
}

export default function ZleceniaPolskaFlora({
  tasks,
  allCount,
  loading,
  message,
  tone,
  search,
  setSearch,
  statusFilter,
  setStatusFilter,
  typeFilter,
  setTypeFilter,
  serviceTypes,
  navigate,
  onSelectTask,
}) {
  const [selectedTask, setSelectedTask] = useState(null);
  const statusCounts = useMemo(() => {
    const counts = { all: allCount || tasks.length };
    tasks.forEach((task) => {
      const key = String(task.status || 'Nowe');
      counts[key] = (counts[key] || 0) + 1;
    });
    return counts;
  }, [allCount, tasks]);

  const statuses = ['Nowe', 'Wycena_Terenowa', 'Do_Zatwierdzenia', 'Zaplanowane', 'W_Realizacji', 'Zakonczone'];

  const openTask = (task) => {
    setSelectedTask(task);
    onSelectTask?.(task);
  };

  return (
    <div style={s.shell}>
      <Sidebar />
      <main style={s.main}>
        <StatusMessage message={message || ''} tone={tone} style={message ? s.message : { display: 'none' }} />

        <header style={s.header}>
          <div>
            <h1 style={s.title}>Zlecenia</h1>
            <p style={s.subtitle}>Zarządzanie zleceniami • {tasks.length} wyników</p>
          </div>
          <button type="button" style={s.primaryBtn} onClick={() => navigate('/nowe-zlecenie')}>
            + Nowe zlecenie
          </button>
        </header>

        <section style={s.tabs}>
          <button type="button" style={{ ...s.tab, ...(!statusFilter ? s.tabActiveDark : {}) }} onClick={() => setStatusFilter('')}>
            Wszystkie ({statusCounts.all || 0})
          </button>
          {statuses.map((status) => (
            <button
              key={status}
              type="button"
              style={{ ...s.tab, ...(statusFilter === status ? s.tabActive : {}) }}
              onClick={() => setStatusFilter(statusFilter === status ? '' : status)}
            >
              {normalizeStatus(status)} ({statusCounts[status] || 0})
            </button>
          ))}
        </section>

        <section style={s.filters}>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Szukaj po nazwie klienta, adresie lub telefonie..."
            style={s.search}
          />
          <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} style={s.select}>
            <option value="">Wszystkie typy</option>
            {serviceTypes.map((type) => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
        </section>

        <section style={s.list}>
          {loading ? (
            <div style={s.empty}>Ładowanie zleceń...</div>
          ) : tasks.length === 0 ? (
            <div style={s.empty}>Brak zleceń. Zmień filtry albo dodaj nowe zlecenie.</div>
          ) : (
            tasks.map((task) => (
              <button key={task.id || task.numer} type="button" style={s.card} onClick={() => openTask(task)}>
                <span style={s.serviceBadge}>{serviceIcon(task.typ_uslugi)}</span>
                <span style={s.cardBody}>
                  <span style={s.cardTitle}>{task.klient_nazwa || 'Klient bez nazwy'}</span>
                  <span style={s.cardMeta}>{task.adres || 'Brak adresu'}{task.miasto ? `, ${task.miasto}` : ''}</span>
                  <span style={s.tags}>
                    <span>{task.typ_uslugi || 'Typ nieustalony'}</span>
                    {task.oddzial_nazwa ? <span>{task.oddzial_nazwa}</span> : null}
                    {task.klient_telefon ? <span>{task.klient_telefon}</span> : null}
                  </span>
                </span>
                <span style={s.cardSide}>
                  <strong>{formatMoney(task.wartosc_planowana)}</strong>
                  <small>{task.czas_planowany_godziny || task.czas_realizacji_godz || 0}h planowane</small>
                </span>
                <span style={s.status}>{normalizeStatus(task.status)}</span>
              </button>
            ))
          )}
        </section>

        {selectedTask ? (
          <div style={s.drawerLayer}>
            <button type="button" aria-label="Zamknij szczegóły" style={s.drawerBackdrop} onClick={() => setSelectedTask(null)} />
            <aside style={s.drawer}>
              <div style={s.drawerHeader}>
                <h2>Szczegóły zlecenia</h2>
                <button type="button" style={s.closeBtn} onClick={() => setSelectedTask(null)}>×</button>
              </div>
              <div style={s.drawerBody}>
                <span style={s.serviceBadgeLarge}>{serviceIcon(selectedTask.typ_uslugi)}</span>
                <h3>{selectedTask.klient_nazwa || 'Klient bez nazwy'}</h3>
                <p>{selectedTask.adres || 'Brak adresu'}{selectedTask.miasto ? `, ${selectedTask.miasto}` : ''}</p>
                <div style={s.detailGrid}>
                  <div><small>Status</small><strong>{normalizeStatus(selectedTask.status)}</strong></div>
                  <div><small>Typ usługi</small><strong>{selectedTask.typ_uslugi || '-'}</strong></div>
                  <div><small>Wartość</small><strong>{formatMoney(selectedTask.wartosc_planowana)}</strong></div>
                  <div><small>Telefon</small><strong>{selectedTask.klient_telefon || '-'}</strong></div>
                </div>
                <button type="button" style={s.primaryWide} onClick={() => navigate(`/zlecenia/${selectedTask.id}`)}>Otwórz pełne zlecenie</button>
              </div>
            </aside>
          </div>
        ) : null}
      </main>
    </div>
  );
}

const s = {
  shell: { display: 'flex', minHeight: '100vh', background: '#f8fafc' },
  main: { flex: 1, minWidth: 0, marginLeft: 256, padding: '24px', color: '#111827' },
  message: { marginBottom: 16 },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 22 },
  title: { margin: 0, fontSize: 28, fontWeight: 850, color: '#111827' },
  subtitle: { margin: '6px 0 0', color: '#6b7280', fontSize: 14 },
  primaryBtn: { border: 0, borderRadius: 12, background: '#059669', color: '#fff', padding: '12px 16px', fontWeight: 800, cursor: 'pointer' },
  tabs: { display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  tab: { border: '1px solid #e5e7eb', borderRadius: 10, background: '#fff', color: '#4b5563', padding: '9px 13px', fontSize: 13, fontWeight: 800, cursor: 'pointer' },
  tabActiveDark: { background: '#111827', color: '#fff', borderColor: '#111827' },
  tabActive: { background: '#d1fae5', color: '#047857', borderColor: '#a7f3d0' },
  filters: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 240px', gap: 12, marginBottom: 18 },
  search: { border: '1px solid #e5e7eb', borderRadius: 12, background: '#fff', padding: '12px 14px', fontSize: 14, outline: 'none' },
  select: { border: '1px solid #e5e7eb', borderRadius: 12, background: '#fff', padding: '12px 14px', fontSize: 14, outline: 'none' },
  list: { display: 'grid', gap: 12 },
  card: { width: '100%', display: 'grid', gridTemplateColumns: '44px minmax(0, 1fr) auto auto', alignItems: 'center', gap: 16, border: '1px solid #eef2f7', borderRadius: 14, background: '#fff', padding: 18, textAlign: 'left', cursor: 'pointer', boxShadow: '0 1px 2px rgba(15,23,42,0.04)' },
  serviceBadge: { width: 38, height: 38, borderRadius: 12, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: '#ecfdf5', color: '#047857', fontWeight: 900 },
  cardBody: { display: 'grid', gap: 6, minWidth: 0 },
  cardTitle: { color: '#111827', fontSize: 16, fontWeight: 850 },
  cardMeta: { color: '#6b7280', fontSize: 13 },
  tags: { display: 'flex', flexWrap: 'wrap', gap: 6, color: '#6b7280', fontSize: 11 },
  cardSide: { display: 'grid', gap: 3, justifyItems: 'end', color: '#111827' },
  status: { borderRadius: 999, background: '#ecfdf5', color: '#047857', padding: '7px 10px', fontSize: 12, fontWeight: 850 },
  empty: { padding: 40, borderRadius: 14, background: '#fff', border: '1px solid #eef2f7', color: '#9ca3af', textAlign: 'center', fontWeight: 800 },
  drawerLayer: { position: 'fixed', inset: 0, zIndex: 800, display: 'flex', justifyContent: 'flex-end' },
  drawerBackdrop: { position: 'absolute', inset: 0, border: 0, background: 'rgba(15,23,42,0.42)' },
  drawer: { position: 'relative', width: 'min(520px, 100vw)', height: '100%', background: '#fff', boxShadow: '-24px 0 60px rgba(15,23,42,0.2)', overflowY: 'auto' },
  drawerHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 22px', borderBottom: '1px solid #eef2f7' },
  closeBtn: { border: 0, background: '#f3f4f6', borderRadius: 10, width: 36, height: 36, fontSize: 24, cursor: 'pointer' },
  drawerBody: { padding: 24 },
  serviceBadgeLarge: { width: 58, height: 58, borderRadius: 18, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: '#ecfdf5', color: '#047857', fontWeight: 900, fontSize: 20 },
  detailGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, margin: '22px 0' },
  primaryWide: { width: '100%', border: 0, borderRadius: 12, background: '#059669', color: '#fff', padding: 13, fontWeight: 900, cursor: 'pointer' },
};
