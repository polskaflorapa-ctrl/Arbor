import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import StatusMessage from '../components/StatusMessage';
import CityInput from '../components/CityInput';
import PhotoAnnotator from '../components/PhotoAnnotator';
import { getApiErrorMessage } from '../utils/apiError';
import { getLocalStorageJson } from '../utils/safeJsonLocalStorage';
import { getStoredToken, authHeaders } from '../utils/storedToken';
import { errorMessage, successMessage, warningMessage } from '../utils/statusMessage';

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
  zatwierdzono: '#34D399',
  odrzucono: '#EF4444',
};
const STATUS_LABEL = {
  oczekuje: '⏳ Oczekuje',
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

export default function WycenaKalendarz() {
  const navigate = useNavigate();
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

  const load = useCallback(async () => {
    try {
      const token = getStoredToken();
      if (!token) { navigate('/'); return; }
      const u = getLocalStorageJson('user', {});
      setUser(u);
      const h = authHeaders(token);
      const [wRes, eRes, oRes, ogRes] = await Promise.all([
        api.get('/wyceny', { headers: h }),
        api.get('/ekipy', { headers: h }),
        api.get('/oddzialy', { headers: h }),
        api.get('/ogledziny', { headers: h }).catch(() => ({ data: [] })),
      ]);
      setWyceny(Array.isArray(wRes.data) ? wRes.data : (wRes.data.wyceny || []));
      setEkipy(eRes.data.ekipy || eRes.data || []);
      setOddzialy(oRes.data.oddzialy || oRes.data || []);
      const og = Array.isArray(ogRes.data) ? ogRes.data : (ogRes.data?.ogledziny || []);
      setOgledziny(og);
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
    <div style={S.root}>
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
                  onClick={() => navigate('/ogledziny')}
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
                    {w.status_akceptacji === 'zatwierdzono' && (
                      <button style={S.openBtn} onClick={(e) => { e.stopPropagation(); navigate(`/zlecenia/${w.id}`); }}>
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
    </div>
  );
}

const S = {
  root: { minHeight: '100vh', backgroundColor: 'var(--bg)', color: 'var(--text)' },
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
  viewBtnOn: {
    borderColor: 'var(--accent)',
    color: 'var(--accent)',
    background: 'rgba(52, 211, 153, 0.12)',
  },

  header: { display: 'flex', alignItems: 'center', gap: 16, padding: '20px 24px', background: 'linear-gradient(135deg, var(--sidebar), #1B4332)', borderBottom: '1px solid var(--border)' },
  backBtn: { background: 'none', border: 'none', color: 'var(--accent)', fontSize: 22, cursor: 'pointer', padding: '4px 8px' },
  headerTitle: { fontSize: 22, fontWeight: 'bold', color: '#fff' },
  headerSub: { fontSize: 13, color: 'var(--text-sub)', marginTop: 2 },
  addBtn: { marginLeft: 'auto', padding: '10px 20px', backgroundColor: 'var(--accent)', color: '#052E16', border: 'none', borderRadius: 10, fontWeight: 'bold', fontSize: 14, cursor: 'pointer' },

  msg: { margin: '12px 24px' },

  body: { display: 'flex', gap: 20, padding: 20, flexWrap: 'wrap' },

  calBox: { flex: '0 0 360px', backgroundColor: 'var(--bg-card)', borderRadius: 16, padding: 20, border: '1px solid var(--border)', alignSelf: 'flex-start' },
  monthNav: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  navBtn: { width: 36, height: 36, borderRadius: '50%', backgroundColor: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--accent)', fontSize: 20, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  monthTitle: { fontSize: 17, fontWeight: 'bold', color: 'var(--accent)' },
  calGrid: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 },
  dayHead: { textAlign: 'center', fontSize: 11, fontWeight: '600', color: 'var(--text-muted)', padding: '6px 0' },
  dayCell: { aspectRatio: '1', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', borderRadius: 8, cursor: 'pointer', padding: 2, transition: 'background 0.15s' },
  todayCell: { border: '2px solid var(--accent)' },
  selCell: { backgroundColor: 'var(--accent)', color: '#052E16' },
  emptyCell: { aspectRatio: '1' },
  dayNum: { fontSize: 13, color: 'var(--text-sub)' },
  dotRow: { display: 'flex', gap: 2, marginTop: 2 },
  dot: { width: 5, height: 5, borderRadius: '50%' },

  legenda: { display: 'flex', gap: 12, marginTop: 14, flexWrap: 'wrap' },
  legendaItem: { display: 'flex', alignItems: 'center', gap: 6 },

  dayPanel: { flex: 1, minWidth: 300 },
  dayPanelHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  dayPanelTitle: { fontSize: 18, fontWeight: 'bold', color: 'var(--text)' },
  dayPanelCount: { fontSize: 13, color: 'var(--text-muted)', backgroundColor: 'var(--bg-card)', padding: '3px 10px', borderRadius: 20 },

  empty: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 60, backgroundColor: 'var(--bg-card)', borderRadius: 16, border: '1px solid var(--border)' },
  addBtnSm: { marginTop: 16, padding: '10px 20px', backgroundColor: 'var(--accent)', color: '#052E16', border: 'none', borderRadius: 10, fontWeight: 'bold', cursor: 'pointer' },

  wycenaCard: { backgroundColor: 'var(--bg-card)', borderRadius: 14, padding: 16, marginBottom: 12, border: '1px solid var(--border)', cursor: 'pointer', transition: 'all 0.2s' },
  wycenaTop: { display: 'flex', gap: 12, justifyContent: 'space-between' },
  wycenaKlient: { fontSize: 15, fontWeight: '600', color: 'var(--text)', marginBottom: 4 },
  wycenaSub: { fontSize: 12, color: 'var(--text-sub)', marginTop: 2 },
  badge: { fontSize: 11, fontWeight: '600', padding: '3px 10px', borderRadius: 20 },
  kwota: { fontSize: 14, fontWeight: 'bold', color: 'var(--accent)' },
  wycenaDetail: { marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' },
  detailRow: { display: 'flex', gap: 8, marginBottom: 6, fontSize: 13 },
  detailLabel: { color: 'var(--text-muted)', minWidth: 100 },
  detailVal: { color: 'var(--text)', flex: 1 },
  openBtn: { marginTop: 8, padding: '8px 16px', backgroundColor: 'var(--accent)', color: '#052E16', border: 'none', borderRadius: 8, fontWeight: 'bold', cursor: 'pointer', fontSize: 13 },

  // Modal
  overlay: { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 },
  modal: { backgroundColor: 'var(--bg-card)', borderRadius: 20, width: '100%', maxWidth: 640, maxHeight: '90vh', overflowY: 'auto', padding: 28, border: '1px solid var(--border)' },
  modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  modalTitle: { fontSize: 20, fontWeight: 'bold', color: 'var(--text)' },
  closeBtn: { background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 20, cursor: 'pointer', padding: 4 },

  form: { display: 'flex', flexDirection: 'column', gap: 16 },
  formSection: { backgroundColor: 'var(--bg-deep)', borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 },
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
  cancelBtn: { padding: '10px 20px', backgroundColor: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text-sub)', cursor: 'pointer', fontSize: 14 },
  submitBtn: { padding: '10px 24px', backgroundColor: 'var(--accent)', color: '#052E16', border: 'none', borderRadius: 10, fontWeight: 'bold', fontSize: 14, cursor: 'pointer' },
};
