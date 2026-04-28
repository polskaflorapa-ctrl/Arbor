import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../api';
import StatusMessage from '../components/StatusMessage';
import CityInput from '../components/CityInput';
import PhotoAnnotator from '../components/PhotoAnnotator';
import { getApiErrorMessage } from '../utils/apiError';
import { getLocalStorageJson } from '../utils/safeJsonLocalStorage';
import { getStoredToken, authHeaders } from '../utils/storedToken';
import { errorMessage, successMessage, warningMessage } from '../utils/statusMessage';
import Sidebar from '../components/Sidebar';

const MIESIAC = ['Styczeń','Luty','Marzec','Kwiecień','Maj','Czerwiec',
  'Lipiec','Sierpień','Wrzesień','Październik','Listopad','Grudzień'];
const DNI = ['Pn','Wt','Śr','Cz','Pt','Sb','Nd'];

const USLUGI = [
  'Wycinka drzew','Pielęgnacja drzew','Karczowanie','Frezowanie pniaków',
  'Pielęgnacja krzewów','Koszenie','Usługi alpinistyczne','Wywóz drewna',
  'Mulczowanie','Nasadzenia','Inne'
];

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

function pickBestOperationalSlot(slots, etaThresholdMinutes) {
  const withEta = (slots || []).filter((s) => s.eta_minutes != null);
  const safeEta = withEta.filter((s) => Number(s.eta_minutes) <= etaThresholdMinutes);
  if (safeEta.length > 0) return { best: safeEta[0], warning: '' };
  if (withEta.length > 0) return { best: withEta[0], warning: `Brak slotu ETA <= ${etaThresholdMinutes} min. Wybrano najlepszy dostępny.` };
  const fallback = (slots || [])[0] || null;
  return { best: fallback, warning: 'Brak slotów z ETA. Sprawdź GPS/pinezkę klienta.' };
}

export default function WycenaKalendarz() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [selectedDay, setSelectedDay] = useState(today.getDate());
  const [wyceny, setWyceny] = useState([]);
  const [ekipy, setEkipy] = useState([]);
  const [oddzialy, setOddzialy] = useState([]);
  const [user, setUser] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [wybranaWycena, setWybranaWycena] = useState(null);
  const [aiAnalyzing, setAiAnalyzing] = useState(false);
  const [aiResult, setAiResult] = useState(null);
  const photoInputRef = useRef(null);
  const videoInputRef = useRef(null);
  const annotateInputRef = useRef(null);

  const [ogledziny, setOgledziny] = useState([]);
  const [calView, setCalView] = useState('combined');
  const [annotateFile, setAnnotateFile] = useState(null);
  const [annotatedPayloads, setAnnotatedPayloads] = useState([]);
  const [videoFiles, setVideoFiles] = useState([]);
  const [reserveDraft, setReserveDraft] = useState(null);
  const [reserveDiag, setReserveDiag] = useState(null);
  const [reserveRuleWarning, setReserveRuleWarning] = useState('');
  const [slotLoading, setSlotLoading] = useState(false);
  const [liveByTeam, setLiveByTeam] = useState({});
  const [etaThreshold, setEtaThreshold] = useState(25);

  const [form, setForm] = useState({
    klient_nazwa: '',
    adres: '',
    miasto: '',
    oddzial_id: '',
    ekipa_id: '',
    typ_uslugi: '',
    data_wykonania: '',
    godzina_rozpoczecia: '08:00',
    czas_planowany_godziny: '',
    wartosc_planowana: '',
    wycena_uwagi: '',
  });

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
      const [wRes, eRes, oRes, ogRes, liveRes] = await Promise.all([
        api.get('/wyceny', { headers: h }),
        api.get('/ekipy', { headers: h }),
        api.get('/oddzialy', { headers: h }),
        api.get('/ogledziny', { headers: h }).catch(() => ({ data: [] })),
        api.get('/ekipy/live-locations', { headers: h }).catch(() => ({ data: { items: [] } })),
      ]);
      setWyceny(Array.isArray(wRes.data) ? wRes.data : (wRes.data.wyceny || []));
      setEkipy(eRes.data.ekipy || eRes.data || []);
      setOddzialy(oRes.data.oddzialy || oRes.data || []);
      const og = Array.isArray(ogRes.data) ? ogRes.data : (ogRes.data?.ogledziny || []);
      setOgledziny(og);
      const liveItems = Array.isArray(liveRes.data?.items) ? liveRes.data.items : [];
      const map = {};
      for (const item of liveItems) {
        if (item?.ekipa_id != null) map[String(item.ekipa_id)] = item;
      }
      setLiveByTeam(map);
      if (u?.oddzial_id) setForm(f => ({ ...f, oddzial_id: u.oddzial_id.toString() }));
    } catch (e) { console.error(e); }
  }, [navigate]);

  useEffect(() => { load(); }, [load]);

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

  const setF = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.ekipa_id) { setMsg(warningMessage('Wybierz ekipę — pole obowiązkowe!')); return; }
    if (!form.adres) { setMsg(warningMessage('Wpisz adres!')); return; }
    setSaving(true);
    try {
      const token = getStoredToken();
      const ds = `${year}-${String(month + 1).padStart(2, '0')}-${String(selectedDay).padStart(2, '0')}`;
      const videoNote =
        videoFiles.length > 0
          ? `\n[Wideo — do zapisu na serwerze: ${videoFiles.map((f) => f.name).join(', ')}]`
          : '';
      const payload = {
        ...form,
        data_wykonania: form.data_wykonania || ds,
        wycena_uwagi: (form.wycena_uwagi || '') + videoNote,
      };
      if (annotatedPayloads.length > 0) {
        const compact = annotatedPayloads.slice(0, 2).map((p) => ({ mime: p.mime, dataBase64: p.dataBase64 }));
        const json = JSON.stringify(compact);
        if (json.length > 400_000) {
          setMsg(warningMessage('Adnotowane zdjęcia są za duże — usuń jedno lub zmniejsz rysunek.'));
          setSaving(false);
          return;
        }
        payload.zdjecia_adnotowane_json = json;
      }
      const res = await api.post('/wyceny', payload, { headers: authHeaders(token) });
      const newId = res.data?.id ?? res.data?.zlecenie?.id;
      let videoUploadProblem = '';
      if (newId && videoFiles.length > 0) {
        for (const file of videoFiles) {
          const fd = new FormData();
          fd.append('wideo', file, file.name);
          try {
            await api.post(`/wyceny/${newId}/wideo`, fd, {
              headers: authHeaders(token),
            });
          } catch (upErr) {
            console.error(upErr);
            videoUploadProblem += (videoUploadProblem ? ' ' : '') + `„${file.name}”`;
          }
        }
      }
      if (videoUploadProblem) {
        setMsg(warningMessage(`Wycena zapisana, ale upload wideo nie powiódł się: ${videoUploadProblem}. Sprawdź backend (POST /wyceny/:id/wideo, multer).`));
      } else {
        setMsg(successMessage('Wycena dodana — czeka na zatwierdzenie przez menedżera'));
      }
      setShowForm(false);
      setVideoFiles([]);
      setAnnotatedPayloads([]);
      setForm(f => ({ ...f, klient_nazwa: '', adres: '', miasto: '', ekipa_id: '', typ_uslugi: '', wartosc_planowana: '', wycena_uwagi: '', czas_planowany_godziny: '' }));
      load();
    } catch (err) {
      setMsg(errorMessage(`Błąd: ${getApiErrorMessage(err, err.message)}`));
    } finally {
      setSaving(false);
    }
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

  const handleAiPhoto = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAiAnalyzing(true);
    setAiResult(null);
    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = reader.result.split(',')[1];
        const mediaType = file.type || 'image/jpeg';
        const token = getStoredToken();
        const res = await api.post('/ai/analyze-photo', {
          imageBase64: base64,
          mediaType,
          adres: form.adres,
          miasto: form.miasto,
        }, { headers: authHeaders(token) });

        const p = res.data.parsed;
        if (p) {
          setAiResult(p);
          // Autouzupełnij formularz
          setForm(f => ({
            ...f,
            typ_uslugi: p.typ_uslugi || f.typ_uslugi,
            wartosc_planowana: p.cena_min ? String(Math.round((p.cena_min + p.cena_max) / 2)) : f.wartosc_planowana,
            czas_planowany_godziny: p.czas_godziny ? String(p.czas_godziny) : f.czas_planowany_godziny,
            wycena_uwagi: p.opis_zakresu || f.wycena_uwagi,
          }));
        } else {
          setAiResult({ raw: res.data.raw });
        }
      };
      reader.readAsDataURL(file);
    } catch (err) {
      setMsg(errorMessage(`Błąd analizy AI: ${getApiErrorMessage(err, err.message)}`));
    } finally {
      setAiAnalyzing(false);
    }
  };

  const prevMonth = () => { if (month === 0) { setYear(y => y - 1); setMonth(11); } else setMonth(m => m - 1); };
  const nextMonth = () => { if (month === 11) { setYear(y => y + 1); setMonth(0); } else setMonth(m => m + 1); };

  const canAdd = user && ['Wyceniający', 'Kierownik', 'Administrator', 'Dyrektor'].includes(user.rola);
  const filtEkipy = ekipy.filter(e => !form.oddzial_id || e.oddzial_id?.toString() === form.oddzial_id);
  const cells = getCalDays(year, month);
  const isWycenaFormValid = Boolean(form.ekipa_id && form.adres.trim());

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
        <div>
          <div style={S.headerTitle}>📋 Kalendarz Wycen</div>
          <div style={S.headerSub}>Planowanie i zarządzanie wizytami wyceniającego</div>
        </div>
        {canAdd && (
          <button style={S.addBtn} onClick={() => { setShowForm(true); setMsg(''); }}>
            + Nowa wycena
          </button>
        )}
      </div>

      <StatusMessage message={msg} style={S.msg} />

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
              const listW = wycenyNaDzien(d);
              const listO = ogledzinyNaDzien(d);
              const showDots = calView !== 'ogledziny' && listW.length > 0;
              const showOg = calView !== 'wyceny' && listO.length > 0;
              return (
                <div key={i}
                  style={{ ...S.dayCell, ...(isToday ? S.todayCell : {}), ...(isSel ? S.selCell : {}) }}
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
                    background: 'var(--bg-deep)',
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
                <button style={S.addBtnSm} onClick={() => { setShowForm(true); setMsg(''); }}>
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
                    {w.wyceniajacy_nazwa && <div style={S.detailRow}><span style={S.detailLabel}>Wyceniający:</span><span style={S.detailVal}>{w.wyceniajacy_nazwa}</span></div>}
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

      {/* Modal — formularz nowej wyceny */}
      {showForm && (
        <div style={S.overlay} onClick={() => setShowForm(false)}>
          <div style={S.modal} onClick={e => e.stopPropagation()}>
            <div style={S.modalHeader}>
              <div style={S.modalTitle}>📋 Nowa wycena</div>
              <button style={S.closeBtn} onClick={() => setShowForm(false)}>✕</button>
            </div>

            <form onSubmit={handleSubmit} style={S.form}>
              {/* Klient i adres */}
              <div style={S.formSection}>
                <div style={S.sectionLabel}>📍 Lokalizacja</div>
                <div style={S.row2}>
                  <div style={S.fieldWrap}>
                    <label style={S.label}>Nazwa klienta</label>
                    <input style={S.input} value={form.klient_nazwa} onChange={setF('klient_nazwa')} placeholder="Jan Kowalski / Firma XYZ" />
                  </div>
                  <div style={S.fieldWrap}>
                    <label style={S.label}>Miasto</label>
                    <CityInput
                      style={S.input}
                      value={form.miasto}
                      onChange={setF('miasto')}
                      placeholder="Warszawa"
                      extraCities={oddzialy.map((o) => o.miasto)}
                    />
                  </div>
                </div>
                <div style={S.fieldWrap}>
                  <label style={S.label}>Adres *</label>
                  <input style={S.input} value={form.adres} onChange={setF('adres')} placeholder="ul. Leśna 5" required />
                </div>
              </div>

              {/* Usługa */}
              <div style={S.formSection}>
                <div style={S.sectionLabel}>🌳 Usługa</div>
                <div style={S.row2}>
                  <div style={S.fieldWrap}>
                    <label style={S.label}>Typ usługi</label>
                    <select style={S.input} value={form.typ_uslugi} onChange={setF('typ_uslugi')}>
                      <option value="">— wybierz —</option>
                      {USLUGI.map(u => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </div>
                  <div style={S.fieldWrap}>
                    <label style={S.label}>Szacunkowa wartość (PLN)</label>
                    <input style={S.input} type="number" step="0.01" min="0" value={form.wartosc_planowana} onChange={setF('wartosc_planowana')} placeholder="np. 2500" />
                  </div>
                </div>
                <div style={S.row2}>
                  <div style={S.fieldWrap}>
                    <label style={S.label}>Szac. czas (godz.)</label>
                    <input style={S.input} type="number" step="0.5" min="0" value={form.czas_planowany_godziny} onChange={setF('czas_planowany_godziny')} placeholder="8" />
                  </div>
                  <div style={S.fieldWrap}>
                    <label style={S.label}>Godzina na miejscu</label>
                    <input style={S.input} type="time" value={form.godzina_rozpoczecia} onChange={setF('godzina_rozpoczecia')} />
                  </div>
                </div>
              </div>

              {/* Data i ekipa */}
              <div style={S.formSection}>
                <div style={S.sectionLabel}>📅 Termin i ekipa</div>
                <div style={S.fieldWrap}>
                  <label style={S.label}>Data realizacji</label>
                  <input style={S.input} type="date" value={form.data_wykonania} onChange={setF('data_wykonania')} />
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                    Domyślnie: {String(selectedDay).padStart(2,'0')}.{String(month+1).padStart(2,'0')}.{year} (wybrany dzień)
                  </span>
                </div>

                <div style={S.fieldWrap}>
                  <label style={S.label}>Oddział</label>
                  <select style={S.input} value={form.oddzial_id} onChange={e => setForm(f => ({ ...f, oddzial_id: e.target.value, ekipa_id: '' }))}>
                    <option value="">— wszystkie —</option>
                    {oddzialy.map(o => <option key={o.id} value={o.id}>{o.nazwa}</option>)}
                  </select>
                </div>

                <div style={S.fieldWrap}>
                  <label style={{ ...S.label, color: 'var(--accent)' }}>👷 Ekipa * (obowiązkowe)</label>
                  <div style={S.ekipyGrid}>
                    {filtEkipy.length === 0 ? (
                      <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Brak ekip w tym oddziale</div>
                    ) : filtEkipy.map(e => (
                      <div key={e.id}
                        style={{ ...S.ekipaPill, ...(form.ekipa_id === e.id.toString() ? { borderColor: e.kolor || 'var(--accent)', backgroundColor: (e.kolor || 'var(--accent)') + '22', color: e.kolor || 'var(--accent)' } : {}) }}
                        onClick={() => setForm(f => ({ ...f, ekipa_id: e.id.toString() }))}>
                        <div style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: e.kolor || '#6B7280', flexShrink: 0 }} />
                        {e.nazwa}
                      </div>
                    ))}
                  </div>
                  {!form.ekipa_id && <div style={{ color: '#F59E0B', fontSize: 12, marginTop: 4 }}>⚠️ Wybór ekipy jest obowiązkowy</div>}
                </div>
              </div>

              {/* AI Analiza zdjęcia */}
              <div style={{ backgroundColor: 'rgba(52,211,153,0.05)', border: '1px solid rgba(52,211,153,0.2)', borderRadius: 12, padding: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#34D399', marginBottom: 10 }}>🤖 Analiza AI ze zdjęcia</div>
                <input ref={photoInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleAiPhoto} />
                <button
                  type="button"
                  style={{ ...S.submitBtn, backgroundColor: aiAnalyzing ? '#1E293B' : 'rgba(52,211,153,0.15)', color: '#34D399', border: '1px solid rgba(52,211,153,0.3)', width: '100%', fontSize: 13 }}
                  onClick={() => photoInputRef.current?.click()}
                  disabled={aiAnalyzing}
                >
                  {aiAnalyzing ? '⏳ Analizuję zdjęcie...' : '📷 Wgraj zdjęcie terenu → AI wyceni'}
                </button>
                {aiResult && (
                  <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-sub)' }}>
                    {aiResult.raw ? (
                      <div style={{ whiteSpace: 'pre-wrap', color: '#94A3B8' }}>{aiResult.raw}</div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <div>✅ <strong>Uzupełniono automatycznie:</strong></div>
                        {aiResult.typ_uslugi && <div>• Usługa: <strong>{aiResult.typ_uslugi}</strong></div>}
                        {aiResult.cena_min && <div>• Cena: <strong>{aiResult.cena_min}–{aiResult.cena_max} PLN</strong></div>}
                        {aiResult.czas_godziny && <div>• Czas: <strong>{aiResult.czas_godziny}h</strong></div>}
                        {aiResult.trudnosc && <div>• Trudność: <strong>{aiResult.trudnosc}</strong></div>}
                        {aiResult.zalecenia && <div>• Uwagi: {aiResult.zalecenia}</div>}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div style={{ ...S.formSection, border: '1px solid rgba(96,165,250,0.25)' }}>
                <div style={S.sectionLabel}>Zdjęcie z adnotacjami / wideo</div>
                <input ref={annotateInputRef} type="file" accept="image/*" style={{ display: 'none' }}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (f) setAnnotateFile(f);
                  }} />
                <input ref={videoInputRef} type="file" accept="video/*" multiple style={{ display: 'none' }}
                  onChange={(e) => {
                    const files = Array.from(e.target.files || []);
                    e.target.value = '';
                    setVideoFiles((prev) => [...prev, ...files].slice(0, 5));
                  }} />
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                  <button type="button" style={S.cancelBtn} onClick={() => annotateInputRef.current?.click()}>
                    Oznacz kolorem na zdjęciu
                  </button>
                  <button type="button" style={S.cancelBtn} onClick={() => videoInputRef.current?.click()}>
                    Dodaj plik wideo
                  </button>
                </div>
                {annotatedPayloads.length > 0 && (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
                    Zapisano {annotatedPayloads.length} adnotowane zdjęcie (do wysłania z wyceną).
                    <button type="button" style={{ marginLeft: 8, background: 'none', border: 'none', color: '#F87171', cursor: 'pointer' }} onClick={() => setAnnotatedPayloads([])}>Usuń</button>
                  </div>
                )}
                {videoFiles.length > 0 && (
                  <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 12, color: 'var(--text-sub)' }}>
                    {videoFiles.map((f, i) => (
                      <li key={`${f.name}-${i}`}>{f.name} ({Math.round(f.size / 1024)} KB)</li>
                    ))}
                  </ul>
                )}
                <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '8px 0 0' }}>
                  Nagrania wideo wymagają endpointu zapisu plików na backendzie — nazwy plików trafiają tymczasowo do uwag.
                </p>
              </div>

              {/* Uwagi */}
              <div style={S.fieldWrap}>
                <label style={S.label}>Uwagi do wyceny</label>
                <textarea style={{ ...S.input, minHeight: 80, resize: 'vertical' }} value={form.wycena_uwagi} onChange={setF('wycena_uwagi')} placeholder="Szczegóły, dostęp, trudności, materiały..." />
              </div>

              <StatusMessage message={msg} />

              <div style={S.formBtns}>
                <button type="button" style={S.cancelBtn} onClick={() => setShowForm(false)}>Anuluj</button>
                <button type="submit" style={S.submitBtn} disabled={saving || !isWycenaFormValid}>
                  {saving ? '⏳ Wysyłanie...' : '📋 Wyślij do zatwierdzenia'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {annotateFile && (
        <PhotoAnnotator
          file={annotateFile}
          onClose={() => setAnnotateFile(null)}
          onSave={(payload) => {
            setAnnotatedPayloads((p) => [...p, payload].slice(0, 2));
            setAnnotateFile(null);
          }}
        />
      )}
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
  bgOrbTop: { position: 'fixed', top: -140, right: -120, width: 360, height: 360, borderRadius: '50%', background: 'radial-gradient(circle, rgba(165,107,255,0.26) 0%, transparent 70%)', pointerEvents: 'none', zIndex: 0 },
  bgOrbBottom: { position: 'fixed', bottom: -150, left: -130, width: 380, height: 380, borderRadius: '50%', background: 'radial-gradient(circle, rgba(112,182,255,0.18) 0%, transparent 72%)', pointerEvents: 'none', zIndex: 0 },
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
    background: 'var(--bg-deep)',
    color: 'var(--text-sub)',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
  },
  viewBtnOn: { borderColor: 'var(--accent)', color: 'var(--accent)', background: 'var(--accent-surface)' },

  header: {
    display: 'flex', alignItems: 'center', gap: 16, padding: '20px 0',
    background: 'linear-gradient(135deg, var(--sidebar), var(--bg-deep))',
    borderBottom: '1px solid var(--border2)', boxShadow: 'var(--shadow-sm)', position: 'relative', zIndex: 1
  },
  backBtn: { background: 'none', border: 'none', color: 'var(--accent)', fontSize: 22, cursor: 'pointer', padding: '4px 8px' },
  headerTitle: { fontSize: 22, fontWeight: 'bold', color: '#fff' },
  headerSub: { fontSize: 13, color: 'var(--text-sub)', marginTop: 2 },
  addBtn: { marginLeft: 'auto', padding: '10px 20px', backgroundColor: 'var(--accent)', color: 'var(--on-accent)', border: '1px solid var(--border2)', borderRadius: 10, fontWeight: 'bold', fontSize: 14, cursor: 'pointer', boxShadow: 'var(--shadow-sm)' },

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
    background: 'linear-gradient(150deg, var(--bg-card) 0%, var(--bg-card2) 100%)',
    border: '1px solid var(--border2)',
    borderRadius: 14,
    padding: '10px 12px',
    boxShadow: 'var(--shadow-sm)',
  },
  kpiLabel: { fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em' },
  kpiValue: { marginTop: 5, fontSize: 22, fontWeight: 800, color: 'var(--text)' },

  body: { display: 'flex', gap: 20, padding: '20px 0', flexWrap: 'wrap', position: 'relative', zIndex: 1 },

  calBox: { flex: '0 0 380px', background: 'linear-gradient(150deg, var(--bg-card) 0%, var(--bg-card2) 100%)', borderRadius: 18, padding: 20, border: '1px solid var(--border2)', boxShadow: 'var(--shadow-sm)', alignSelf: 'flex-start', position: 'sticky', top: 16 },
  monthNav: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  navBtn: { width: 36, height: 36, borderRadius: '50%', backgroundColor: 'var(--bg-deep)', border: '1px solid var(--border2)', color: 'var(--accent)', fontSize: 20, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  monthTitle: { fontSize: 17, fontWeight: 'bold', color: 'var(--accent)' },
  calGrid: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 },
  dayHead: { textAlign: 'center', fontSize: 11, fontWeight: '600', color: 'var(--text-muted)', padding: '6px 0' },
  dayCell: { aspectRatio: '1', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', borderRadius: 10, cursor: 'pointer', padding: 2, transition: 'background 0.15s, transform 0.15s', border: '1px solid transparent' },
  todayCell: { border: '2px solid var(--accent)' },
  selCell: { backgroundColor: 'var(--accent)', color: 'var(--on-accent)' },
  emptyCell: { aspectRatio: '1' },
  dayNum: { fontSize: 13, color: 'var(--text-sub)' },
  dotRow: { display: 'flex', gap: 2, marginTop: 2 },
  dot: { width: 5, height: 5, borderRadius: '50%' },

  legenda: { display: 'flex', gap: 12, marginTop: 14, flexWrap: 'wrap' },
  legendaItem: { display: 'flex', alignItems: 'center', gap: 6 },

  dayPanel: { flex: 1, minWidth: 300, background: 'linear-gradient(150deg, rgba(255,255,255,0.02) 0%, transparent 100%)', border: '1px solid var(--border2)', borderRadius: 18, padding: 16, boxShadow: 'var(--shadow-sm)' },
  dayPanelHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  dayPanelTitle: { fontSize: 18, fontWeight: 'bold', color: 'var(--text)' },
  dayPanelCount: { fontSize: 13, color: 'var(--text-muted)', backgroundColor: 'var(--bg-card2)', padding: '3px 10px', borderRadius: 20, border: '1px solid var(--border2)' },

  empty: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 60, background: 'linear-gradient(150deg, var(--bg-card) 0%, var(--bg-card2) 100%)', borderRadius: 18, border: '1px solid var(--border2)', boxShadow: 'var(--shadow-sm)' },
  addBtnSm: { marginTop: 16, padding: '10px 20px', backgroundColor: 'var(--accent)', color: 'var(--on-accent)', border: '1px solid var(--border2)', borderRadius: 10, fontWeight: 'bold', cursor: 'pointer' },

  wycenaCard: { background: 'linear-gradient(150deg, var(--bg-card) 0%, var(--bg-card2) 100%)', borderRadius: 16, padding: 16, marginBottom: 12, border: '1px solid var(--border2)', boxShadow: 'var(--shadow-sm)', cursor: 'pointer', transition: 'all 0.2s', position: 'relative', overflow: 'hidden' },
  wycenaTop: { display: 'flex', gap: 12, justifyContent: 'space-between' },
  wycenaKlient: { fontSize: 15, fontWeight: '600', color: 'var(--text)', marginBottom: 4 },
  wycenaSub: { fontSize: 12, color: 'var(--text-sub)', marginTop: 2 },
  badge: { fontSize: 11, fontWeight: '600', padding: '3px 10px', borderRadius: 20 },
  kwota: { fontSize: 14, fontWeight: 'bold', color: 'var(--accent)' },
  wycenaDetail: { marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' },
  detailRow: { display: 'flex', gap: 8, marginBottom: 6, fontSize: 13 },
  detailLabel: { color: 'var(--text-muted)', minWidth: 100 },
  detailVal: { color: 'var(--text)', flex: 1 },
  openBtn: { marginTop: 8, padding: '8px 16px', backgroundColor: 'var(--accent)', color: 'var(--on-accent)', border: '1px solid var(--border2)', borderRadius: 8, fontWeight: 'bold', cursor: 'pointer', fontSize: 13 },

  // Modal
  overlay: { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 },
  modal: { background: 'linear-gradient(150deg, var(--bg-card) 0%, var(--bg-card2) 100%)', borderRadius: 20, width: '100%', maxWidth: 640, maxHeight: '90vh', overflowY: 'auto', padding: 28, border: '1px solid var(--border2)', boxShadow: 'var(--shadow-lg)' },
  modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  modalTitle: { fontSize: 20, fontWeight: 'bold', color: 'var(--text)' },
  closeBtn: { background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 20, cursor: 'pointer', padding: 4 },

  form: { display: 'flex', flexDirection: 'column', gap: 16 },
  formSection: { backgroundColor: 'var(--bg-deep)', borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 12, border: '1px solid var(--border)' },
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
  cancelBtn: { padding: '10px 20px', backgroundColor: 'var(--bg-deep)', border: '1px solid var(--border2)', borderRadius: 10, color: 'var(--text-sub)', cursor: 'pointer', fontSize: 14 },
  submitBtn: { padding: '10px 24px', backgroundColor: 'var(--accent)', color: 'var(--on-accent)', border: '1px solid var(--border2)', borderRadius: 10, fontWeight: 'bold', fontSize: 14, cursor: 'pointer', boxShadow: 'var(--shadow-sm)' },
};
