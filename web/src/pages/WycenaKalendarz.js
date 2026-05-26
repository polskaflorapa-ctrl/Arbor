import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../api';
import StatusMessage from '../components/StatusMessage';
import { getApiErrorMessage } from '../utils/apiError';
import { getLocalStorageJson } from '../utils/safeJsonLocalStorage';
import { getStoredToken, authHeaders } from '../utils/storedToken';
import { errorMessage, successMessage, warningMessage } from '../utils/statusMessage';
import Sidebar from '../components/Sidebar';
import { loadCalendarBlocks, isYmdBlocked } from '../utils/calendarBlocks';
import { buildNewOrderPath } from '../utils/newOrderRoute';

const MIESIAC = ['Styczeń','Luty','Marzec','Kwiecień','Maj','Czerwiec',
  'Lipiec','Sierpień','Wrzesień','Październik','Listopad','Grudzień'];
const DNI = ['Pn','Wt','Śr','Cz','Pt','Sb','Nd'];

const STATUS_KOLOR = {
  oczekuje: '#F59E0B',
  rezerwacja_wstepna: '#22C55E',
  do_specjalisty: '#60A5FA',
  zatwierdzono: '#34D399',
  odrzucono: '#EF4444',
};
const STATUS_LABEL = {
  oczekuje: '⏳ Oczekuje',
  rezerwacja_wstepna: '📌 Rezerwacja wstępna',
  do_specjalisty: '🧠 Do specjalisty',
  zatwierdzono: '✅ Zatwierdzone',
  odrzucono: '❌ Odrzucone',
};

const APPROVE_ROLES = ['Kierownik', 'Administrator', 'Dyrektor', 'Specjalista'];
const MANAGER_ROLES = ['Kierownik', 'Administrator', 'Dyrektor'];

const WYCENA_STATUSES = ['Nowa', 'W_Opracowaniu', 'Wyslana', 'Zaakceptowana', 'Odrzucona'];
const STATUS_WYCENY_LABEL = {
  Nowa: 'Nowa', W_Opracowaniu: 'W opracowaniu', Wyslana: 'Wysłana',
  Zaakceptowana: 'Zaakceptowana', Odrzucona: 'Odrzucona',
};

const SPRZET_POLA = [
  { key: 'rebak', label: 'Rębak' },
  { key: 'pila_wysiegniku', label: 'Piła wysięknika' },
  { key: 'nozyce_dlugie', label: 'Nożyce długie' },
  { key: 'kosiarka', label: 'Kosiarka' },
  { key: 'podkaszarka', label: 'Podkaszarka' },
  { key: 'lopata', label: 'Łopata' },
  { key: 'mulczer', label: 'Mulczer' },
  { key: 'arborysta', label: 'Arborysta' },
];

function getCalDays(year, month) {
  const first = new Date(year, month, 1).getDay();
  const days = new Date(year, month + 1, 0).getDate();
  const offset = (first + 6) % 7;
  const cells = [];
  for (let i = 0; i < offset; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function fmt(v) {
  if (!v) return '—';
  return new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' }).format(v);
}

function etaReasonLabel(reason) {
  if (reason === 'no_target_point') return 'brak pinezki klienta';
  if (reason === 'no_team_gps') return 'brak sygnału GPS ekipy';
  return '';
}

function fmtSlaDue(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return String(iso);
  }
}

function pickBestOperationalSlot(slots, etaThresholdMinutes) {
  const withEta = (slots || []).filter((s) => s.eta_minutes != null);
  const safeEta = withEta.filter((s) => Number(s.eta_minutes) <= etaThresholdMinutes);
  if (safeEta.length > 0) return { best: safeEta[0], warning: '' };
  if (withEta.length > 0) return { best: withEta[0], warning: `Brak slotu ETA <= ${etaThresholdMinutes} min. Wybrano najlepszy dostępny.` };
  const fallback = (slots || [])[0] || null;
  return { best: fallback, warning: 'Brak slotów z ETA. Sprawdź GPS/pinezkę klienta.' };
}

export default function WycenaKalendarz() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [selectedDay, setSelectedDay] = useState(today.getDate());
  const [wyceny, setWyceny] = useState([]);
  const [ekipy, setEkipy] = useState([]);
  const [user, setUser] = useState(null);
  const [calendarBlocks, setCalendarBlocks] = useState(() => loadCalendarBlocks());
  const [msg, setMsg] = useState('');
  const [wybranaWycena, setWybranaWycena] = useState(null);

  const [ogledziny, setOgledziny] = useState([]);
  const [calView, setCalView] = useState('combined');
  const [reserveDraft, setReserveDraft] = useState(null);
  const [reserveDiag, setReserveDiag] = useState(null);
  const [reserveRuleWarning, setReserveRuleWarning] = useState('');
  const [slotLoading, setSlotLoading] = useState(false);
  const [liveByTeam, setLiveByTeam] = useState({});
  const [etaThreshold, setEtaThreshold] = useState(25);
  /** F1.10 — zatwierdzenia wycen po terminie SLA (GET /quotations/panel/sla-przeterminowane). */
  const [slaOverdue, setSlaOverdue] = useState([]);

  useEffect(() => {
    const v = searchParams.get('view');
    if (v === 'ogledziny' || v === 'wyceny' || v === 'combined') {
      setCalView(v);
    }
  }, [searchParams]);

  useEffect(() => {
    const raw = localStorage.getItem(`arbor_eta_threshold_${user?.id || 'global'}`);
    const val = Number(raw);
    if ([20, 25, 30].includes(val)) setEtaThreshold(val);
  }, [user?.id]);

  const setEtaThresholdPersisted = (next) => {
    setEtaThreshold(next);
    localStorage.setItem(`arbor_eta_threshold_${user?.id || 'global'}`, String(next));
  };

  const gpsAgeMin = (iso) => {
    if (!iso) return null;
    const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    return Number.isFinite(m) ? Math.max(0, m) : null;
  };

  const dataQualityFlags = (w) => {
    const hasGeo = Number.isFinite(Number(w.lat)) && Number.isFinite(Number(w.lon));
    const teamId = String(w.proponowana_ekipa_id || w.ekipa_id || '');
    const live = teamId ? liveByTeam[teamId] : null;
    const ageMin = gpsAgeMin(live?.recorded_at);
    return {
      noPin: !hasGeo,
      noGps: Boolean(teamId) && !live,
      staleGps: Boolean(live) && ageMin != null && ageMin > 15,
      gpsAge: ageMin,
    };
  };

  const load = useCallback(async () => {
    try {
      const token = getStoredToken();
      if (!token) { navigate('/'); return; }
      const u = getLocalStorageJson('user', {});
      setUser(u);
      const h = authHeaders(token);
      const [wRes, eRes, ogRes, liveRes, slaRes] = await Promise.all([
        api.get('/wyceny', { headers: h }),
        api.get('/ekipy', { headers: h }),
        api.get('/ogledziny', { headers: h }).catch(() => ({ data: [] })),
        api.get('/ekipy/live-locations', { headers: h }).catch(() => ({ data: { items: [] } })),
        api.get('/quotations/panel/sla-przeterminowane', { headers: h }).catch(() => ({ data: [] })),
      ]);
      setWyceny(Array.isArray(wRes.data) ? wRes.data : (wRes.data.wyceny || []));
      setEkipy(eRes.data.ekipy || eRes.data || []);
      const og = Array.isArray(ogRes.data) ? ogRes.data : (ogRes.data?.ogledziny || []);
      setOgledziny(og);
      const liveItems = Array.isArray(liveRes.data?.items) ? liveRes.data.items : [];
      const map = {};
      for (const item of liveItems) {
        if (item?.ekipa_id != null) map[String(item.ekipa_id)] = item;
      }
      setLiveByTeam(map);
      const slaRaw = slaRes?.data;
      setSlaOverdue(Array.isArray(slaRaw) ? slaRaw : []);
    } catch (e) { console.error(e); }
  }, [navigate]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const sync = () => setCalendarBlocks(loadCalendarBlocks());
    sync();
    window.addEventListener('focus', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('focus', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const ymdForCalDay = (d) =>
    `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

  const wycenyNaDzien = (d) => {
    const ds = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    return wyceny.filter(w => w.data_wykonania?.startsWith(ds));
  };

  const ogledzinyNaDzien = (d) => {
    const ds = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    return ogledziny.filter((o) => {
      const raw = o.data_planowana;
      if (!raw) return false;
      const day = typeof raw === 'string' ? raw.slice(0, 10) : '';
      return day === ds;
    });
  };

  const wycenyWybrany = wycenyNaDzien(selectedDay);
  const ogledzinyWybrane = ogledzinyNaDzien(selectedDay);
  const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}`;
  const monthWyceny = wyceny.filter((w) => (w.data_wykonania || '').startsWith(monthPrefix));
  const monthOgledziny = ogledziny.filter((o) => (o.data_planowana || '').startsWith(monthPrefix));
  const monthPending = monthWyceny.filter((w) => ['oczekuje', 'rezerwacja_wstepna', 'do_specjalisty'].includes(w.status_akceptacji)).length;
  const monthApproved = monthWyceny.filter((w) => w.status_akceptacji === 'zatwierdzono').length;

  const selectedYmd = ymdForCalDay(selectedDay);
  const selectedBlocked = isYmdBlocked(selectedYmd, calendarBlocks);

  const openUnifiedNewOrder = () => {
    if (selectedBlocked) {
      setMsg(warningMessage(t('calendarBlocks.blockedSubmit')));
      return;
    }
    setMsg('');
    navigate(buildNewOrderPath({
      source: 'wycena-kalendarz',
      data: selectedYmd,
      godzina: '08:00',
    }));
  };

  const oznaczKlientAkceptuje = async (wycenaId) => {
    try {
      const token = getStoredToken();
      await api.post(`/wyceny/${wycenaId}/klient-akceptuje`, {}, { headers: authHeaders(token) });
      setMsg(successMessage('Klient zaakceptował — wycena przekazana do specjalisty.'));
      load();
    } catch (err) {
      setMsg(errorMessage(`Błąd: ${getApiErrorMessage(err, err.message)}`));
    }
  };

  const zmienStatusWyceny = async (wycenaId, status) => {
    try {
      const token = getStoredToken();
      await api.patch(`/wyceny/${wycenaId}/status`, { status }, { headers: authHeaders(token) });
      setMsg(successMessage(`Status zmieniony na: ${STATUS_WYCENY_LABEL[status] || status}`));
      load();
    } catch (err) {
      setMsg(errorMessage(getApiErrorMessage(err, 'Błąd zmiany statusu')));
    }
  };

  const konwertujNaZlecenie = async (wycenaId) => {
    try {
      const token = getStoredToken();
      const res = await api.post(`/wyceny/${wycenaId}/konwertuj`, {}, { headers: authHeaders(token) });
      setMsg(successMessage('Wycena skonwertowana na zlecenie!'));
      load();
      if (res.data?.task_id) navigate(`/zlecenia/${res.data.task_id}`);
    } catch (err) {
      setMsg(errorMessage(getApiErrorMessage(err, 'Błąd konwersji na zlecenie')));
    }
  };

  const openReserve = async (w) => {
    const data = (w.data_wykonania || '').slice(0, 10) || new Date().toISOString().slice(0, 10);
    const ekipa_id = String(w.proponowana_ekipa_id || w.ekipa_id || '');
    const godzina = (w.proponowana_godzina || w.godzina_rozpoczecia || '08:00').slice(0, 5);
    const draft = { wycenaId: w.id, data, ekipa_id, godzina, slots: [] };
    setReserveDraft(draft);
    setReserveDiag(null);
    setReserveRuleWarning('');
    if (!ekipa_id) return;
    try {
      setSlotLoading(true);
      const token = getStoredToken();
      const res = await api.get(`/wyceny/availability/slots?ekipa_id=${encodeURIComponent(ekipa_id)}&data=${encodeURIComponent(data)}&exclude_wycena_id=${w.id}&wycena_id=${w.id}`, { headers: authHeaders(token) });
      const slots = (Array.isArray(res.data?.items) ? res.data.items : []).sort((a, b) => (b.score || 0) - (a.score || 0));
      const picked = pickBestOperationalSlot(slots, etaThreshold);
      setReserveDraft((prev) => (prev ? { ...prev, slots, godzina: picked.best?.time || prev.godzina } : prev));
      setReserveDiag(res.data?.diagnostics || null);
      setReserveRuleWarning(picked.warning);
    } catch {
      setReserveDraft((prev) => (prev ? { ...prev, slots: [] } : prev));
    } finally {
      setSlotLoading(false);
    }
  };

  const fetchSlotsForDraft = async (draft, thresholdOverride = null) => {
    if (!draft?.ekipa_id || !draft?.data) return;
    try {
      setSlotLoading(true);
      const token = getStoredToken();
      const res = await api.get(`/wyceny/availability/slots?ekipa_id=${encodeURIComponent(draft.ekipa_id)}&data=${encodeURIComponent(draft.data)}&exclude_wycena_id=${draft.wycenaId}&wycena_id=${draft.wycenaId}`, { headers: authHeaders(token) });
      const slots = (Array.isArray(res.data?.items) ? res.data.items : []).sort((a, b) => (b.score || 0) - (a.score || 0));
      const picked = pickBestOperationalSlot(slots, thresholdOverride ?? etaThreshold);
      setReserveDraft((prev) => (prev ? { ...prev, slots, godzina: picked.best?.time || prev.godzina } : prev));
      setReserveDiag(res.data?.diagnostics || null);
      setReserveRuleWarning(picked.warning);
    } catch {
      setReserveDraft((prev) => (prev ? { ...prev, slots: [] } : prev));
      setReserveDiag(null);
      setReserveRuleWarning('');
    } finally {
      setSlotLoading(false);
    }
  };

  const zapiszRezerwacje = async () => {
    if (!reserveDraft?.wycenaId || !reserveDraft?.ekipa_id || !reserveDraft?.data || !reserveDraft?.godzina) {
      setMsg(warningMessage('Uzupełnij ekipę, datę i godzinę rezerwacji.'));
      return;
    }
    try {
      const token = getStoredToken();
      await api.post(`/wyceny/${reserveDraft.wycenaId}/rezerwuj-termin`, {
        ekipa_id: reserveDraft.ekipa_id,
        data_wykonania: reserveDraft.data,
        godzina_rozpoczecia: reserveDraft.godzina,
      }, { headers: authHeaders(token) });
      setMsg(successMessage('Termin ekipy zarezerwowany wstępnie. Specjalista może teraz zatwierdzić.'));
      setReserveDraft(null);
      setReserveDiag(null);
      setReserveRuleWarning('');
      load();
    } catch (err) {
      setMsg(errorMessage(`Błąd rezerwacji: ${getApiErrorMessage(err, err.message)}`));
    }
  };

  const prevMonth = () => { if (month === 0) { setYear(y => y - 1); setMonth(11); } else setMonth(m => m - 1); };
  const nextMonth = () => { if (month === 11) { setYear(y => y + 1); setMonth(0); } else setMonth(m => m + 1); };

  const canAdd = user && ['Wyceniający', 'Kierownik', 'Administrator', 'Dyrektor'].includes(user.rola);
  const canApprove = user && APPROVE_ROLES.includes(user.rola);
  const isManager = user && MANAGER_ROLES.includes(user.rola);
  const cells = getCalDays(year, month);

  return (
    <div className="app-shell">
      <Sidebar />
      <main className="app-main" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={S.root}>
      <div style={S.bgOrbTop} />
      <div style={S.bgOrbBottom} />
      {/* Header */}
      <div style={S.header}>
        <button style={S.backBtn} onClick={() => navigate(-1)}>←</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={S.headerTitle}>📋 Kalendarz Wycen</div>
          <div style={S.headerSub}>Planowanie i zarządzanie wizytami specjalisty ds. wyceny</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginLeft: 'auto' }}>
          <button type="button" style={S.linkBtn} onClick={() => navigate('/blokady-kalendarza')}>
            {t('nav.calendarBlocks')}
          </button>
          {canApprove && (
            <button type="button" style={S.linkBtn} onClick={() => navigate('/zatwierdz-wyceny')}>
              {t('nav.approveQuotes')}
            </button>
          )}
          {canAdd && (
            <button style={S.addBtn} onClick={openUnifiedNewOrder}>
              + Nowa wycena
            </button>
          )}
        </div>
      </div>

      <StatusMessage message={msg} style={S.msg} />

      {slaOverdue.length > 0 && (
        <div
          style={{
            margin: '0 16px 12px',
            padding: 14,
            borderRadius: 12,
            border: '1px solid rgba(239,68,68,0.45)',
            background: 'rgba(239,68,68,0.08)',
          }}
        >
          <div style={{ fontWeight: 700, color: '#F87171', marginBottom: 8 }}>
            SLA — zatwierdzenia po terminie ({slaOverdue.length})
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
            Wycena w statusie „W zatwierdzeniu”, termin SLA minął. Otwórz wycenę terenową, aby rozstrzygnąć kolejkę zatwierdzeń.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {slaOverdue.map((row) => (
              <button
                key={`${row.quotation_id}-${row.approval_id}`}
                type="button"
                onClick={() => navigate(`/wyceny-terenowe/${row.quotation_id}`)}
                style={{
                  textAlign: 'left',
                  padding: '10px 12px',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  background: 'var(--card)',
                  cursor: 'pointer',
                  color: 'var(--text)',
                }}
              >
                <div style={{ fontWeight: 600 }}>
                  #{row.quotation_id} — {row.klient_nazwa || '—'}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                  Typ: <strong>{row.wymagany_typ}</strong>
                  {' · '}
                  Termin SLA: {fmtSlaDue(row.due_at)}
                  {row.sla_reminder_sent_at ? (
                    <span style={{ color: '#94A3B8' }}> · Cron: przypomnienie wysłane</span>
                  ) : (
                    <span style={{ color: '#F59E0B' }}> · Cron: jeszcze bez przypomnienia</span>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={S.kpiRow}>
        <div style={S.kpiCard}>
          <div style={S.kpiLabel}>Miesiąc: wyceny</div>
          <div style={S.kpiValue}>{monthWyceny.length}</div>
        </div>
        <div style={S.kpiCard}>
          <div style={S.kpiLabel}>Miesiąc: oględziny</div>
          <div style={S.kpiValue}>{monthOgledziny.length}</div>
        </div>
        <div style={S.kpiCard}>
          <div style={S.kpiLabel}>Do decyzji</div>
          <div style={{ ...S.kpiValue, color: 'var(--warning)' }}>{monthPending}</div>
        </div>
        <div style={S.kpiCard}>
          <div style={S.kpiLabel}>Zatwierdzone</div>
          <div style={{ ...S.kpiValue, color: 'var(--accent)' }}>{monthApproved}</div>
        </div>
      </div>

      <div style={S.body}>
        <div style={S.viewToggle}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', marginRight: 8 }}>Widok kalendarza:</span>
          {[
            { id: 'combined', label: 'Wyceny + oględziny' },
            { id: 'wyceny', label: 'Tylko wyceny' },
            { id: 'ogledziny', label: 'Tylko oględziny' },
          ].map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => setCalView(v.id)}
              style={{
                ...S.viewBtn,
                ...(calView === v.id ? S.viewBtnOn : {}),
              }}
            >
              {v.label}
            </button>
          ))}
        </div>

        {/* Kalendarz */}
        <div style={S.calBox}>
          <div style={S.monthNav}>
            <button style={S.navBtn} onClick={prevMonth}>‹</button>
            <span style={S.monthTitle}>{MIESIAC[month]} {year}</span>
            <button style={S.navBtn} onClick={nextMonth}>›</button>
          </div>
          <div style={S.calGrid}>
            {DNI.map(d => <div key={d} style={S.dayHead}>{d}</div>)}
            {cells.map((d, i) => {
              if (!d) return <div key={i} style={S.emptyCell} />;
              const isToday = d === today.getDate() && month === today.getMonth() && year === today.getFullYear();
              const isSel = d === selectedDay;
              const ymd = ymdForCalDay(d);
              const blocked = isYmdBlocked(ymd, calendarBlocks);
              const listW = wycenyNaDzien(d);
              const listO = ogledzinyNaDzien(d);
              const showDots = calView !== 'ogledziny' && listW.length > 0;
              const showOg = calView !== 'wyceny' && listO.length > 0;
              return (
                <div key={i}
                  title={blocked ? t('calendarBlocks.legend') : undefined}
                  style={{
                    ...S.dayCell,
                    ...(blocked && !isSel ? S.blockedCell : {}),
                    ...(isToday ? S.todayCell : {}),
                    ...(isSel ? S.selCell : {}),
                  }}
                  onClick={() => setSelectedDay(d)}
                >
                  <span style={{ ...S.dayNum, ...(isToday ? { color: 'var(--accent)', fontWeight: 'bold' } : {}), ...(isSel ? { color: '#fff', fontWeight: 'bold' } : {}) }}>{d}</span>
                  {(showDots || showOg) && (
                    <div style={{ ...S.dotRow, flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                      {showOg && (
                        <span style={{ fontSize: 9, fontWeight: 700, color: isSel ? '#fff' : '#60A5FA' }}>{listO.length} og.</span>
                      )}
                      {showDots && (
                        <div style={{ ...S.dotRow, justifyContent: 'center' }}>
                          {listW.slice(0, 3).map((w, wi) => (
                            <div key={wi} style={{ ...S.dot, backgroundColor: STATUS_KOLOR[w.status_akceptacji] || '#6B7280' }} />
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Legenda */}
          <div style={S.legenda}>
            <div style={S.legendaItem}>
              <div style={{ width: 12, height: 10, borderRadius: 3, ...S.blockedCell }} />
              <span style={{ fontSize: 12, color: 'var(--text-sub)' }}>{t('calendarBlocks.legend')}</span>
            </div>
            {Object.entries(STATUS_LABEL).map(([k, v]) => (
              <div key={k} style={S.legendaItem}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: STATUS_KOLOR[k] }} />
                <span style={{ fontSize: 12, color: 'var(--text-sub)' }}>{v}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Panel dnia */}
        <div style={S.dayPanel}>
          <div style={S.dayPanelHeader}>
            <span style={S.dayPanelTitle}>
              {String(selectedDay).padStart(2, '0')} {MIESIAC[month]} {year}
            </span>
            <span style={S.dayPanelCount}>
              {calView !== 'ogledziny' && `${wycenyWybrany.length} wyc.`}
              {calView === 'combined' && ' · '}
              {calView !== 'wyceny' && `${ogledzinyWybrane.length} ogł.`}
            </span>
          </div>

          {selectedBlocked && (
            <div
              style={{
                marginBottom: 12,
                padding: '10px 12px',
                borderRadius: 10,
                border: '1px solid rgba(239,68,68,0.45)',
                background: 'rgba(239,68,68,0.08)',
                fontSize: 13,
                color: '#FCA5A5',
              }}
            >
              {t('calendarBlocks.blockedWarning')}
            </div>
          )}

          {calView !== 'wyceny' && ogledzinyWybrane.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 8 }}>Oględziny (termin wizyty — bez ceny realizacji)</div>
              {ogledzinyWybrane.map((o) => (
                <div
                  key={o.id}
                  style={{
                    padding: '10px 12px',
                    borderRadius: 10,
                    border: '1px solid var(--border)',
                    background: 'var(--surface-field)',
                    marginBottom: 8,
                    fontSize: 13,
                    cursor: 'pointer',
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setCalView('ogledziny');
                    if (o.data_planowana) {
                      const d = new Date(o.data_planowana);
                      if (d.getFullYear() === year && d.getMonth() === month) {
                        setSelectedDay(d.getDate());
                      }
                    }
                  }}
                  role="presentation"
                >
                  <div style={{ fontWeight: 600 }}>Klient #{o.klient_id}{o.adres ? ` · ${o.adres}` : ''}</div>
                  <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                    {o.data_planowana ? new Date(o.data_planowana).toLocaleString('pl-PL') : '—'} · {o.status || '—'}
                  </div>
                </div>
              ))}
            </div>
          )}

          {calView !== 'ogledziny' && wycenyWybrany.length === 0 && (
            <div style={S.empty}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
              <div style={{ color: 'var(--text-sub)', fontSize: 15 }}>Brak wycen na ten dzień</div>
              {canAdd && (
                <button style={S.addBtnSm} onClick={openUnifiedNewOrder}>
                  + Dodaj wycenę
                </button>
              )}
            </div>
          )}
          {calView !== 'ogledziny' && wycenyWybrany.length > 0 && wycenyWybrany.map(w => (
              <div key={w.id} style={S.wycenaCard} onClick={() => setWybranaWycena(wybranaWycena?.id === w.id ? null : w)}>
                {(() => {
                  const q = dataQualityFlags(w);
                  return (q.noPin || q.noGps || q.staleGps) ? (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                      {q.noPin ? <span style={{ ...S.metaChip, color: '#F59E0B' }}>Brak pinezki klienta</span> : null}
                      {q.noGps ? <span style={{ ...S.metaChip, color: '#F87171' }}>Brak GPS ekipy</span> : null}
                      {q.staleGps ? <span style={{ ...S.metaChip, color: '#F87171' }}>Stary GPS ({q.gpsAge} min)</span> : null}
                    </div>
                  ) : null;
                })()}
                <div style={S.wycenaTop}>
                  <div style={{ flex: 1 }}>
                    <div style={S.wycenaKlient}>{w.klient_nazwa || w.adres}</div>
                    <div style={S.wycenaSub}>📍 {w.adres}, {w.miasto}</div>
                    {w.ekipa_nazwa && <div style={S.wycenaSub}>👷 {w.ekipa_nazwa}</div>}
                    {w.typ_uslugi && <div style={S.wycenaSub}>🌳 {w.typ_uslugi}</div>}
                    {w.godzina_rozpoczecia && <div style={S.wycenaSub}>🕐 {w.godzina_rozpoczecia}</div>}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                    <span style={{ ...S.badge, backgroundColor: STATUS_KOLOR[w.status_akceptacji] + '33', color: STATUS_KOLOR[w.status_akceptacji] }}>
                      {STATUS_LABEL[w.status_akceptacji]}
                    </span>
                    {w.wartosc_planowana && (
                      <span style={S.kwota}>{fmt(w.wartosc_planowana)}</span>
                    )}
                  </div>
                </div>
                {wybranaWycena?.id === w.id && (
                  <div style={S.wycenaDetail}>
                    {w.wycena_uwagi && <div style={S.detailRow}><span style={S.detailLabel}>Uwagi:</span><span style={S.detailVal}>{w.wycena_uwagi}</span></div>}
                    {w.czas_planowany_godziny && <div style={S.detailRow}><span style={S.detailLabel}>Czas:</span><span style={S.detailVal}>{w.czas_planowany_godziny}h</span></div>}
                    {w.wyceniajacy_nazwa && <div style={S.detailRow}><span style={S.detailLabel}>Specjalista ds. wyceny:</span><span style={S.detailVal}>{w.wyceniajacy_nazwa}</span></div>}
                    {w.zatwierdzone_przez_nazwa && <div style={S.detailRow}><span style={S.detailLabel}>Zatwierdził:</span><span style={S.detailVal}>{w.zatwierdzone_przez_nazwa}</span></div>}
                    {(w.status_akceptacji === 'oczekuje' || w.status_akceptacji === 'rezerwacja_wstepna') && (
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <button style={S.openBtn} onClick={(e) => { e.stopPropagation(); openReserve(w); }}>
                          Rezerwuj termin ekipy
                        </button>
                        <button style={S.openBtn} onClick={(e) => { e.stopPropagation(); oznaczKlientAkceptuje(w.id); }}>
                          Klient zaakceptował → do specjalisty
                        </button>
                      </div>
                    )}
                    {w.status_akceptacji === 'zatwierdzono' && w.task_id && (
                      <button style={S.openBtn} onClick={(e) => { e.stopPropagation(); navigate(`/zlecenia/${w.task_id}`); }}>
                        Otwórz zlecenie →
                      </button>
                    )}

                    {/* Sprzęt */}
                    {SPRZET_POLA.filter(s => w[s.key]).length > 0 && (
                      <div style={{ marginTop: 8 }}>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4 }}>Sprzęt</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          {SPRZET_POLA.filter(s => w[s.key]).map(s => (
                            <span key={s.key} style={{ padding: '3px 8px', borderRadius: 6, background: 'var(--accent-soft, rgba(155,217,87,0.14))', color: 'var(--accent)', fontSize: 12, fontWeight: 600 }}>
                              {s.label}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Zmiana statusu wyceny (manager) */}
                    {isManager && (
                      <div style={{ marginTop: 10 }}>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 6 }}>Zmień status wyceny</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          {WYCENA_STATUSES.filter(s => s !== w.status).map(s => (
                            <button key={s} type="button"
                              style={{ padding: '4px 10px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface-field)', color: 'var(--text)', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}
                              onClick={(e) => { e.stopPropagation(); zmienStatusWyceny(w.id, s); }}>
                              {STATUS_WYCENY_LABEL[s]}
                            </button>
                          ))}
                        </div>
                        {isManager && w.status === 'Zaakceptowana' && (
                          <button type="button"
                            style={{ marginTop: 8, padding: '6px 14px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: 'var(--on-accent)', fontSize: 13, cursor: 'pointer', fontWeight: 700 }}
                            onClick={(e) => { e.stopPropagation(); konwertujNaZlecenie(w.id); }}>
                            ⚡ Konwertuj na zlecenie
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          {calView === 'ogledziny' && ogledzinyWybrane.length === 0 && (
            <div style={S.empty}>
              <div style={{ color: 'var(--text-sub)', fontSize: 15 }}>Brak oględzin w tym dniu</div>
            </div>
          )}
        </div>
      </div>

      {reserveDraft && (
        <div style={S.overlay} onClick={() => setReserveDraft(null)}>
          <div style={S.modal} onClick={(e) => e.stopPropagation()}>
            <div style={S.modalHeader}>
              <div style={S.modalTitle}>📌 Rezerwacja terminu ekipy</div>
              <button style={S.closeBtn} onClick={() => setReserveDraft(null)}>✕</button>
            </div>
            <div style={S.form}>
              <div style={S.fieldWrap}>
                <label style={S.label}>Ekipa</label>
                <select style={S.input} value={reserveDraft.ekipa_id} onChange={(e) => {
                  const next = { ...reserveDraft, ekipa_id: e.target.value };
                  setReserveDraft(next);
                  fetchSlotsForDraft(next);
                }}>
                  <option value="">— wybierz ekipę —</option>
                  {ekipy.map((e) => <option key={e.id} value={e.id}>{e.nazwa}</option>)}
                </select>
              </div>
              <div style={S.row2}>
                <div style={S.fieldWrap}>
                  <label style={S.label}>Data</label>
                  <input style={S.input} type="date" value={reserveDraft.data} onChange={(e) => {
                    const next = { ...reserveDraft, data: e.target.value };
                    setReserveDraft(next);
                    fetchSlotsForDraft(next);
                  }} />
                </div>
                <div style={S.fieldWrap}>
                  <label style={S.label}>Godzina (ręcznie)</label>
                  <input style={S.input} type="time" value={reserveDraft.godzina} onChange={(e) => setReserveDraft((p) => ({ ...p, godzina: e.target.value }))} />
                </div>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Proponowane wolne sloty:
              </div>
              {reserveDiag ? (
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  ETA: {reserveDiag.eta_available ? 'dostępne' : `niedostępne (${etaReasonLabel(reserveDiag.eta_unavailable_reason) || 'brak danych'})`}
                  {reserveDiag.target_source === 'task_pin' ? ' • punkt: pin zadania' : ''}
                  {reserveDiag.target_source === 'wycena' ? ' • punkt: wycena' : ''}
                  {reserveDiag.team_gps_age_min != null ? ` • wiek GPS: ${reserveDiag.team_gps_age_min} min` : ''}
                </div>
              ) : null}
              {reserveRuleWarning ? (
                <div style={{ fontSize: 12, color: '#F59E0B' }}>{reserveRuleWarning}</div>
              ) : null}
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                Najpierw pokazujemy sloty z ETA, potem bez ETA.
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                Próg ETA: {etaThreshold} min
                <div style={{ display: 'inline-flex', gap: 6, marginLeft: 8 }}>
                  {[20, 25, 30].map((v) => (
                    <button key={v} type="button" style={{ ...S.ekipaPill, opacity: etaThreshold === v ? 1 : 0.75 }} onClick={() => {
                      setEtaThresholdPersisted(v);
                      if (reserveDraft) fetchSlotsForDraft(reserveDraft, v);
                    }}>
                      {v}m
                    </button>
                  ))}
                </div>
              </div>
              <div style={S.ekipyGrid}>
                {slotLoading ? <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Liczenie slotów...</span> : null}
                {!slotLoading && reserveDraft.slots?.length === 0 ? <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Brak sugestii dla tej daty.</span> : null}
                {(reserveDraft.slots || []).filter((s) => s.eta_minutes != null).map((slotObj) => (
                  <button key={slotObj.time || slotObj} type="button" style={S.ekipaPill} onClick={() => setReserveDraft((p) => ({ ...p, godzina: slotObj.time || slotObj }))}>
                    {(slotObj.time || slotObj)}
                    {slotObj.eta_minutes != null ? ` • ETA ${slotObj.eta_minutes} min` : ''}
                    {slotObj.eta_source === 'task_pin' ? ' • pin' : ''}
                    {slotObj.eta_minutes == null && slotObj.eta_unavailable_reason ? ` • ${etaReasonLabel(slotObj.eta_unavailable_reason)}` : ''}
                  </button>
                ))}
              </div>
              {(reserveDraft.slots || []).some((s) => s.eta_minutes == null) ? (
                <div style={{ fontSize: 11, color: '#F59E0B', marginTop: 4 }}>Sloty bez ETA (niższy priorytet):</div>
              ) : null}
              <div style={S.ekipyGrid}>
                {(reserveDraft.slots || []).filter((s) => s.eta_minutes == null).map((slotObj) => (
                  <button key={slotObj.time || slotObj} type="button" style={{ ...S.ekipaPill, opacity: 0.85 }} onClick={() => setReserveDraft((p) => ({ ...p, godzina: slotObj.time || slotObj }))}>
                    {(slotObj.time || slotObj)}
                    {slotObj.eta_unavailable_reason ? ` • ${etaReasonLabel(slotObj.eta_unavailable_reason)}` : ''}
                  </button>
                ))}
              </div>
              <div style={S.formBtns}>
                <button type="button" style={S.cancelBtn} onClick={() => setReserveDraft(null)}>Anuluj</button>
                <button type="button" style={S.submitBtn} onClick={zapiszRezerwacje}>Zapisz rezerwację</button>
              </div>
            </div>
          </div>
        </div>
      )}
        </div>
      </main>
    </div>
  );
}

const S = {
  root: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    background: 'transparent',
    color: 'var(--text)',
    position: 'relative',
    overflow: 'hidden',
  },
  bgOrbTop: { display: 'none' },
  bgOrbBottom: { display: 'none' },
  viewToggle: {
    width: '100%',
    flexBasis: '100%',
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  viewBtn: {
    padding: '6px 12px',
    borderRadius: 8,
    border: '1px solid var(--border)',
    background: 'var(--surface-field)',
    color: 'var(--text-sub)',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
  },
  viewBtnOn: { borderColor: 'var(--accent)', color: 'var(--accent)', background: 'var(--accent-surface)' },

  header: {
    display: 'flex', alignItems: 'center', gap: 16, padding: '16px 18px', marginBottom: 14,
    background: 'var(--surface-glass)',
    border: '1px solid var(--glass-border)', borderRadius: 8, boxShadow: 'var(--shadow-sm)', position: 'relative', zIndex: 1
  },
  backBtn: { background: 'none', border: 'none', color: 'var(--accent)', fontSize: 22, cursor: 'pointer', padding: '4px 8px' },
  headerTitle: { fontSize: 24, fontWeight: 850, color: 'var(--text)' },
  headerSub: { fontSize: 13, color: 'var(--text-sub)', marginTop: 2 },
  addBtn: { padding: '10px 20px', backgroundColor: 'var(--accent)', color: 'var(--on-accent)', border: '1px solid var(--border)', borderRadius: 10, fontWeight: 'bold', fontSize: 14, cursor: 'pointer', boxShadow: 'var(--shadow-sm)' },
  linkBtn: {
    padding: '8px 12px',
    background: 'var(--surface-field)',
    color: 'var(--text-sub)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },

  msg: { margin: '12px 0', position: 'relative', zIndex: 1 },
  kpiRow: {
    margin: '0 0 14px',
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
    gap: 10,
    position: 'relative',
    zIndex: 1,
  },
  kpiCard: {
    background: 'var(--surface-glass)',
    border: '1px solid var(--border)',
    borderRadius: 14,
    padding: '10px 12px',
    boxShadow: 'var(--shadow-sm)',
  },
  kpiLabel: { fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em' },
  kpiValue: { marginTop: 5, fontSize: 22, fontWeight: 800, color: 'var(--text)' },

  body: { display: 'flex', gap: 20, padding: '20px 0', flexWrap: 'wrap', position: 'relative', zIndex: 1 },

  calBox: { flex: '1 1 320px', maxWidth: 420, minWidth: 0, background: 'var(--surface-glass)', borderRadius: 8, padding: 20, border: '1px solid var(--glass-border)', boxShadow: 'var(--shadow-sm)', alignSelf: 'flex-start', position: 'sticky', top: 16 },
  monthNav: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  navBtn: { width: 36, height: 36, borderRadius: '50%', backgroundColor: 'var(--surface-field)', border: '1px solid var(--border)', color: 'var(--accent)', fontSize: 20, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  monthTitle: { fontSize: 17, fontWeight: 'bold', color: 'var(--accent)' },
  calGrid: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 },
  dayHead: { textAlign: 'center', fontSize: 11, fontWeight: '600', color: 'var(--text-muted)', padding: '6px 0' },
  dayCell: { aspectRatio: '1', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', borderRadius: 10, cursor: 'pointer', padding: 2, transition: 'background 0.15s, transform 0.15s', border: '1px solid transparent' },
  blockedCell: {
    background: 'repeating-linear-gradient(-45deg, rgba(239,68,68,0.10), rgba(239,68,68,0.10) 4px, transparent 4px, transparent 7px)',
    border: '1px dashed rgba(239,68,68,0.45)',
  },
  todayCell: { border: '2px solid var(--accent)' },
  selCell: { backgroundColor: 'var(--accent)', color: 'var(--on-accent)' },
  emptyCell: { aspectRatio: '1' },
  dayNum: { fontSize: 13, color: 'var(--text-sub)' },
  dotRow: { display: 'flex', gap: 2, marginTop: 2 },
  dot: { width: 5, height: 5, borderRadius: '50%' },

  legenda: { display: 'flex', gap: 12, marginTop: 14, flexWrap: 'wrap' },
  legendaItem: { display: 'flex', alignItems: 'center', gap: 6 },

  dayPanel: { flex: '2 1 320px', minWidth: 0, background: 'var(--surface-glass)', border: '1px solid var(--glass-border)', borderRadius: 8, padding: 16, boxShadow: 'var(--shadow-sm)' },
  dayPanelHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  dayPanelTitle: { fontSize: 18, fontWeight: 'bold', color: 'var(--text)' },
  dayPanelCount: { fontSize: 13, color: 'var(--text-muted)', backgroundColor: 'var(--surface-field)', padding: '3px 10px', borderRadius: 20, border: '1px solid var(--border)' },

  empty: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 60, background: 'var(--surface-glass)', borderRadius: 8, border: '1px solid var(--glass-border)', boxShadow: 'var(--shadow-md)' },
  addBtnSm: { marginTop: 16, padding: '10px 20px', backgroundColor: 'var(--accent)', color: 'var(--on-accent)', border: '1px solid var(--border)', borderRadius: 10, fontWeight: 'bold', cursor: 'pointer' },

  wycenaCard: { background: 'var(--surface-glass)', borderRadius: 8, padding: 16, marginBottom: 12, border: '1px solid var(--glass-border)', boxShadow: 'var(--shadow-md)', cursor: 'pointer', transition: 'all 0.2s', position: 'relative', overflow: 'hidden' },
  wycenaTop: { display: 'flex', gap: 12, justifyContent: 'space-between' },
  wycenaKlient: { fontSize: 15, fontWeight: '600', color: 'var(--text)', marginBottom: 4 },
  wycenaSub: { fontSize: 12, color: 'var(--text-sub)', marginTop: 2 },
  badge: { fontSize: 11, fontWeight: '600', padding: '3px 10px', borderRadius: 20 },
  kwota: { fontSize: 14, fontWeight: 'bold', color: 'var(--accent)' },
  wycenaDetail: { marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' },
  detailRow: { display: 'flex', gap: 8, marginBottom: 6, fontSize: 13 },
  detailLabel: { color: 'var(--text-muted)', minWidth: 100 },
  detailVal: { color: 'var(--text)', flex: 1 },
  openBtn: { marginTop: 8, padding: '8px 16px', backgroundColor: 'var(--accent)', color: 'var(--on-accent)', border: '1px solid var(--border)', borderRadius: 8, fontWeight: 'bold', cursor: 'pointer', fontSize: 13 },

  // Modal
  overlay: { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 },
  modal: { background: 'var(--surface-glass)', borderRadius: 8, width: '100%', maxWidth: 640, maxHeight: '90vh', overflowY: 'auto', padding: 28, border: '1px solid var(--glass-border)', boxShadow: 'var(--shadow-lg)' },
  modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  modalTitle: { fontSize: 20, fontWeight: 'bold', color: 'var(--text)' },
  closeBtn: { background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 20, cursor: 'pointer', padding: 4 },

  form: { display: 'flex', flexDirection: 'column', gap: 16 },
  formSection: { backgroundColor: 'var(--surface-field)', borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 12, border: '1px solid var(--border)' },
  sectionLabel: { fontSize: 13, fontWeight: '600', color: 'var(--accent)', marginBottom: 4 },
  row2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 },
  fieldWrap: { display: 'flex', flexDirection: 'column', gap: 4 },
  label: { fontSize: 12, fontWeight: '600', color: 'var(--text-sub)', textTransform: 'uppercase', letterSpacing: '0.05em' },
  input: { padding: '10px 12px', backgroundColor: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', fontSize: 14, outline: 'none' },

  ekipyGrid: { display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  ekipaPill: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '7px 14px',
    borderRadius: 20,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: 'var(--border)',
    backgroundColor: 'var(--bg)',
    color: 'var(--text-sub)',
    fontSize: 13,
    cursor: 'pointer',
    transition: 'all 0.15s',
    fontWeight: '500',
  },

  formBtns: { display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 8 },
  cancelBtn: { padding: '10px 20px', backgroundColor: 'var(--surface-field)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text-sub)', cursor: 'pointer', fontSize: 14 },
  submitBtn: { padding: '10px 24px', backgroundColor: 'var(--accent)', color: 'var(--on-accent)', border: '1px solid var(--border)', borderRadius: 10, fontWeight: 'bold', fontSize: 14, cursor: 'pointer', boxShadow: 'var(--shadow-sm)' },
};
