import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import { getLocalStorageJson } from '../utils/safeJsonLocalStorage';
import { getStoredToken, authHeaders } from '../utils/storedToken';
import Sidebar from '../components/Sidebar';


const STATUS_KOLOR = {
  Nowe: '#3B82F6',
  Zaplanowane: '#64748b',
  W_Realizacji: '#F9A825',
  Zakonczone: '#22C55E',
  Anulowane: '#EF5350'
};

const DNI_KROTKO = ['Pon', 'Wt', 'Śr', 'Czw', 'Pt', 'Sob', 'Nd'];
const MIESIACE = ['Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec', 'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień'];
const GODZINY = Array.from({ length: 13 }, (_, i) => i + 6); // 6:00 - 18:00

export default function Harmonogram() {
  const [zlecenia, setZlecenia] = useState([]);
  const [oddzialy, setOddzialy] = useState([]);
  const [ekipy, setEkipy] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filtrOddzial, setFiltrOddzial] = useState('');
  const [filtrEkipa, setFiltrEkipa] = useState('');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [widok, setWidok] = useState('tydzien');
  const [currentUser, setCurrentUser] = useState(null);
  const navigate = useNavigate();
  const isBrygadzista = currentUser?.rola === 'Brygadzista';

  const loadData = useCallback(async () => {
    try {
      const token = getStoredToken();
      const h = authHeaders(token);
      
      let zleceniaEndpoint = `/tasks/wszystkie`;
      if (isBrygadzista) {
        zleceniaEndpoint = `/tasks/moje`;
      }
      
      const [zRes, oRes, eRes] = await Promise.all([
        api.get(zleceniaEndpoint, { headers: h }),
        api.get(`/oddzialy`, { headers: h }),
        api.get(`/ekipy`, { headers: h }),
      ]);
      setZlecenia(zRes.data);
      setOddzialy(oRes.data);
      setEkipy(eRes.data);
    } catch (err) {
      console.log('Błąd ładowania:', err);
    } finally {
      setLoading(false);
    }
  }, [isBrygadzista]);

  useEffect(() => {
    const token = getStoredToken();
    if (!token) { navigate('/'); return; }
    const u = getLocalStorageJson('user');
    if (u) setCurrentUser(u);
    loadData();
  }, [navigate, loadData]);

  const isKierownik = currentUser?.rola === 'Kierownik';
  const isDyrektor = currentUser?.rola === 'Dyrektor' || currentUser?.rola === 'Administrator';
  const canEdit = isDyrektor || isKierownik;

  const getTydzien = (date) => {
    const d = new Date(date);
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    const pon = new Date(d);
    pon.setDate(d.getDate() + diff);
    return Array.from({ length: 7 }, (_, i) => {
      const dd = new Date(pon);
      dd.setDate(pon.getDate() + i);
      return dd;
    });
  };

  // Build a quick lookup: ekipa_id → kolor
  const ekipaKolorMap = Object.fromEntries(
    ekipy.filter(e => e.kolor).map(e => [e.id, e.kolor])
  );

  const getKolor = (z) => ekipaKolorMap[z.ekipa_id] || STATUS_KOLOR[z.status] || '#6B7280';

  const tydzien = getTydzien(currentDate);
  const dzisiaj = new Date().toISOString().split('T')[0];

  const zleceniaNaDzien = (date) => {
    const dateStr = date.toISOString().split('T')[0];
    return zlecenia.filter(z => {
      if (z.data_planowana?.split('T')[0] !== dateStr) return false;
      if (filtrOddzial && z.oddzial_id?.toString() !== filtrOddzial) return false;
      if (filtrEkipa && z.ekipa_id?.toString() !== filtrEkipa) return false;
      return true;
    });
  };

  const getGodzinaStart = (z) => {
    if (z.godzina_rozpoczecia) {
      const [h, m] = z.godzina_rozpoczecia.split(':').map(Number);
      return h + m / 60;
    }
    return 8;
  };

  const getCzasTrwania = (z) => {
    return parseFloat(z.czas_planowany_godziny) || 1;
  };

  const prevPeriod = () => {
    const d = new Date(currentDate);
    if (widok === 'dzien') d.setDate(d.getDate() - 1);
    else if (widok === 'tydzien') d.setDate(d.getDate() - 7);
    else d.setMonth(d.getMonth() - 1);
    setCurrentDate(d);
  };

  const nextPeriod = () => {
    const d = new Date(currentDate);
    if (widok === 'dzien') d.setDate(d.getDate() + 1);
    else if (widok === 'tydzien') d.setDate(d.getDate() + 7);
    else d.setMonth(d.getMonth() + 1);
    setCurrentDate(d);
  };

  const goToday = () => setCurrentDate(new Date());

  const getTytul = () => {
    if (widok === 'dzien') {
      return currentDate.toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    }
    if (widok === 'tydzien') {
      const pon = tydzien[0];
      const nd = tydzien[6];
      return `${pon.getDate()} ${MIESIACE[pon.getMonth()]} — ${nd.getDate()} ${MIESIACE[nd.getMonth()]} ${nd.getFullYear()}`;
    }
    return `${MIESIACE[currentDate.getMonth()]} ${currentDate.getFullYear()}`;
  };

  const renderDzien = (dni) => (
    <div style={styles.calBody}>
      <div style={{...styles.timeGrid, gridTemplateColumns: `60px repeat(${dni.length}, 1fr)`}}>
        <div style={styles.timeCorner} />
        {dni.map(d => {
          const ds = d.toISOString().split('T')[0];
          const isToday = ds === dzisiaj;
          return (
            <div key={ds} style={{...styles.dayColHeader, backgroundColor: isToday ? 'rgba(52,211,153,0.1)' : '#1E293B'}}>
              <div style={{...styles.dayColDow, color: isToday ? 'var(--accent)' : '#9CA3AF'}}>
                {DNI_KROTKO[d.getDay() === 0 ? 6 : d.getDay() - 1]}
              </div>
              <div style={{
                ...styles.dayColNum,
                backgroundColor: isToday ? 'var(--accent)' : 'transparent',
                color: isToday ? 'var(--accent)' : '#F1F5F9'
              }}>
                {d.getDate()}
              </div>
            </div>
          );
        })}
      </div>

      <div style={styles.scrollArea}>
        <div style={{...styles.timeGrid, gridTemplateColumns: `60px repeat(${dni.length}, 1fr)`}}>
          <div style={styles.timeCol}>
            {GODZINY.map(h => (
              <div key={h} style={styles.timeSlot}>
                <span style={styles.timeLabel}>{h}:00</span>
              </div>
            ))}
          </div>

          {dni.map(d => {
            const ds = d.toISOString().split('T')[0];
            const isToday = ds === dzisiaj;
            const zl = zleceniaNaDzien(d);

            return (
              <div key={ds} style={{...styles.dayCol, backgroundColor: isToday ? 'rgba(52,211,153,0.05)' : '#1E293B'}}>
                {GODZINY.map(h => (
                  <div key={h} style={styles.hourCell}
                    onClick={() => canEdit && navigate(`/nowe-zlecenie?data=${ds}&godzina=${h}:00`)}>
                  </div>
                ))}

                {zl.map(z => {
                  const startH = getGodzinaStart(z);
                  const czas = getCzasTrwania(z);
                  const top = (startH - 6) * 60;
                  const height = Math.max(czas * 60, 30);
                  const kolor = getKolor(z);

                  return (
                    <div key={z.id} style={{
                      ...styles.zlecenieBlock,
                      top: top,
                      height: height,
                      backgroundColor: kolor + '22',
                      borderLeft: `3px solid ${kolor}`,
                    }} onClick={(e) => { e.stopPropagation(); navigate(`/zlecenia/${z.id}`); }}>
                      <div style={{...styles.blockTitle, color: kolor}}>
                        {z.godzina_rozpoczecia ? z.godzina_rozpoczecia.substring(0,5) : '08:00'} {z.klient_nazwa}
                      </div>
                      {height > 45 && (
                        <div style={styles.blockSub}>{z.ekipa_nazwa || 'Brak ekipy'}</div>
                      )}
                      {height > 60 && z.adres && (
                        <div style={styles.blockSub}>{z.adres.substring(0, 20)}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );

  const renderMiesiac = () => {
    const rok = currentDate.getFullYear();
    const miesiac = currentDate.getMonth();
    const pierwszyDzien = new Date(rok, miesiac, 1);
    const ostatniDzien = new Date(rok, miesiac + 1, 0);
    const dniArray = [];
    let dow = pierwszyDzien.getDay();
    dow = dow === 0 ? 6 : dow - 1;
    for (let i = 0; i < dow; i++) dniArray.push(null);
    for (let i = 1; i <= ostatniDzien.getDate(); i++) dniArray.push(new Date(rok, miesiac, i));

    return (
      <div style={styles.miesiacGrid}>
        {DNI_KROTKO.map(d => <div key={d} style={styles.miesiacHeader}>{d}</div>)}
        {dniArray.map((data, i) => {
          if (!data) return <div key={`e-${i}`} style={styles.miesiacEmpty} />;
          const ds = data.toISOString().split('T')[0];
          const isToday = ds === dzisiaj;
          const zl = zleceniaNaDzien(data);
          return (
            <div key={ds} style={{
              ...styles.miesiacCell,
              backgroundColor: isToday ? 'rgba(52,211,153,0.1)' : '#1E293B',
              border: isToday ? '2px solid var(--accent)' : '1px solid var(--border)',
            }} onClick={() => { setCurrentDate(data); setWidok('dzien'); }}>
              <div style={{...styles.miesiacNum, color: isToday ? 'var(--accent)' : 'var(--text)', fontWeight: isToday ? 'bold' : 'normal'}}>
                {data.getDate()}
              </div>
              {zl.slice(0, 3).map(z => (
                <div key={z.id} style={{...styles.miesiacChip, backgroundColor: getKolor(z)}}>
                  {z.godzina_rozpoczecia ? z.godzina_rozpoczecia.substring(0,5) + ' ' : ''}{z.klient_nazwa?.substring(0, 12)}
                </div>
              ))}
              {zl.length > 3 && <div style={styles.miesiacMore}>+{zl.length - 3} więcej</div>}
            </div>
          );
        })}
      </div>
    );
  };

  const filtrowaneEkipy = ekipy.filter(e => !filtrOddzial || e.oddzial_id?.toString() === filtrOddzial);

  return (
    <div style={styles.container}>
      <Sidebar />
      <div style={styles.main}>
        <div style={styles.headerRow}>
          <div style={styles.navRow}>
            <button style={styles.todayBtn} onClick={goToday}>📅 Dziś</button>
            <button style={styles.navBtn} onClick={prevPeriod}>‹</button>
            <button style={styles.navBtn} onClick={nextPeriod}>›</button>
            <h2 style={styles.calTitle}>{getTytul()}</h2>
          </div>
          <div style={styles.headerRight}>
            {!isBrygadzista && (
              <>
                <select style={styles.filtrSelect} value={filtrOddzial} onChange={e => setFiltrOddzial(e.target.value)}>
                  <option value="">🌍 Wszystkie oddziały</option>
                  {oddzialy.map(o => <option key={o.id} value={o.id}>🏢 {o.nazwa}</option>)}
                </select>
                <select style={styles.filtrSelect} value={filtrEkipa} onChange={e => setFiltrEkipa(e.target.value)}>
                  <option value="">👥 Wszystkie ekipy</option>
                  {filtrowaneEkipy.map(e => <option key={e.id} value={e.id}>👷 {e.nazwa}</option>)}
                </select>
              </>
            )}
            <div style={styles.widokBtns}>
              {['dzien', 'tydzien', 'miesiac'].map(w => (
                <button key={w} style={{...styles.widokBtn, ...(widok === w ? styles.widokBtnActive : {})}}
                  onClick={() => setWidok(w)}>
                  {w === 'dzien' ? '📅 Dzień' : w === 'tydzien' ? '📆 Tydzień' : '📆 Miesiąc'}
                </button>
              ))}
            </div>
            {canEdit && (
              <button style={styles.addBtn} onClick={() => navigate('/nowe-zlecenie')}>+ Nowe zlecenie</button>
            )}
          </div>
        </div>

        {loading ? (
          <div style={styles.loading}>⏳ Ładowanie harmonogramu...</div>
        ) : (
          <div style={styles.calendarWrap}>
            {widok === 'dzien' && renderDzien([currentDate])}
            {widok === 'tydzien' && renderDzien(tydzien)}
            {widok === 'miesiac' && renderMiesiac()}
          </div>
        )}

        {/* Legenda */}
        <div style={styles.legenda}>
          {ekipy.filter(e => !filtrOddzial || e.oddzial_id?.toString() === filtrOddzial).length > 0 ? (
            <>
              <span style={styles.legendaTitle}>👷 Ekipy:</span>
              {ekipy
                .filter(e => !filtrOddzial || e.oddzial_id?.toString() === filtrOddzial)
                .map(e => (
                  <div key={e.id} style={styles.legendaItem}>
                    <div style={{...styles.legendaDot, backgroundColor: e.kolor || '#6B7280', boxShadow: `0 0 6px ${e.kolor || '#6B7280'}88`}} />
                    <span style={styles.legendaLabel}>{e.nazwa}</span>
                  </div>
                ))}
            </>
          ) : (
            <>
              <span style={styles.legendaTitle}>📋 Statusy:</span>
              {Object.entries(STATUS_KOLOR).map(([status, kolor]) => (
                <div key={status} style={styles.legendaItem}>
                  <div style={{...styles.legendaDot, backgroundColor: kolor}} />
                  <span style={styles.legendaLabel}>{status}</span>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const styles = {
  container: { display: 'flex', minHeight: '100vh', backgroundColor: 'var(--bg)' },
  main: { flex: 1, padding: '20px', display: 'flex', flexDirection: 'column' },
  headerRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 },
  navRow: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  calTitle: { fontSize: 'clamp(14px, 4vw, 18px)', fontWeight: 'bold', color: 'var(--accent)', margin: 0 },
  todayBtn: { padding: '6px 14px', backgroundColor: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: '600', color: 'var(--accent)' },
  navBtn: { padding: '6px 12px', backgroundColor: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', fontSize: 18, fontWeight: 'bold', lineHeight: 1 },
  headerRight: { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' },
  filtrSelect: { padding: '7px 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, backgroundColor: 'var(--bg-card)' },
  widokBtns: { display: 'flex', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' },
  widokBtn: { padding: '7px 14px', border: 'none', backgroundColor: 'var(--bg-card)', cursor: 'pointer', fontSize: 13, fontWeight: '500', color: 'var(--text-muted)' },
  widokBtnActive: { backgroundColor: 'var(--bg-deep)', color: '#fff' },
  addBtn: { padding: '8px 18px', backgroundColor: 'var(--bg-deep)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: '600' },
  loading: { textAlign: 'center', padding: 60, color: 'var(--text-muted)' },
  calendarWrap: { backgroundColor: 'var(--bg-card)', borderRadius: 16, boxShadow: '0 1px 4px rgba(0,0,0,0.08)', overflow: 'hidden', flex: 1 },
  calBody: { display: 'flex', flexDirection: 'column', height: 'calc(100vh - 240px)' },
  timeGrid: { display: 'grid' },
  timeCorner: { height: 56, borderBottom: '1px solid var(--border)', borderRight: '1px solid var(--border)' },
  dayColHeader: { height: 56, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', borderBottom: '1px solid var(--border)', borderRight: '1px solid var(--border)' },
  dayColDow: { fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 1 },
  dayColNum: { width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 'bold', marginTop: 2 },
  scrollArea: { overflowY: 'auto', flex: 1 },
  timeCol: { borderRight: '1px solid var(--border)' },
  timeSlot: { height: 60, display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end', paddingRight: 8, paddingTop: 4, borderBottom: '1px solid var(--border)' },
  timeLabel: { fontSize: 11, color: 'var(--text-muted)', fontWeight: '500' },
  dayCol: { position: 'relative', borderRight: '1px solid var(--border)' },
  hourCell: { height: 60, borderBottom: '1px solid var(--border)', cursor: 'pointer', transition: 'background 0.15s', '&:hover': { backgroundColor: 'var(--bg)' } },
  zlecenieBlock: { position: 'absolute', left: 2, right: 2, borderRadius: 8, padding: '4px 6px', cursor: 'pointer', overflow: 'hidden', zIndex: 10, boxShadow: '0 1px 3px rgba(0,0,0,0.1)', transition: 'transform 0.15s', '&:hover': { transform: 'translateX(2px)' } },
  blockTitle: { fontSize: 11, fontWeight: '700', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  blockSub: { fontSize: 9, color: 'var(--text-muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  miesiacGrid: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, padding: 16, minHeight: 500 },
  miesiacHeader: { textAlign: 'center', fontSize: 12, fontWeight: '600', color: 'var(--text-muted)', padding: '6px 0' },
  miesiacEmpty: { minHeight: 100 },
  miesiacCell: { minHeight: 100, borderRadius: 8, padding: 6, cursor: 'pointer', boxSizing: 'border-box', transition: 'all 0.15s', '&:hover': { transform: 'scale(1.01)', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' } },
  miesiacNum: { fontSize: 13, marginBottom: 4, fontWeight: '500' },
  miesiacChip: { fontSize: 10, color: '#fff', padding: '2px 5px', borderRadius: 4, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  miesiacMore: { fontSize: 10, color: 'var(--text-muted)', fontStyle: 'italic' },
  legenda: { display: 'flex', gap: 16, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' },
  legendaTitle: { fontSize: 12, fontWeight: '600', color: 'var(--text-sub)' },
  legendaItem: { display: 'flex', alignItems: 'center', gap: 6 },
  legendaDot: { width: 10, height: 10, borderRadius: '50%' },
  legendaLabel: { fontSize: 11, color: 'var(--text-muted)' }
};
