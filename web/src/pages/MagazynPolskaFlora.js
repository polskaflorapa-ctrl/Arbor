import React, { useMemo, useState } from 'react';
import Sidebar from '../components/Sidebar';
import Inventory2Outlined from '@mui/icons-material/Inventory2Outlined';
import AddOutlined from '@mui/icons-material/AddOutlined';
import RemoveOutlined from '@mui/icons-material/RemoveOutlined';
import WarningAmberOutlined from '@mui/icons-material/WarningAmberOutlined';
import SearchOutlined from '@mui/icons-material/SearchOutlined';
import LocalOfferOutlined from '@mui/icons-material/LocalOfferOutlined';

function n(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function qty(value, unit) {
  return `${n(value).toLocaleString('pl-PL', { maximumFractionDigits: 3 })} ${unit || 'szt'}`;
}

function money(value) {
  return `${n(value).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} zl`;
}

function stockLevel(item) {
  if (item.niski_stan) return 'low';
  if (n(item.stan) <= 0) return 'empty';
  return 'ok';
}

export default function MagazynPolskaFlora({
  items = [],
  loading = false,
  msg = null,
  material,
  setMaterial,
  receipt,
  setReceipt,
  issue,
  setIssue,
  createMaterial,
  saveMove,
  blankMove,
  isDyrektor = false,
}) {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');

  const lowStock = items.filter((item) => item.niski_stan).length;
  const totalValue = items.reduce((sum, item) => sum + n(item.stan) * n(item.koszt_jednostkowy), 0);
  const selectedIssue = items.find((item) => String(item.id) === String(issue.material_id));

  const categories = useMemo(() => {
    const set = new Set(items.map((item) => item.kategoria).filter(Boolean));
    return Array.from(set).sort((a, b) => String(a).localeCompare(String(b), 'pl'));
  }, [items]);

  const filtered = items.filter((item) => {
    const text = [item.nazwa, item.kategoria, item.oddzial_nazwa].filter(Boolean).join(' ').toLowerCase();
    const query = search.trim().toLowerCase();
    return (!query || text.includes(query)) && (category === 'all' || item.kategoria === category);
  });

  return (
    <div className="app-shell warehouse-shell warehouse-polska-flora-shell" style={ui.shell}>
      <Sidebar />
      <main className="app-main warehouse-main warehouse-polska-flora-main" style={ui.main}>
        <div style={ui.header}>
          <div>
            <h1 style={ui.title}>Magazyn</h1>
            <p style={ui.subtitle}>Stany materialow, przyjecia i rozchod na zlecenie • {filtered.length} pozycji</p>
          </div>
          {msg?.text && <span style={{ ...ui.notice, ...(msg.type === 'error' ? ui.noticeError : {}) }}>{msg.text}</span>}
        </div>

        <div style={ui.stats}>
          <div style={ui.statCard}>
            <div style={ui.statLabel}><Inventory2Outlined fontSize="small" /> Pozycje</div>
            <strong style={ui.statNumber}>{items.length}</strong>
          </div>
          <div style={ui.statCard}>
            <div style={{ ...ui.statLabel, color: lowStock ? '#995510' : '#456b1f' }}><WarningAmberOutlined fontSize="small" /> Niski stan</div>
            <strong style={{ ...ui.statNumber, color: lowStock ? '#995510' : '#456b1f' }}>{lowStock}</strong>
          </div>
          <div style={ui.statCard}>
            <div style={ui.statLabel}><LocalOfferOutlined fontSize="small" /> Wartosc stanu</div>
            <strong style={ui.statNumber}>{money(totalValue)}</strong>
          </div>
        </div>

        <div style={ui.layout}>
          <section style={ui.sideColumn}>
            <form style={ui.panel} onSubmit={createMaterial}>
              <div style={ui.panelHeader}>
                <div>
                  <h2 style={ui.panelTitle}>Nowy material</h2>
                  <p style={ui.panelHint}>Dodaj pozycje magazynowa do rozliczen.</p>
                </div>
                <span style={ui.panelIcon}><AddOutlined fontSize="small" /></span>
              </div>
              <input style={ui.input} placeholder="Nazwa materialu" value={material.nazwa} onChange={(event) => setMaterial((form) => ({ ...form, nazwa: event.target.value }))} />
              <div style={ui.twoCols}>
                <input style={ui.input} placeholder="Jednostka" value={material.jednostka} onChange={(event) => setMaterial((form) => ({ ...form, jednostka: event.target.value }))} />
                <input style={ui.input} placeholder="Min. stan" type="number" value={material.min_stan} onChange={(event) => setMaterial((form) => ({ ...form, min_stan: event.target.value }))} />
              </div>
              <input style={ui.input} placeholder="Koszt jednostkowy" type="number" value={material.koszt_jednostkowy} onChange={(event) => setMaterial((form) => ({ ...form, koszt_jednostkowy: event.target.value }))} />
              <input style={ui.input} placeholder="Kategoria" value={material.kategoria} onChange={(event) => setMaterial((form) => ({ ...form, kategoria: event.target.value }))} />
              <button type="submit" style={ui.primaryButton}>Dodaj material</button>
            </form>

            <section style={ui.panel}>
              <div style={ui.panelHeader}>
                <div>
                  <h2 style={ui.panelTitle}>Przyjecie</h2>
                  <p style={ui.panelHint}>Zwieksz stan po dostawie.</p>
                </div>
                <span style={ui.panelIcon}><AddOutlined fontSize="small" /></span>
              </div>
              <select style={ui.input} value={receipt.material_id} onChange={(event) => setReceipt((form) => ({ ...form, material_id: event.target.value }))}>
                <option value="">Wybierz material</option>
                {items.map((item) => <option key={item.id} value={item.id}>{item.nazwa}</option>)}
              </select>
              <div style={ui.twoCols}>
                <input style={ui.input} placeholder="Ilosc" type="number" value={receipt.ilosc} onChange={(event) => setReceipt((form) => ({ ...form, ilosc: event.target.value }))} />
                <input style={ui.input} placeholder="Koszt jedn." type="number" value={receipt.koszt_jednostkowy} onChange={(event) => setReceipt((form) => ({ ...form, koszt_jednostkowy: event.target.value }))} />
              </div>
              <input style={ui.input} placeholder="Notatki" value={receipt.notatki} onChange={(event) => setReceipt((form) => ({ ...form, notatki: event.target.value }))} />
              <button type="button" style={ui.secondaryButton} onClick={() => saveMove('przyjecia', receipt, setReceipt)}>Zapisz przyjecie</button>
            </section>
          </section>

          <section style={ui.contentColumn}>
            <section style={ui.issuePanel}>
              <div>
                <h2 style={ui.panelTitle}>Rozchod na zlecenie</h2>
                <p style={ui.panelHint}>Zdejmij material ze stanu i przypisz go do pracy.</p>
              </div>
              <div style={ui.issueGrid}>
                <select style={ui.input} value={issue.material_id} onChange={(event) => setIssue((form) => ({ ...form, material_id: event.target.value }))}>
                  <option value="">Wybierz material</option>
                  {items.map((item) => <option key={item.id} value={item.id}>{item.nazwa} ({qty(item.stan, item.jednostka)})</option>)}
                </select>
                <input style={ui.input} placeholder="Ilosc" type="number" value={issue.ilosc} onChange={(event) => setIssue((form) => ({ ...form, ilosc: event.target.value }))} />
                <input style={ui.input} placeholder="ID zlecenia" value={issue.task_id} onChange={(event) => setIssue((form) => ({ ...form, task_id: event.target.value.replace(/[^\d]/g, '') }))} />
                <input style={ui.input} placeholder="Notatki" value={issue.notatki} onChange={(event) => setIssue((form) => ({ ...form, notatki: event.target.value }))} />
                <button type="button" style={ui.warningButton} onClick={() => saveMove('rozchody', issue, setIssue)}>
                  <RemoveOutlined fontSize="small" /> Rozchod
                </button>
              </div>
              {selectedIssue && <p style={ui.available}>Dostepne: {qty(selectedIssue.stan, selectedIssue.jednostka)}</p>}
            </section>

            <div style={ui.filters}>
              <label style={ui.search}>
                <SearchOutlined style={{ color: '#9a907a', fontSize: 20 }} />
                <input style={ui.searchInput} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Szukaj materialu, kategorii albo oddzialu..." />
              </label>
              <select style={ui.filterSelect} value={category} onChange={(event) => setCategory(event.target.value)}>
                <option value="all">Wszystkie kategorie</option>
                {categories.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </div>

            {loading && <div style={ui.empty}>Ladowanie magazynu...</div>}
            {!loading && filtered.length === 0 && (
              <div style={ui.empty}>
                <Inventory2Outlined style={{ fontSize: 46, color: '#e0d9c8' }} />
                <strong>Brak materialow</strong>
                <span>Dodaj pierwszy material albo zmien filtry.</span>
              </div>
            )}
            {!loading && filtered.length > 0 && (
              <div style={ui.list}>
                {filtered.map((item) => {
                  const level = stockLevel(item);
                  return (
                    <article key={item.id} style={ui.itemCard}>
                      <div style={ui.itemTop}>
                        <div style={ui.itemIdentity}>
                          <div style={{ ...ui.itemIcon, ...(level === 'low' ? ui.itemIconWarn : level === 'empty' ? ui.itemIconDanger : {}) }}>
                            <Inventory2Outlined fontSize="small" />
                          </div>
                          <div>
                            <h3 style={ui.itemTitle}>{item.nazwa}</h3>
                            <p style={ui.itemMeta}>
                              Min: {qty(item.min_stan, item.jednostka)}
                              {isDyrektor && item.oddzial_nazwa ? ` • Oddzial: ${item.oddzial_nazwa}` : ''}
                            </p>
                          </div>
                        </div>
                        <div style={ui.itemStock}>
                          <strong>{qty(item.stan, item.jednostka)}</strong>
                          <span>{money(item.koszt_jednostkowy)} / {item.jednostka || 'szt'}</span>
                        </div>
                      </div>
                      <div style={ui.itemFooter}>
                        {item.kategoria && <span style={ui.categoryPill}>{item.kategoria}</span>}
                        {level === 'low' && <span style={ui.warningPill}>Niski stan</span>}
                        {level === 'empty' && <span style={ui.dangerPill}>Brak stanu</span>}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

const ui = {
  shell: { display: 'flex', minHeight: '100vh', background: '#f0ebdd', color: '#2c2011' },
  main: { flex: 1, padding: 28, overflowX: 'hidden' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 22 },
  title: { margin: 0, fontSize: 26, lineHeight: 1.2, fontWeight: 800, color: '#2c2011' },
  subtitle: { margin: '6px 0 0', color: '#8a8069', fontSize: 14 },
  notice: { borderRadius: 10, padding: '9px 12px', background: '#f0ebdd', color: '#456b1f', fontSize: 13, fontWeight: 700 },
  noticeError: { background: '#f0ebdd', color: '#a3402a' },
  stats: { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(150px, 1fr))', gap: 14, marginBottom: 18 },
  statCard: { background: '#fff', border: '1px solid #f0ebdd', borderRadius: 12, padding: 16, boxShadow: '0 8px 24px rgba(15, 23, 42, 0.04)' },
  statLabel: { display: 'flex', alignItems: 'center', gap: 8, color: '#8a8069', textTransform: 'uppercase', fontSize: 12, fontWeight: 900, marginBottom: 8 },
  statNumber: { display: 'block', fontSize: 26, color: '#2c2011' },
  layout: { display: 'grid', gridTemplateColumns: '360px minmax(0, 1fr)', gap: 18, alignItems: 'start' },
  sideColumn: { display: 'grid', gap: 14 },
  contentColumn: { display: 'grid', gap: 14, minWidth: 0 },
  panel: { display: 'grid', gap: 12, background: '#fff', border: '1px solid #f0ebdd', borderRadius: 12, padding: 18, boxShadow: '0 8px 24px rgba(15, 23, 42, 0.04)' },
  issuePanel: { display: 'grid', gap: 12, background: '#fff', border: '1px solid #f0ebdd', borderRadius: 12, padding: 18, boxShadow: '0 8px 24px rgba(15, 23, 42, 0.04)' },
  panelHeader: { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' },
  panelTitle: { margin: 0, color: '#2c2011', fontSize: 17, fontWeight: 900 },
  panelHint: { margin: '4px 0 0', color: '#8a8069', fontSize: 13 },
  panelIcon: { width: 32, height: 32, borderRadius: 10, background: '#f0ebdd', color: '#456b1f', display: 'grid', placeItems: 'center' },
  twoCols: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 },
  input: { width: '100%', height: 42, border: '1px solid #e0d9c8', borderRadius: 10, padding: '0 12px', outline: 'none', color: '#2c2011', background: '#fff', fontSize: 14, boxSizing: 'border-box' },
  primaryButton: { height: 42, border: 0, borderRadius: 10, background: '#456b1f', color: '#fff', fontWeight: 900, cursor: 'pointer' },
  secondaryButton: { height: 42, border: '1px solid #7f8c12', borderRadius: 10, background: '#f0ebdd', color: '#456b1f', fontWeight: 900, cursor: 'pointer' },
  warningButton: { height: 42, border: 0, borderRadius: 10, background: '#bd701e', color: '#fff', fontWeight: 900, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 },
  issueGrid: { display: 'grid', gridTemplateColumns: 'minmax(210px, 1.2fr) 110px 120px minmax(160px, 1fr) 120px', gap: 10, alignItems: 'center' },
  available: { margin: 0, color: '#8a8069', fontSize: 13 },
  filters: { display: 'grid', gridTemplateColumns: 'minmax(240px, 1fr) 220px', gap: 12 },
  search: { display: 'flex', alignItems: 'center', gap: 8, background: '#fff', border: '1px solid #f0ebdd', borderRadius: 12, padding: '0 12px' },
  searchInput: { flex: 1, border: 0, outline: 0, height: 44, fontSize: 14, color: '#2c2011' },
  filterSelect: { border: '1px solid #f0ebdd', borderRadius: 12, background: '#fff', padding: '0 12px', fontSize: 14, color: '#2c2011' },
  list: { display: 'grid', gap: 12 },
  itemCard: { background: '#fff', border: '1px solid #f0ebdd', borderRadius: 12, padding: 18, boxShadow: '0 8px 24px rgba(15, 23, 42, 0.04)' },
  itemTop: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14 },
  itemIdentity: { display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 },
  itemIcon: { width: 44, height: 44, borderRadius: 12, display: 'grid', placeItems: 'center', color: '#456b1f', background: '#f0ebdd', flex: '0 0 auto' },
  itemIconWarn: { color: '#995510', background: '#f0ebdd' },
  itemIconDanger: { color: '#a3402a', background: '#f0ebdd' },
  itemTitle: { margin: 0, color: '#2c2011', fontSize: 16, fontWeight: 900 },
  itemMeta: { margin: '4px 0 0', color: '#8a8069', fontSize: 13 },
  itemStock: { textAlign: 'right', whiteSpace: 'nowrap' },
  itemFooter: { display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  categoryPill: { borderRadius: 999, padding: '5px 9px', color: '#5a5040', border: '1px solid #e0d9c8', fontSize: 12, fontWeight: 800 },
  warningPill: { borderRadius: 999, padding: '5px 9px', color: '#995510', background: '#fae7d2', fontSize: 12, fontWeight: 900 },
  dangerPill: { borderRadius: 999, padding: '5px 9px', color: '#a3402a', background: '#f6e0d9', fontSize: 12, fontWeight: 900 },
  empty: { display: 'grid', placeItems: 'center', gap: 8, border: '1px solid #f0ebdd', borderRadius: 12, background: '#fff', padding: 36, textAlign: 'center', color: '#8a8069' },
};
