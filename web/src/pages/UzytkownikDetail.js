import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import Sidebar from '../components/Sidebar';
import StatusMessage from '../components/StatusMessage';
import { errorMessage, successMessage } from '../utils/statusMessage';
import useTimedMessage from '../hooks/useTimedMessage';
import { getLocalStorageJson } from '../utils/safeJsonLocalStorage';
import { getStoredToken, authHeaders } from '../utils/storedToken';


const ROLE_KOLORY = {
  Dyrektor: 'var(--accent)',
  Kierownik: '#43A047',
  Brygadzista: '#66BB6A',
  Administrator: '#F9A825',
  Pomocnik: '#A5D6A7'
};

const ROLE_IKONY = {
  Dyrektor: '👔',
  Kierownik: '📋',
  Brygadzista: '👷',
  Administrator: '⚙️',
  Pomocnik: '👤'
};

export default function Uzytkownicy() {
  const [uzytkownicy, setUzytkownicy] = useState([]);
  const [oddzialy, setOddzialy] = useState([]);
  const [loading, setLoading] = useState(true);
  const { message: msg, showMessage: showMsg } = useTimedMessage();
  const [filtrOddzial, setFiltrOddzial] = useState('');
  const [filtrRola, setFiltrRola] = useState('');
  const [filtrStatus, setFiltrStatus] = useState('aktywni');
  const [searchTerm, setSearchTerm] = useState('');
  const [currentUser, setCurrentUser] = useState(null);
  const navigate = useNavigate();

  const isDyrektor = (u) => u?.rola === 'Dyrektor' || u?.rola === 'Administrator';
  const isKierownik = (u) => u?.rola === 'Kierownik';

  const loadAll = useCallback(async () => {
    try {
      const token = getStoredToken();
      const h = authHeaders(token);
      const [uRes, oRes] = await Promise.all([
        api.get(`/uzytkownicy`, { headers: h }),
        api.get(`/oddzialy`, { headers: h }),
      ]);
      setUzytkownicy(uRes.data);
      setOddzialy(oRes.data);
    } catch (err) {
      console.log('Błąd ładowania:', err);
      showMsg(errorMessage('Błąd ładowania danych'));
    } finally {
      setLoading(false);
    }
  }, [showMsg]);

  useEffect(() => {
    const token = getStoredToken();
    if (!token) { navigate('/'); return; }
    const parsed = getLocalStorageJson('user');
    if (parsed) {
      setCurrentUser(parsed);
      if (isKierownik(parsed)) {
        setFiltrOddzial(parsed.oddzial_id?.toString());
      }
    }
    loadAll();
  }, [navigate, loadAll]);

  const toggleAktywny = async (e, id, aktywny) => {
    e.stopPropagation();
    try {
      const token = getStoredToken();
      await api.put(`/uzytkownicy/${id}/aktywny`, { aktywny: !aktywny }, {
        headers: authHeaders(token)
      });
      showMsg(successMessage(aktywny ? 'Użytkownik dezaktywowany' : 'Użytkownik aktywowany'));
      loadAll();
    } catch (err) {
      showMsg(errorMessage('Błąd zmiany statusu'));
    }
  };

  const filtrowane = uzytkownicy.filter(u => {
    if (filtrOddzial && u.oddzial_id?.toString() !== filtrOddzial) return false;
    if (filtrRola && u.rola !== filtrRola) return false;
    if (filtrStatus === 'aktywni' && !u.aktywny) return false;
    if (filtrStatus === 'nieaktywni' && u.aktywny) return false;
    if (searchTerm && !`${u.imie} ${u.nazwisko} ${u.login} ${u.email}`.toLowerCase().includes(searchTerm.toLowerCase())) return false;
    return true;
  });

  const statsByRola = (rola) => filtrowane.filter(u => u.rola === rola).length;
  const aktywniCount = filtrowane.filter(u => u.aktywny).length;
  const clearFilters = () => {
    setFiltrRola('');
    setFiltrStatus('aktywni');
    setSearchTerm('');
    if (isDyrektor(currentUser)) setFiltrOddzial('');
  };

  return (
    <div style={styles.container}>
      <Sidebar />
      <div style={styles.main}>
        {/* Nagłówek */}
        <div style={styles.headerRow}>
          <div>
            <h1 style={styles.title}>👥 Użytkownicy</h1>
            <p style={styles.sub}>
              {filtrowane.length} z {uzytkownicy.length} pracowników
              {filtrOddzial && oddzialy.find(o => o.id.toString() === filtrOddzial) && ` · ${oddzialy.find(o => o.id.toString() === filtrOddzial)?.nazwa}`}
            </p>
          </div>
          <div style={styles.headerRight}>
            <StatusMessage message={msg} />
            {isDyrektor(currentUser) && (
              <button style={styles.addBtn} onClick={() => navigate('/nowy-pracownik')}>
                + Nowy pracownik
              </button>
            )}
          </div>
        </div>

        {/* KPI */}
        <div style={styles.kpiRow}>
          <div style={{...styles.kpi, borderTopColor: '#66BB6A'}}>
            <div style={styles.kpiIcon}>👷</div>
            <div style={styles.kpiNum}>{statsByRola('Brygadzista')}</div>
            <div style={styles.kpiLabel}>Brygadziści</div>
          </div>
          <div style={{...styles.kpi, borderTopColor: '#43A047'}}>
            <div style={styles.kpiIcon}>📋</div>
            <div style={styles.kpiNum}>{statsByRola('Kierownik')}</div>
            <div style={styles.kpiLabel}>Kierownicy</div>
          </div>
          <div style={{...styles.kpi, borderTopColor: 'var(--accent)'}}>
            <div style={styles.kpiIcon}>👔</div>
            <div style={styles.kpiNum}>{statsByRola('Dyrektor') + statsByRola('Administrator')}</div>
            <div style={styles.kpiLabel}>Dyrektorzy/Admini</div>
          </div>
          <div style={{...styles.kpi, borderTopColor: '#4CAF50'}}>
            <div style={styles.kpiIcon}>✅</div>
            <div style={styles.kpiNum}>{aktywniCount}</div>
            <div style={styles.kpiLabel}>Aktywni</div>
          </div>
        </div>

        {/* Filtry */}
        <div style={styles.filtryRow}>
          <div style={styles.searchBox}>
            <span style={styles.searchIcon}>🔍</span>
            <input
              style={styles.searchInput}
              type="text"
              placeholder="Szukaj po imieniu, nazwisku, loginie..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
          {isDyrektor(currentUser) && (
            <div style={styles.filtrGroup}>
              <label style={styles.filtrLabel}>Oddział:</label>
              <select style={styles.filtrSelect} value={filtrOddzial} onChange={e => setFiltrOddzial(e.target.value)}>
                <option value="">🌍 Wszystkie oddziały</option>
                {oddzialy.map(o => <option key={o.id} value={o.id}>🏢 {o.nazwa}</option>)}
              </select>
            </div>
          )}
          <div style={styles.filtrGroup}>
            <label style={styles.filtrLabel}>Rola:</label>
            <select style={styles.filtrSelect} value={filtrRola} onChange={e => setFiltrRola(e.target.value)}>
              <option value="">📋 Wszystkie role</option>
              <option value="Brygadzista">👷 Brygadzista</option>
              <option value="Kierownik">📋 Kierownik</option>
              <option value="Dyrektor">👔 Dyrektor</option>
              <option value="Administrator">⚙️ Administrator</option>
              <option value="Pomocnik">👤 Pomocnik</option>
            </select>
          </div>
          <div style={styles.filtrGroup}>
            <label style={styles.filtrLabel}>Status:</label>
            <select style={styles.filtrSelect} value={filtrStatus} onChange={e => setFiltrStatus(e.target.value)}>
              <option value="wszyscy">👥 Wszyscy</option>
              <option value="aktywni">✅ Aktywni</option>
              <option value="nieaktywni">❌ Nieaktywni</option>
            </select>
          </div>
          {(filtrRola || filtrStatus !== 'aktywni' || filtrOddzial || searchTerm) && (
            <button style={styles.clearBtn} onClick={clearFilters}>
              ✕ Wyczyść filtry
            </button>
          )}
        </div>

        {/* Lista użytkowników */}
        {loading ? (
          <div style={styles.loading}>⏳ Ładowanie użytkowników...</div>
        ) : (
          <div style={styles.tableWrap}>
            {oddzialy.filter(o => !filtrOddzial || o.id.toString() === filtrOddzial).map(oddzial => {
              const pracownicy = filtrowane.filter(u => u.oddzial_id === oddzial.id);
              if (pracownicy.length === 0) return null;
              return (
                <div key={oddzial.id} style={styles.oddzialSection}>
                  <div style={styles.oddzialHeader}>
                    <div>
                      <span style={styles.oddzialIcon}>🏢</span>
                      <span style={styles.oddzialNazwa}>{oddzial.nazwa}</span>
                    </div>
                    <span style={styles.oddzialCount}>{pracownicy.length} pracowników</span>
                  </div>
                  <div style={styles.tableScroll}>
                    <table style={styles.table}>
                      <thead>
                        <tr>
                          <th style={styles.th}>Pracownik</th>
                          <th style={styles.th}>Login</th>
                          <th style={styles.th}>Rola</th>
                          <th style={styles.th}>Telefon</th>
                          <th style={styles.th}>Wynagrodzenie</th>
                          <th style={styles.th}>Status</th>
                          <th style={styles.th}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {pracownicy.map((u, i) => (
                          <tr key={u.id}
                            style={{ backgroundColor: i % 2 === 0 ? 'var(--bg-card)' : 'var(--bg-deep)', cursor: 'pointer' }}
                            onClick={() => navigate(`/uzytkownicy/${u.id}`)}>
                            <td style={{...styles.td, fontWeight: '600'}}>
                              <div style={styles.avatarRow}>
                                <div style={{...styles.avatarSmall, backgroundColor: (ROLE_KOLORY[u.rola] || '#6B7280') + '22', color: ROLE_KOLORY[u.rola] || '#6B7280'}}>
                                  {u.imie?.[0]}{u.nazwisko?.[0]}
                                </div>
                                <div>
                                  <div>{u.imie} {u.nazwisko}</div>
                                  {u.stanowisko && <div style={styles.stanowisko}>{u.stanowisko}</div>}
                                </div>
                              </div>
                            </td>
                            <td style={{...styles.td, color: 'var(--text-muted)'}}>@{u.login}</td>
                            <td style={styles.td}>
                              <span style={{...styles.roleBadge, backgroundColor: ROLE_KOLORY[u.rola] || '#6B7280'}}>
                                {ROLE_IKONY[u.rola]} {u.rola}
                              </span>
                            </td>
                            <td style={styles.td}>{u.telefon || '-'}</td>
                            <td style={{...styles.td, fontWeight: '600', color: 'var(--accent)'}}>
                              {u.rola === 'Brygadzista'
                                ? <span style={styles.procentBadge}>{u.procent_wynagrodzenia || 15}%</span>
                                : `${u.stawka_godzinowa || 0} PLN/h`
                              }
                            </td>
                            <td style={styles.td}>
                              <span style={{...styles.statusBadge, backgroundColor: u.aktywny ? '#4CAF50' : '#EF5350'}}>
                                {u.aktywny ? '✅ Aktywny' : '❌ Nieaktywny'}
                              </span>
                            </td>
                            <td style={styles.td} onClick={e => e.stopPropagation()}>
                              <div style={styles.actionButtons}>
                                <button style={styles.editBtn} onClick={() => navigate(`/uzytkownicy/${u.id}`)} title="Edytuj">
                                  ✏️
                                </button>
                                {isDyrektor(currentUser) && (
                                  <button
                                    style={{...styles.toggleBtn, backgroundColor: u.aktywny ? '#FFF8E1' : 'rgba(52,211,153,0.1)', color: u.aktywny ? '#F9A825' : 'var(--accent)'}}
                                    onClick={(e) => toggleAktywny(e, u.id, u.aktywny)}
                                    title={u.aktywny ? 'Dezaktywuj' : 'Aktywuj'}>
                                    {u.aktywny ? '🔴' : '🟢'}
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}

            {/* Pracownicy bez oddziału */}
            {filtrowane.filter(u => !u.oddzial_id).length > 0 && (
              <div style={styles.oddzialSection}>
                <div style={{...styles.oddzialHeader, backgroundColor: 'var(--bg-deep)'}}>
                  <div>
                    <span style={styles.oddzialIcon}>⚠️</span>
                    <span style={styles.oddzialNazwa}>Bez przypisanego oddziału</span>
                  </div>
                  <span style={styles.oddzialCount}>{filtrowane.filter(u => !u.oddzial_id).length} pracowników</span>
                </div>
                <div style={styles.tableScroll}>
                  <table style={styles.table}>
                    <thead>
                      <tr>
                        <th style={styles.th}>Pracownik</th>
                        <th style={styles.th}>Login</th>
                        <th style={styles.th}>Rola</th>
                        <th style={styles.th}>Telefon</th>
                        <th style={styles.th}>Wynagrodzenie</th>
                        <th style={styles.th}>Status</th>
                        <th style={styles.th}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtrowane.filter(u => !u.oddzial_id).map((u, i) => (
                        <tr key={u.id}
                          style={{ backgroundColor: i % 2 === 0 ? 'var(--bg-card)' : 'var(--bg-deep)', cursor: 'pointer' }}
                          onClick={() => navigate(`/uzytkownicy/${u.id}`)}>
                          <td style={{...styles.td, fontWeight: '600'}}>
                            <div style={styles.avatarRow}>
                              <div style={{...styles.avatarSmall, backgroundColor: (ROLE_KOLORY[u.rola] || '#6B7280') + '22', color: ROLE_KOLORY[u.rola] || '#6B7280'}}>
                                {u.imie?.[0]}{u.nazwisko?.[0]}
                              </div>
                              {u.imie} {u.nazwisko}
                            </div>
                          </td>
                          <td style={{...styles.td, color: 'var(--text-muted)'}}>@{u.login}</td>
                          <td style={styles.td}>
                            <span style={{...styles.roleBadge, backgroundColor: ROLE_KOLORY[u.rola] || '#6B7280'}}>
                              {ROLE_IKONY[u.rola]} {u.rola}
                            </span>
                          </td>
                          <td style={styles.td}>{u.telefon || '-'}</td>
                          <td style={{...styles.td, fontWeight: '600', color: 'var(--accent)'}}>
                            {u.rola === 'Brygadzista'
                              ? <span style={styles.procentBadge}>{u.procent_wynagrodzenia || 15}%</span>
                              : `${u.stawka_godzinowa || 0} PLN/h`
                            }
                          </td>
                          <td style={styles.td}>
                            <span style={{...styles.statusBadge, backgroundColor: u.aktywny ? '#4CAF50' : '#EF5350'}}>
                              {u.aktywny ? '✅ Aktywny' : '❌ Nieaktywny'}
                            </span>
                          </td>
                          <td style={styles.td} onClick={e => e.stopPropagation()}>
                            <div style={styles.actionButtons}>
                              <button style={styles.editBtn} onClick={() => navigate(`/uzytkownicy/${u.id}`)}>✏️</button>
                              {isDyrektor(currentUser) && (
                                <button
                                  style={{...styles.toggleBtn, backgroundColor: u.aktywny ? '#FFF8E1' : 'rgba(52,211,153,0.1)', color: u.aktywny ? '#F9A825' : 'var(--accent)'}}
                                  onClick={(e) => toggleAktywny(e, u.id, u.aktywny)}>
                                  {u.aktywny ? '🔴' : '🟢'}
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {filtrowane.length === 0 && (
              <div style={styles.empty}>
                <div style={styles.emptyIcon}>👥</div>
                <p>Brak pracowników spełniających kryteria</p>
                <p style={styles.emptySub}>Spróbuj zmienić filtry lub dodaj nowego pracownika</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const styles = {
  container: { display: 'flex', minHeight: '100vh', backgroundColor: 'var(--bg)' },
  main: { flex: 1, padding: '24px', overflowX: 'hidden' },
  headerRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, flexWrap: 'wrap', gap: 12 },
  title: { fontSize: 'clamp(24px, 5vw, 28px)', fontWeight: 'bold', color: 'var(--accent)', margin: 0 },
  sub: { color: 'var(--text-muted)', marginTop: 4, fontSize: 'clamp(12px, 3vw, 14px)' },
  headerRight: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  addBtn: { padding: '10px 20px', backgroundColor: 'var(--bg-deep)', color: '#fff', border: 'none', borderRadius: 10, cursor: 'pointer', fontSize: 14, fontWeight: 'bold', transition: 'all 0.2s', '&:hover': { backgroundColor: 'var(--bg-deep)', transform: 'translateY(-1px)' } },
  kpiRow: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 24 },
  kpi: { backgroundColor: 'var(--bg-card)', borderRadius: 12, padding: '14px 16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', borderTopWidth: 3, borderTopStyle: 'solid', textAlign: 'center' },
  kpiIcon: { fontSize: 24, marginBottom: 6 },
  kpiNum: { fontSize: 'clamp(22px, 5vw, 28px)', fontWeight: 'bold', marginBottom: 2 },
  kpiLabel: { fontSize: 11, color: 'var(--text-muted)' },
  filtryRow: { display: 'flex', gap: 12, marginBottom: 20, backgroundColor: 'var(--bg-card)', padding: '12px 16px', borderRadius: 12, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', flexWrap: 'wrap', alignItems: 'center' },
  searchBox: { display: 'flex', alignItems: 'center', backgroundColor: 'var(--bg-card)', borderRadius: 8, padding: '0 10px', border: '1px solid var(--border)', flex: '1 1 200px' },
  searchIcon: { fontSize: 14, color: 'var(--text-muted)' },
  searchInput: { padding: '8px 8px 8px 0', border: 'none', backgroundColor: 'transparent', fontSize: 13, outline: 'none', width: '100%' },
  filtrGroup: { display: 'flex', alignItems: 'center', gap: 8 },
  filtrLabel: { fontSize: 13, fontWeight: '600', color: 'var(--text-sub)' },
  filtrSelect: { padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, backgroundColor: 'var(--bg-card)' },
  clearBtn: { padding: '7px 14px', backgroundColor: 'rgba(248,113,113,0.1)', color: '#EF5350', border: '1px solid #FFCDD2', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: '500', transition: 'all 0.2s', '&:hover': { backgroundColor: '#FFCDD2' } },
  loading: { textAlign: 'center', padding: 60, color: 'var(--text-muted)' },
  tableWrap: { display: 'flex', flexDirection: 'column', gap: 20 },
  oddzialSection: { backgroundColor: 'var(--bg-card)', borderRadius: 16, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  oddzialHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 20px', backgroundColor: 'var(--bg-deep)', borderBottom: '2px solid var(--border2)' },
  oddzialIcon: { fontSize: 16, marginRight: 8 },
  oddzialNazwa: { fontSize: 15, fontWeight: 'bold', color: 'var(--accent)' },
  oddzialCount: { fontSize: 12, color: 'var(--accent)', backgroundColor: 'var(--border2)', padding: '2px 10px', borderRadius: 20, fontWeight: '500' },
  tableScroll: { overflowX: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse', minWidth: 700 },
  th: { padding: '12px 16px', backgroundColor: 'var(--bg-card)', color: 'var(--text-sub)', textAlign: 'left', fontSize: 13, fontWeight: '600', borderBottom: '1px solid var(--border)' },
  td: { padding: '12px 16px', fontSize: 13, color: 'var(--text)', borderBottom: '1px solid var(--border)' },
  avatarRow: { display: 'flex', alignItems: 'center', gap: 10 },
  avatarSmall: { width: 36, height: 36, borderRadius: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 'bold', flexShrink: 0 },
  stanowisko: { fontSize: 11, color: 'var(--text-muted)', marginTop: 2 },
  roleBadge: { padding: '3px 10px', borderRadius: 20, color: '#fff', fontSize: 11, fontWeight: 'bold', display: 'inline-block' },
  statusBadge: { padding: '3px 10px', borderRadius: 20, color: '#fff', fontSize: 11, fontWeight: 'bold', display: 'inline-block' },
  procentBadge: { backgroundColor: 'var(--bg-deep)', color: 'var(--accent)', padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 'bold' },
  actionButtons: { display: 'flex', gap: 6 },
  editBtn: { padding: '5px 10px', backgroundColor: 'var(--bg-deep)', color: 'var(--accent)', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: '600', transition: 'all 0.2s', '&:hover': { backgroundColor: 'var(--border2)' } },
  toggleBtn: { padding: '5px 10px', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: '600', transition: 'all 0.2s', '&:hover': { transform: 'scale(1.05)' } },
  empty: { textAlign: 'center', padding: 60, color: 'var(--text-muted)', backgroundColor: 'var(--bg-card)', borderRadius: 16 },
  emptyIcon: { fontSize: 48, marginBottom: 12, opacity: 0.5 },
  emptySub: { fontSize: 12, marginTop: 4, opacity: 0.7 }
};
