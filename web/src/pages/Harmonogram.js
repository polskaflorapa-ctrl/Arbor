import { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import { getApiErrorMessage } from '../utils/apiError';
import { getLocalStorageJson } from '../utils/safeJsonLocalStorage';
import { getStoredToken, authHeaders } from '../utils/storedToken';
import Sidebar from '../components/Sidebar';
import AddOutlined from '@mui/icons-material/AddOutlined';
import CalendarMonthOutlined from '@mui/icons-material/CalendarMonthOutlined';
import ChevronLeftOutlined from '@mui/icons-material/ChevronLeftOutlined';
import ChevronRightOutlined from '@mui/icons-material/ChevronRightOutlined';
import GroupsOutlined from '@mui/icons-material/GroupsOutlined';
import TodayOutlined from '@mui/icons-material/TodayOutlined';
import { TASK_STATUS_COLORS } from '../utils/taskWorkflow';

const STATUS_KOLOR = TASK_STATUS_COLORS;

const DNI_KROTKO = ['Pon', 'Wt', 'Śr', 'Czw', 'Pt', 'Sob', 'Nd'];
const MIESIACE = ['Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec', 'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień'];
const GODZINY = Array.from({ length: 13 }, (_, i) => i + 6); // 6:00 - 18:00
const TIME_COL_WIDTH = 68;
const HOUR_SLOT_HEIGHT = 64;
const DAY_HEADER_HEIGHT = 64;
const DAY_START_HOUR = 6;
const DAY_END_HOUR = 19;

function formatBlockTime(z) {
  if (z.godzina_rozpoczecia) return String(z.godzina_rozpoczecia).slice(0, 5);
  if (z.data_planowana) {
    try {
      const dt = new Date(z.data_planowana);
      if (!Number.isNaN(dt.getTime())) {
        return dt.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
      }
    } catch {
      /* ignore */
    }
  }
  return '08:00';
}

function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function weekStart(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

function visibleDateRange(date, view) {
  if (view === 'miesiac') {
    const start = new Date(date.getFullYear(), date.getMonth(), 1);
    const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    return { from: toISODate(start), to: toISODate(end) };
  }
  if (view === 'tydzien') {
    const start = weekStart(date);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return { from: toISODate(start), to: toISODate(end) };
  }
  const day = toISODate(date);
  return { from: day, to: day };
}

function isActiveReservation(row) {
  const status = String(row?.status || '').toLowerCase();
  return !status.includes('anul') && !status.includes('zwr');
}

function taskPhotoCount(task) {
  return Number(task?.photo_total || task?.photos_count || task?.zdjecia_count || 0) || 0;
}

function taskHasWorkBrief(task) {
  return Boolean(String(task?.opis_pracy || task?.opis || task?.wynik || task?.notatki_wewnetrzne || '').trim());
}

export default function Harmonogram() {
  const [zlecenia, setZlecenia] = useState([]);
  const [oddzialy, setOddzialy] = useState([]);
  const [ekipy, setEkipy] = useState([]);
  const [rezerwacje, setRezerwacje] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filtrOddzial, setFiltrOddzial] = useState('');
  const [filtrEkipa, setFiltrEkipa] = useState('');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [widok, setWidok] = useState('tydzien');
  const [currentUser, setCurrentUser] = useState(null);
  const [planErr, setPlanErr] = useState('');
  const [planMsg, setPlanMsg] = useState('');
  const navigate = useNavigate();
  const isBrygadzista = currentUser?.rola === 'Brygadzista';
  const dateRange = useMemo(() => visibleDateRange(currentDate, widok), [currentDate, widok]);
  const rezerwacjeByTask = useMemo(() => {
    const map = new Map();
    for (const row of rezerwacje) {
      if (!row?.task_id || !isActiveReservation(row)) continue;
      const key = String(row.task_id);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(row);
    }
    return map;
  }, [rezerwacje]);

  const loadData = useCallback(async () => {
    try {
      const token = getStoredToken();
      const h = authHeaders(token);
      
      let zleceniaEndpoint = `/tasks/wszystkie`;
      if (isBrygadzista) {
        zleceniaEndpoint = `/tasks/moje`;
      }
      
      const [zRes, oRes, eRes, rRes] = await Promise.all([
        api.get(zleceniaEndpoint, { headers: h }),
        api.get(`/oddzialy`, { headers: h }),
        api.get(`/ekipy`, { headers: h }),
        api.get(`/flota/rezerwacje?from=${dateRange.from}&to=${dateRange.to}`, { headers: h }).catch(() => ({ data: [] })),
      ]);
      const rawZ = zRes.data;
      setZlecenia(Array.isArray(rawZ) ? rawZ : rawZ?.items || []);
      const rawO = oRes.data;
      setOddzialy(Array.isArray(rawO) ? rawO : rawO?.oddzialy || []);
      const rawE = eRes.data;
      setEkipy(Array.isArray(rawE) ? rawE : rawE?.ekipy || []);
      setRezerwacje(Array.isArray(rRes.data) ? rRes.data : []);
    } catch (err) {
      console.error('Błąd ładowania:', err);
      setRezerwacje([]);
    } finally {
      setLoading(false);
    }
  }, [dateRange.from, dateRange.to, isBrygadzista]);

  const patchTaskPlan = useCallback(
    async (taskId, dayDate, hour) => {
      setPlanErr('');
      setPlanMsg('');
      try {
        const token = getStoredToken();
        const h = authHeaders(token);
        const iso = new Date(dayDate.getFullYear(), dayDate.getMonth(), dayDate.getDate(), hour, 0, 0, 0).toISOString();
        await api.patch(`/tasks/${taskId}/plan`, { data_planowana: iso }, { headers: h });
        setPlanMsg('Termin zaktualizowany.');
        await loadData();
      } catch (err) {
        setPlanErr(getApiErrorMessage(err));
      }
    },
    [loadData]
  );

  useEffect(() => {
    const token = getStoredToken();
    if (!token) { navigate('/'); return; }
    const u = getLocalStorageJson('user');
    if (u) setCurrentUser(u);
    loadData();
  }, [navigate, loadData]);

  useEffect(() => {
    setPlanMsg('');
    setPlanErr('');
  }, [currentDate, widok]);

  const isKierownik = currentUser?.rola === 'Kierownik';
  const isDyrektor = ['Prezes', 'Dyrektor'].includes(currentUser?.rola);
  const canEdit = isDyrektor || isKierownik;

  const getTydzien = (date) => {
    const pon = weekStart(date);
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

  const getKolor = (z) => ekipaKolorMap[z.ekipa_id] || STATUS_KOLOR[z.status] || 'var(--text-muted)';

  const tydzien = getTydzien(currentDate);
  const dzisiaj = toISODate(new Date());

  const zleceniaNaDzien = (date) => {
    const dateStr = toISODate(date);
    return zlecenia.filter(z => {
      if (z.data_planowana?.split('T')[0] !== dateStr) return false;
      if (filtrOddzial && z.oddzial_id?.toString() !== filtrOddzial) return false;
      if (filtrEkipa && z.ekipa_id?.toString() !== filtrEkipa) return false;
      return true;
    });
  };

  const getGodzinaStart = (z) => {
    if (z.godzina_rozpoczecia) {
      const [h, m] = String(z.godzina_rozpoczecia).split(':').map(Number);
      if (Number.isFinite(h)) return h + (Number.isFinite(m) ? m / 60 : 0);
    }
    if (z.data_planowana) {
      try {
        const dt = new Date(z.data_planowana);
        if (!Number.isNaN(dt.getTime())) {
          return dt.getHours() + dt.getMinutes() / 60;
        }
      } catch {
        /* ignore */
      }
    }
    return 8;
  };

  const getCzasTrwania = (z) => {
    return parseFloat(z.czas_planowany_godziny) || 1;
  };

  const layoutDayBlocks = (items) => {
    const sorted = [...items].sort((a, b) => getGodzinaStart(a) - getGodzinaStart(b));
    const lanesEnd = [];
    const placed = [];
    for (const z of sorted) {
      const start = getGodzinaStart(z);
      const end = start + getCzasTrwania(z);
      let lane = 0;
      while (lane < lanesEnd.length && lanesEnd[lane] > start) lane += 1;
      lanesEnd[lane] = end;
      placed.push({ z, start, end, lane });
    }
    const laneCount = Math.max(1, lanesEnd.length);
    return placed.map((item) => ({ ...item, laneCount }));
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
      <div style={{...styles.timeGrid, gridTemplateColumns: `${TIME_COL_WIDTH}px repeat(${dni.length}, 1fr)`}}>
        <div style={styles.timeCorner} />
        {dni.map(d => {
          const ds = toISODate(d);
          const isToday = ds === dzisiaj;
          return (
            <div key={ds} style={{...styles.dayColHeader, backgroundColor: isToday ? 'var(--accent-surface)' : 'var(--bg-card2)'}}>
              <div style={{...styles.dayColDow, color: isToday ? 'var(--accent)' : 'var(--text-muted)'}}>
                {DNI_KROTKO[d.getDay() === 0 ? 6 : d.getDay() - 1]}
              </div>
              <div style={{
                ...styles.dayColNum,
                backgroundColor: isToday ? 'var(--accent)' : 'transparent',
                color: isToday ? 'var(--on-accent)' : 'var(--text)'
              }}>
                {d.getDate()}
              </div>
            </div>
          );
        })}
      </div>

      <div style={styles.scrollArea}>
        <div style={{...styles.timeGrid, gridTemplateColumns: `${TIME_COL_WIDTH}px repeat(${dni.length}, 1fr)`}}>
          <div style={styles.timeCol}>
            {GODZINY.map(h => (
              <div key={h} style={styles.timeSlot}>
                <span style={styles.timeLabel}>{h}:00</span>
              </div>
            ))}
          </div>

          {dni.map(d => {
            const ds = toISODate(d);
            const isToday = ds === dzisiaj;
            const zl = zleceniaNaDzien(d);

            const dayBlocks = layoutDayBlocks(zl);
            const isTodayColumn = isToday && widok !== 'miesiac';
            const now = new Date();
            const nowDecimal = now.getHours() + now.getMinutes() / 60;
            const showNowLine = isTodayColumn && nowDecimal >= DAY_START_HOUR && nowDecimal <= DAY_END_HOUR;
            const nowTop = (nowDecimal - DAY_START_HOUR) * HOUR_SLOT_HEIGHT;

            return (
              <div key={ds} style={{...styles.dayCol, backgroundColor: isToday ? 'var(--accent-surface)' : 'var(--bg-card2)'}}>
                {GODZINY.map((h) => (
                  <div
                    key={h}
                    style={styles.hourCell}
                    onClick={() => canEdit && navigate(`/nowe-zlecenie?data=${ds}&godzina=${h}:00`)}
                    onDragOver={(e) => {
                      if (!canEdit) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                    }}
                    onDrop={(e) => {
                      if (!canEdit) return;
                      e.preventDefault();
                      const raw = e.dataTransfer.getData('application/json');
                      if (!raw) return;
                      let taskId;
                      try {
                        taskId = JSON.parse(raw).taskId;
                      } catch {
                        return;
                      }
                      if (!taskId) return;
                      void patchTaskPlan(taskId, d, h);
                    }}
                  />
                ))}

                {showNowLine && (
                  <div style={{ ...styles.nowLine, top: nowTop }}>
                    <span style={styles.nowDot} />
                  </div>
                )}

                {dayBlocks.map(({ z, start, lane, laneCount }) => {
                  const top = (start - DAY_START_HOUR) * HOUR_SLOT_HEIGHT;
                  const height = Math.max(getCzasTrwania(z) * HOUR_SLOT_HEIGHT, 34);
                  const kolor = getKolor(z);
                  const photoCount = taskPhotoCount(z);
                  const equipmentCount = (rezerwacjeByTask.get(String(z.id)) || []).length;
                  const hasBrief = taskHasWorkBrief(z);
                  const gap = 4;
                  const colWidth = `calc((100% - ${(laneCount - 1) * gap}px) / ${laneCount})`;
                  const left = `calc(${lane} * (${colWidth} + ${gap}px))`;

                  return (
                    <div
                      key={z.id}
                      draggable={canEdit}
                      onDragStart={(e) => {
                        if (!canEdit) return;
                        e.dataTransfer.setData('application/json', JSON.stringify({ taskId: z.id }));
                        e.dataTransfer.effectAllowed = 'move';
                      }}
                      style={{
                      ...styles.zlecenieBlock,
                      top: top,
                      height: height,
                      width: colWidth,
                      left: left,
                      right: 'auto',
                      backgroundColor: kolor + '22',
                      borderLeft: `3px solid ${kolor}`,
                      cursor: canEdit ? 'grab' : 'pointer',
                    }} onClick={(e) => { e.stopPropagation(); navigate(`/zlecenia/${z.id}`); }}>
                      <div style={{...styles.blockTitle, color: kolor}}>
                        {formatBlockTime(z)} {z.klient_nazwa}
                      </div>
                      {height > 45 && (
                        <div style={styles.blockSub}>{z.ekipa_nazwa || 'Brak ekipy'}</div>
                      )}
                      {height > 52 && (
                        <div style={styles.blockBadges}>
                          <span
                            style={{ ...styles.blockBadge, ...(photoCount ? styles.blockBadgeOk : styles.blockBadgeWarn) }}
                            title={photoCount ? `${photoCount} zdjec w zleceniu` : 'Brak zdjec z ogledzin / pracy'}
                          >
                            {photoCount ? `${photoCount} zdj.` : 'bez zdj.'}
                          </span>
                          <span
                            style={{ ...styles.blockBadge, ...(equipmentCount ? styles.blockBadgeOk : styles.blockBadgeNeutral) }}
                            title={equipmentCount ? `${equipmentCount} aktywne rezerwacje sprzetu` : 'Brak sprzetu przypisanego do zlecenia'}
                          >
                            {equipmentCount ? `${equipmentCount} sprz.` : 'sprz. -'}
                          </span>
                          {!hasBrief && (
                            <span style={{ ...styles.blockBadge, ...styles.blockBadgeWarn }} title="Brak opisu pracy dla ekipy">
                              opis -
                            </span>
                          )}
                        </div>
                      )}
                      {height > 82 && z.adres && (
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
          const ds = toISODate(data);
          const isToday = ds === dzisiaj;
          const zl = zleceniaNaDzien(data);
          return (
            <div key={ds} style={{
              ...styles.miesiacCell,
              backgroundColor: isToday ? 'var(--accent-surface)' : 'var(--bg-card2)',
              border: isToday ? '2px solid var(--accent)' : '1px solid var(--border)',
            }} onClick={() => { setCurrentDate(data); setWidok('dzien'); }}>
              <div style={{...styles.miesiacNum, color: isToday ? 'var(--accent)' : 'var(--text)', fontWeight: isToday ? 'bold' : 'normal'}}>
                {data.getDate()}
              </div>
              {zl.slice(0, 3).map(z => (
                <div key={z.id} style={{...styles.miesiacChip, backgroundColor: getKolor(z)}}>
                  {formatBlockTime(z)} {z.klient_nazwa?.substring(0, 12)}
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
    <div className="app-shell" style={styles.container}>
      <Sidebar />
      <main className="app-main" style={styles.main}>
        <div style={styles.headerRow}>
          <div style={styles.navRow}>
            <button style={styles.todayBtn} onClick={goToday}>
              <TodayOutlined style={{ fontSize: 17 }} aria-hidden />
              Dziś
            </button>
            <button style={styles.navBtn} onClick={prevPeriod} aria-label="Poprzedni okres">
              <ChevronLeftOutlined style={{ fontSize: 20 }} aria-hidden />
            </button>
            <button style={styles.navBtn} onClick={nextPeriod} aria-label="Następny okres">
              <ChevronRightOutlined style={{ fontSize: 20 }} aria-hidden />
            </button>
            <h2 style={styles.calTitle}>{getTytul()}</h2>
          </div>
          <div style={styles.headerRight}>
            {!isBrygadzista && (
              <>
                <select style={styles.filtrSelect} value={filtrOddzial} onChange={e => setFiltrOddzial(e.target.value)}>
                  <option value="">Wszystkie oddziały</option>
                  {oddzialy.map(o => <option key={o.id} value={o.id}>{o.nazwa}</option>)}
                </select>
                <select style={styles.filtrSelect} value={filtrEkipa} onChange={e => setFiltrEkipa(e.target.value)}>
                  <option value="">Wszystkie ekipy</option>
                  {filtrowaneEkipy.map(e => <option key={e.id} value={e.id}>{e.nazwa}</option>)}
                </select>
              </>
            )}
            <div style={styles.widokBtns}>
              {['dzien', 'tydzien', 'miesiac'].map(w => (
                <button key={w} style={{...styles.widokBtn, ...(widok === w ? styles.widokBtnActive : {})}}
                  onClick={() => setWidok(w)}>
                  {w === 'dzien' ? 'Dzień' : w === 'tydzien' ? 'Tydzień' : 'Miesiąc'}
                </button>
              ))}
            </div>
            {canEdit && (
              <button style={styles.addBtn} onClick={() => navigate('/nowe-zlecenie')}>
                <AddOutlined style={{ fontSize: 17 }} aria-hidden />
                Nowe zlecenie
              </button>
            )}
          </div>
        </div>

        {(planErr || planMsg) && (
          <div style={{ marginBottom: 8, fontSize: 13 }}>
            {planErr ? <span style={{ color: 'var(--danger)' }}>{planErr}</span> : null}
            {planMsg ? <span style={{ color: 'var(--accent)' }}>{planMsg}</span> : null}
          </div>
        )}
        {canEdit && !loading ? (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
            Przeciągnij blok zlecenia na inny dzień lub godzinę, aby zmienić termin (widok dzień / tydzień).
            Rezerwacje sprzętu z tego zlecenia przesuwają się razem z terminem.
          </div>
        ) : null}
        {!loading ? (
          <div style={styles.readinessHint}>
            Na blokach: zdjęcia z oględzin/pracy, aktywny sprzęt i brak opisu dla ekipy.
          </div>
        ) : null}

        {loading ? (
          <div style={styles.loading}>Ładowanie harmonogramu...</div>
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
              <span style={styles.legendaTitle}>
                <GroupsOutlined style={{ fontSize: 16 }} aria-hidden />
                Ekipy:
              </span>
              {ekipy
                .filter(e => !filtrOddzial || e.oddzial_id?.toString() === filtrOddzial)
                .map(e => (
                  <div key={e.id} style={styles.legendaItem}>
                    <div style={{...styles.legendaDot, backgroundColor: e.kolor || 'var(--text-muted)', boxShadow: `0 0 6px ${e.kolor || '#94a3b8'}88`}} />
                    <span style={styles.legendaLabel}>{e.nazwa}</span>
                  </div>
                ))}
            </>
          ) : (
            <>
              <span style={styles.legendaTitle}>
                <CalendarMonthOutlined style={{ fontSize: 16 }} aria-hidden />
                Statusy:
              </span>
              {Object.entries(STATUS_KOLOR).map(([status, kolor]) => (
                <div key={status} style={styles.legendaItem}>
                  <div style={{...styles.legendaDot, backgroundColor: kolor}} />
                  <span style={styles.legendaLabel}>{status}</span>
                </div>
              ))}
            </>
          )}
        </div>
      </main>
    </div>
  );
}

const styles = {
  container: { display: 'flex', minHeight: '100vh', background: 'transparent' },
  main: { flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 },
  headerRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    flexWrap: 'wrap',
    gap: 12,
    border: '1px solid var(--glass-border)',
    borderRadius: 8,
    background: 'var(--surface-glass)',
    padding: '14px 16px',
    boxShadow: 'var(--shadow-sm)',
  },
  navRow: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  calTitle: { fontSize: 'clamp(18px, 3vw, 24px)', fontWeight: 900, color: 'var(--text)', margin: 0, lineHeight: 1.15 },
  todayBtn: {
    minHeight: 36,
    padding: '7px 13px',
    background: 'var(--accent-gradient)',
    border: '1px solid var(--accent)',
    borderRadius: 8,
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 900,
    color: 'var(--on-accent)',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 7,
  },
  navBtn: {
    width: 36,
    height: 36,
    padding: 0,
    backgroundColor: 'var(--surface-field)',
    border: '1px solid var(--border2)',
    borderRadius: 8,
    cursor: 'pointer',
    color: 'var(--accent)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerRight: { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' },
  filtrSelect: { padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, backgroundColor: 'var(--input-bg)', color: 'var(--text)', minHeight: 36 },
  widokBtns: { display: 'flex', border: '1px solid var(--border2)', borderRadius: 8, overflow: 'hidden', background: 'var(--surface-field)' },
  widokBtn: { padding: '8px 13px', border: 'none', borderRight: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', fontSize: 13, fontWeight: 800, color: 'var(--text-muted)', appearance: 'none', WebkitAppearance: 'none', MozAppearance: 'none' },
  widokBtnActive: { background: 'var(--accent-gradient)', color: 'var(--on-accent)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.16)' },
  addBtn: {
    minHeight: 36,
    padding: '8px 15px',
    background: 'var(--accent-gradient)',
    color: 'var(--on-accent)',
    border: '1px solid var(--accent)',
    borderRadius: 8,
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 900,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 7,
    boxShadow: '0 8px 20px rgba(34,197,94,0.22)',
  },
  loading: { textAlign: 'center', padding: 60, color: 'var(--text-muted)', border: '1px dashed var(--border)', borderRadius: 8, background: 'var(--surface-glass)' },
  calendarWrap: { background: 'var(--surface-raised)', border: '1px solid var(--glass-border)', borderRadius: 8, boxShadow: 'var(--shadow-md)', overflow: 'hidden', flex: 1, minHeight: 520 },
  readinessHint: { marginBottom: 10, fontSize: 12, color: 'var(--text-muted)', fontWeight: 700 },
  calBody: { display: 'flex', flexDirection: 'column', minHeight: 520, height: '100%' },
  timeGrid: { display: 'grid' },
  timeCorner: { position: 'sticky', top: 0, zIndex: 30, height: DAY_HEADER_HEIGHT, borderBottom: '1px solid var(--border2)', borderRight: '1px solid var(--border)', background: 'linear-gradient(180deg, var(--bg-card2), var(--bg-card))' },
  dayColHeader: { position: 'sticky', top: 0, zIndex: 20, height: DAY_HEADER_HEIGHT, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', borderBottom: '1px solid var(--border2)', borderRight: '1px solid var(--border)' },
  dayColDow: { fontSize: 11, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 0 },
  dayColNum: { width: 30, height: 30, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 900, marginTop: 4 },
  scrollArea: { overflowY: 'auto', flex: 1 },
  timeCol: { borderRight: '1px solid var(--border)' },
  timeSlot: { height: HOUR_SLOT_HEIGHT, display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end', paddingRight: 10, paddingTop: 6, borderBottom: '1px solid var(--border)' },
  timeLabel: { fontSize: 11, color: 'var(--text-muted)', fontWeight: 800 },
  dayCol: { position: 'relative', borderRight: '1px solid var(--border)' },
  hourCell: { height: HOUR_SLOT_HEIGHT, borderBottom: '1px solid var(--border)', cursor: 'pointer', transition: 'background 0.15s', background: 'rgba(255,255,255,0.012)' },
  zlecenieBlock: { position: 'absolute', left: 6, right: 6, borderRadius: 8, padding: '7px 8px', cursor: 'pointer', overflow: 'hidden', zIndex: 10, boxShadow: 'var(--shadow-sm)', transition: 'transform 0.15s', border: '1px solid var(--border)' },
  nowLine: { position: 'absolute', left: 0, right: 0, borderTop: '2px dashed var(--danger)', zIndex: 9, pointerEvents: 'none' },
  nowDot: { position: 'absolute', left: -4, top: -5, width: 10, height: 10, borderRadius: '50%', backgroundColor: 'var(--danger)' },
  blockTitle: { fontSize: 11, fontWeight: 900, lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  blockSub: { fontSize: 10, color: 'var(--text-muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 700 },
  blockBadges: { display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap', overflow: 'hidden', maxHeight: 20 },
  blockBadge: { display: 'inline-flex', alignItems: 'center', height: 16, padding: '0 5px', borderRadius: 999, fontSize: 9, fontWeight: 900, lineHeight: '16px', whiteSpace: 'nowrap', border: '1px solid transparent' },
  blockBadgeOk: { backgroundColor: 'rgba(34,197,94,0.16)', color: 'var(--accent)', borderColor: 'rgba(34,197,94,0.28)' },
  blockBadgeWarn: { backgroundColor: 'rgba(245,158,11,0.16)', color: 'var(--warning)', borderColor: 'rgba(245,158,11,0.32)' },
  blockBadgeNeutral: { backgroundColor: 'rgba(148,163,184,0.16)', color: 'var(--text-muted)', borderColor: 'rgba(148,163,184,0.24)' },
  miesiacGrid: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6, padding: 16, minHeight: 500 },
  miesiacHeader: { textAlign: 'center', fontSize: 12, fontWeight: 900, color: 'var(--text-muted)', padding: '6px 0', textTransform: 'uppercase' },
  miesiacEmpty: { minHeight: 100 },
  miesiacCell: { minHeight: 108, borderRadius: 8, padding: 8, cursor: 'pointer', boxSizing: 'border-box', transition: 'all 0.15s', background: 'var(--surface-field)' },
  miesiacNum: { fontSize: 13, marginBottom: 5, fontWeight: 900 },
  miesiacChip: { fontSize: 10, color: 'var(--on-accent)', padding: '3px 6px', borderRadius: 6, marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 800 },
  miesiacMore: { fontSize: 10, color: 'var(--text-muted)', fontStyle: 'italic', fontWeight: 800 },
  legenda: { display: 'flex', gap: 12, marginTop: 12, flexWrap: 'wrap', alignItems: 'center', border: '1px solid var(--glass-border)', borderRadius: 8, background: 'var(--surface-glass)', padding: '10px 12px' },
  legendaTitle: { fontSize: 12, fontWeight: 900, color: 'var(--text-sub)', display: 'inline-flex', alignItems: 'center', gap: 6 },
  legendaItem: { display: 'flex', alignItems: 'center', gap: 6, border: '1px solid var(--border)', borderRadius: 8, padding: '4px 7px', background: 'var(--surface-field)' },
  legendaDot: { width: 10, height: 10, borderRadius: '50%' },
  legendaLabel: { fontSize: 11, color: 'var(--text-muted)', fontWeight: 800 }
};
