/**
 * Rozliczenia — field-entry (parity: mobile/app/rozliczenia.tsx)
 * Dostępne dla: Brygadzista (własne ekipy), Kierownik/Dyrektor/Admin (wszystkie).
 *
 * Trzy zakładki:
 *   1. Godziny   — hours per team member per task
 *   2. Kalkulator — brutto/VAT → netto → wynagrodzenie brygadzisty
 *   3. Mój dzień  — day summary for logged-in user
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../api';
import Sidebar from '../components/Sidebar';
import ModernDataRow from '../components/ModernDataRow';
import { readStoredUser } from '../utils/readStoredUser';
import { getStoredToken, authHeaders } from '../utils/storedToken';

const TABS = [
  { key: 'godziny',     label: '⏱ Godziny' },
  { key: 'kalkulator',  label: '🧮 Kalkulator' },
  { key: 'dzien',       label: '📊 Mój dzień' },
];

const VALID_TABS = new Set(TABS.map((tab) => tab.key));

const STATUS_COLOR = {
  Potwierdzone: '#4ade80',
  Odrzucone:    '#f87171',
  Oczekuje:     '#fbbf24',
};

const OPERATIONAL_COST_CATEGORIES = [
  { key: 'sprzet', label: 'Sprzet' },
  { key: 'paliwo', label: 'Paliwo' },
  { key: 'utylizacja', label: 'Utylizacja' },
  { key: 'inne', label: 'Inne koszty' },
];

function fmt(n, locale = 'pl-PL') {
  return parseFloat(n || 0).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

export default function RozliczeniaFieldEntry() {
  const navigate    = useNavigate();
  const [params]    = useSearchParams();
  const taskIdParam = params.get('task_id') || '';
  const tabParam    = params.get('tab') || '';

  const [user, setUser]         = useState(null);
  const [tab, setTab]           = useState(VALID_TABS.has(tabParam) ? tabParam : 'godziny');
  const [msg, setMsg]           = useState(null); // {type:'ok'|'err', text}
  const [saving, setSaving]     = useState(false);

  // Godziny zakładka
  const [taskId, setTaskId]     = useState(taskIdParam);
  const [taskData, setTaskData] = useState(null);  // {task, pomocnicy, rozliczenie}
  const [formGodziny, setFormGodziny] = useState([]);
  const [loadingTask, setLoadingTask] = useState(false);

  // Kalkulator zakładka
  const [brutto, setBrutto]     = useState('');
  const [vatStawka, setVatStawka] = useState('8');
  const [wynKalkulatora, setWynKalkulatora] = useState(null);
  const [operationalCost, setOperationalCost] = useState({ category: 'paliwo', amount: '', note: '' });
  const [materialCost, setMaterialCost] = useState({ nazwa: '', ilosc: '', jednostka: 'szt', koszt_laczny: '', notatka: '' });

  // Dzień zakładka
  const [dayData, setDayData]   = useState(null);
  const [dayDate, setDayDate]   = useState(today());
  const [overview, setOverview] = useState(null);

  useEffect(() => {
    const u = readStoredUser();
    setUser(u);
  }, []);

  const showMsg = useCallback((type, text) => {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 3500);
  }, []);

  // ─── Ładowanie danych zadania ───────────────────────────────────────────────
  const loadTask = useCallback(async (id) => {
    if (!id) { setTaskData(null); setFormGodziny([]); return; }
    setLoadingTask(true);
    try {
      const token = getStoredToken();
      const res = await api.get(`/rozliczenia/zadanie/${id}`, { headers: authHeaders(token) });
      const data = res.data;
      setTaskData(data);

      // Zainicjuj form godzin na podstawie ekipy
      if (data.task?.ekipa_id) {
        try {
          const ekipaRes = await api.get(`/ekipy/${data.task.ekipa_id}`, { headers: authHeaders(token) });
          const czlonkowie = ekipaRes.data?.czlonkowie || [];
          setFormGodziny(czlonkowie.map((c) => {
            const existing = data.pomocnicy.find((p) => p.pomocnik_id === c.user_id);
            return {
              pomocnik_id:      c.user_id,
              imie:             c.imie,
              nazwisko:         c.nazwisko,
              stawka_godzinowa: existing?.stawka_godzinowa?.toString() || c.stawka_godzinowa?.toString() || '0',
              godziny:          existing?.godziny?.toString() || '',
              status:           existing?.status || 'Oczekuje',
              id:               existing?.id,
            };
          }));
        } catch {
          setFormGodziny([]);
        }
      }

      if (data.rozliczenie) {
        setBrutto(data.rozliczenie.wartosc_brutto?.toString() || '');
        setVatStawka(data.rozliczenie.vat_stawka?.toString() || '8');
      }
    } catch {
      showMsg('err', 'Nie udało się wczytać danych zadania');
      setTaskData(null);
      setFormGodziny([]);
    } finally {
      setLoadingTask(false);
    }
  }, [showMsg]);

  useEffect(() => {
    if (taskIdParam) loadTask(taskIdParam);
  }, [taskIdParam, loadTask]);

  // ─── Ładowanie dnia ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (VALID_TABS.has(tabParam)) setTab(tabParam);
  }, [tabParam]);

  const loadDay = useCallback(async () => {
    if (!user?.id) return;
    try {
      const token = getStoredToken();
      const [dayRes, ovRes] = await Promise.all([
        api.get(`/rozliczenia/dzien/${user.id}?data=${dayDate}`, { headers: authHeaders(token) }).catch(() => null),
        api.get('/mobile/me/settlements-overview', { headers: authHeaders(token) }).catch(() => null),
      ]);
      setDayData(dayRes?.data || null);
      setOverview(ovRes?.data || null);
    } catch {
      setDayData(null);
    }
  }, [user?.id, dayDate]);

  useEffect(() => {
    if (tab === 'dzien') loadDay();
  }, [tab, loadDay]);

  // ─── Zapis godzin ───────────────────────────────────────────────────────────
  const zapiszGodziny = async () => {
    if (!taskId) { showMsg('err', 'Wpisz ID zadania'); return; }
    setSaving(true);
    try {
      const token = getStoredToken();
      const dataPracy = today();
      let saved = 0;
      for (const p of formGodziny) {
        if (!p.godziny || parseFloat(p.godziny) <= 0) continue;
        await api.post(
          `/rozliczenia/zadanie/${taskId}/godziny`,
          {
            pomocnik_id:      p.pomocnik_id,
            godziny:          parseFloat(p.godziny),
            stawka_godzinowa: parseFloat(p.stawka_godzinowa),
            data_pracy:       dataPracy,
          },
          { headers: authHeaders(token) },
        );
        saved++;
      }
      showMsg('ok', `Zapisano godziny dla ${saved} pracownik${saved === 1 ? 'a' : 'ów'}`);
      loadTask(taskId);
    } catch {
      showMsg('err', 'Błąd zapisu — sprawdź połączenie z serwerem');
    } finally {
      setSaving(false);
    }
  };

  // ─── Zatwierdzenie godzin ───────────────────────────────────────────────────
  const zatwierdz = async (godzinyId, status) => {
    try {
      const token = getStoredToken();
      await api.put(
        `/rozliczenia/godziny/${godzinyId}/zatwierdz`,
        { status },
        { headers: authHeaders(token) },
      );
      showMsg('ok', status === 'Potwierdzone' ? 'Godziny zatwierdzone' : 'Godziny odrzucone');
      loadTask(taskId);
    } catch {
      showMsg('err', 'Nie udało się zaktualizować statusu');
    }
  };

  // ─── Kalkulator brutto/VAT ──────────────────────────────────────────────────
  const obliczRozliczenie = async () => {
    if (!taskId || !brutto) { showMsg('err', 'Podaj ID zadania i wartość brutto'); return; }
    setSaving(true);
    try {
      const token = getStoredToken();
      const res = await api.post(
        `/rozliczenia/zadanie/${taskId}`,
        { wartosc_brutto: parseFloat(brutto), vat_stawka: parseFloat(vatStawka) },
        { headers: authHeaders(token) },
      );
      setWynKalkulatora(res.data);
      showMsg('ok', 'Rozliczenie zapisane');
      loadTask(taskId);
    } catch {
      showMsg('err', 'Błąd zapisu rozliczenia');
    } finally {
      setSaving(false);
    }
  };

  const zapiszKosztOperacyjny = async () => {
    if (!taskId) { showMsg('err', 'Wpisz ID zadania'); return; }
    if (!operationalCost.amount || parseFloat(operationalCost.amount) <= 0) {
      showMsg('err', 'Podaj kwote kosztu operacyjnego');
      return;
    }
    setSaving(true);
    try {
      const token = getStoredToken();
      const categoryMeta = OPERATIONAL_COST_CATEGORIES.find((item) => item.key === operationalCost.category);
      await api.post(
        `/rozliczenia/zadanie/${taskId}/koszty-operacyjne`,
        {
          category: operationalCost.category,
          label: categoryMeta?.label || 'Koszt operacyjny',
          amount: parseFloat(operationalCost.amount),
          note: operationalCost.note,
        },
        { headers: authHeaders(token) },
      );
      showMsg('ok', 'Koszt operacyjny zapisany');
      setOperationalCost((current) => ({ ...current, amount: '', note: '' }));
      loadTask(taskId);
    } catch {
      showMsg('err', 'Blad zapisu kosztu operacyjnego');
    } finally {
      setSaving(false);
    }
  };

  const zapiszMaterial = async () => {
    if (!taskId) { showMsg('err', 'Wpisz ID zadania'); return; }
    if (!materialCost.nazwa.trim()) {
      showMsg('err', 'Podaj nazwe materialu');
      return;
    }
    if (!materialCost.koszt_laczny || parseFloat(materialCost.koszt_laczny) <= 0) {
      showMsg('err', 'Podaj koszt materialu');
      return;
    }
    setSaving(true);
    try {
      const token = getStoredToken();
      await api.post(
        `/rozliczenia/zadanie/${taskId}/materialy`,
        {
          nazwa: materialCost.nazwa,
          ilosc: materialCost.ilosc ? parseFloat(materialCost.ilosc) : null,
          jednostka: materialCost.jednostka,
          koszt_laczny: parseFloat(materialCost.koszt_laczny),
          notatka: materialCost.notatka,
        },
        { headers: authHeaders(token) },
      );
      showMsg('ok', 'Material zapisany');
      setMaterialCost((current) => ({ ...current, nazwa: '', ilosc: '', koszt_laczny: '', notatka: '' }));
      loadTask(taskId);
    } catch {
      showMsg('err', 'Blad zapisu materialu');
    } finally {
      setSaving(false);
    }
  };

  const wynik = wynKalkulatora || taskData?.rozliczenie || null;

  const sumaKosztow = useMemo(
    () => (taskData?.pomocnicy || []).reduce((s, p) => s + parseFloat(p.koszt || 0), 0),
    [taskData?.pomocnicy],
  );

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="field-settlements-shell" style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg)' }}>
      <Sidebar />
      <main className="field-settlements-main" style={{ flex: 1, padding: '28px 28px 48px', minWidth: 0, maxWidth: 860 }}>

        {/* Nagłówek */}
        <div className="field-settlements-header" style={{ marginBottom: 20 }}>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 900, color: 'var(--text)' }}>
            Rozliczenia ekip
          </h1>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
            Godziny pomocników, kalkulator brutto/VAT, podsumowanie dnia
          </p>
        </div>

        {msg && (
          <div style={{
            padding: '10px 14px', borderRadius: 8, marginBottom: 14,
            background: msg.type === 'ok' ? 'rgba(74,222,128,0.12)' : 'rgba(248,113,113,0.12)',
            border: `1px solid ${msg.type === 'ok' ? '#4ade8044' : '#f8717144'}`,
            color: msg.type === 'ok' ? '#4ade80' : '#f87171',
            fontSize: 13, fontWeight: 600,
          }}>
            {msg.text}
          </div>
        )}

        {/* ID zadania */}
        <div className="field-settlements-taskbar" style={{ marginBottom: 18, display: 'flex', alignItems: 'center', gap: 10 }}>
          <label style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>
            ID zadania:
          </label>
          <input
            type="number"
            value={taskId}
            onChange={(e) => setTaskId(e.target.value)}
            placeholder="np. 123"
            style={{
              width: 120, padding: '8px 12px', borderRadius: 8,
              border: '1px solid var(--border)', background: 'var(--surface-glass)',
              color: 'var(--text)', fontSize: 14, outline: 'none',
            }}
          />
          <button
            type="button"
            onClick={() => loadTask(taskId)}
            disabled={!taskId || loadingTask}
            style={{
              padding: '8px 16px', borderRadius: 8, border: 'none',
              background: 'var(--accent)', color: '#fff', fontWeight: 700,
              fontSize: 13, cursor: 'pointer', opacity: loadingTask ? 0.6 : 1,
            }}
          >
            {loadingTask ? '…' : 'Wczytaj'}
          </button>
          {taskData?.task && (
            <span style={{ fontSize: 13, color: 'var(--accent)', fontWeight: 600 }}>
              {taskData.task.klient_nazwa} — {taskData.task.adres}, {taskData.task.miasto}
            </span>
          )}
        </div>

        {/* Zakładki */}
        <div className="field-settlements-tabs" style={{ display: 'flex', gap: 4, marginBottom: 18, borderBottom: '1px solid var(--border)' }}>
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              style={{
                padding: '8px 18px', border: 'none', background: 'none',
                color: tab === t.key ? 'var(--accent)' : 'var(--text-muted)',
                fontWeight: tab === t.key ? 700 : 500, fontSize: 13,
                borderBottom: `2px solid ${tab === t.key ? 'var(--accent)' : 'transparent'}`,
                cursor: 'pointer', transition: 'all 0.15s',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* ═══ GODZINY ════════════════════════════════════════════════════════ */}
        {tab === 'godziny' && (
          <div className="field-settlements-panel field-settlements-hours">
            {!taskData && !loadingTask && (
              <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--text-muted)' }}>
                <div style={{ fontSize: 36, marginBottom: 10 }}>⏱</div>
                <p style={{ margin: 0 }}>Podaj ID zadania i kliknij Wczytaj</p>
              </div>
            )}

            {taskData && formGodziny.length === 0 && (
              <div style={{ color: 'var(--text-muted)', fontSize: 14, padding: '24px 0' }}>
                Brak członków ekipy — przypisz ekipę do zadania.
              </div>
            )}

            {formGodziny.map((p, idx) => (
              <div className="field-settlements-worker-card" key={p.pomocnik_id} style={{
                background: 'var(--surface-glass)', border: '1px solid var(--border)',
                borderLeft: '3px solid var(--accent)',
                borderRadius: 10, padding: 16, marginBottom: 12,
              }}>
                {/* Nagłówek pracownika */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <div style={{
                    width: 38, height: 38, borderRadius: '50%',
                    background: 'var(--accent-surface)', display: 'flex',
                    alignItems: 'center', justifyContent: 'center',
                    fontSize: 13, fontWeight: 700, color: 'var(--accent)',
                    flexShrink: 0,
                  }}>
                    {p.imie?.[0]}{p.nazwisko?.[0]}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
                      {p.imie} {p.nazwisko}
                    </div>
                    {p.status !== 'Oczekuje' || p.id ? (
                      <div style={{
                        fontSize: 12, fontWeight: 600, marginTop: 2,
                        color: STATUS_COLOR[p.status] || '#888',
                      }}>
                        {p.status === 'Potwierdzone' ? '✅' : p.status === 'Odrzucone' ? '❌' : '⏳'} {p.status}
                      </div>
                    ) : null}
                  </div>
                </div>

                {/* Pola input */}
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ flex: '1 1 120px' }}>
                    <label style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: 4 }}>
                      Godziny
                    </label>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      max="24"
                      value={p.godziny}
                      onChange={(e) => {
                        const n = [...formGodziny];
                        n[idx] = { ...n[idx], godziny: e.target.value };
                        setFormGodziny(n);
                      }}
                      placeholder="np. 6.5"
                      style={inputStyle}
                    />
                  </div>
                  <div style={{ flex: '1 1 120px' }}>
                    <label style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: 4 }}>
                      Stawka (PLN/h)
                    </label>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      value={p.stawka_godzinowa}
                      onChange={(e) => {
                        const n = [...formGodziny];
                        n[idx] = { ...n[idx], stawka_godzinowa: e.target.value };
                        setFormGodziny(n);
                      }}
                      placeholder="np. 25"
                      style={inputStyle}
                    />
                  </div>
                  {p.godziny && p.stawka_godzinowa && (
                    <div style={{
                      flex: '1 1 120px', background: 'rgba(74,222,128,0.08)',
                      border: '1px solid rgba(74,222,128,0.25)',
                      borderRadius: 8, padding: '6px 12px',
                      display: 'flex', flexDirection: 'column', justifyContent: 'center',
                    }}>
                      <div style={{ fontSize: 11, color: '#4ade80', fontWeight: 600 }}>Koszt</div>
                      <div style={{ fontSize: 16, fontWeight: 800, color: '#4ade80' }}>
                        {fmt(parseFloat(p.godziny) * parseFloat(p.stawka_godzinowa))} PLN
                      </div>
                    </div>
                  )}
                </div>

                {/* Zatwierdź / Odrzuć — dla brygadzisty */}
                {p.id && ['Brygadzista', 'Kierownik', 'Administrator', 'Dyrektor'].includes(user?.rola) && p.status === 'Oczekuje' && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                    <button
                      type="button"
                      onClick={() => zatwierdz(p.id, 'Odrzucone')}
                      style={{ ...actionBtn, background: 'rgba(248,113,113,0.1)', color: '#f87171', border: '1px solid rgba(248,113,113,0.3)' }}
                    >
                      Odrzuć
                    </button>
                    <button
                      type="button"
                      onClick={() => zatwierdz(p.id, 'Potwierdzone')}
                      style={{ ...actionBtn, background: 'rgba(74,222,128,0.1)', color: '#4ade80', border: '1px solid rgba(74,222,128,0.3)' }}
                    >
                      Zatwierdź
                    </button>
                  </div>
                )}
              </div>
            ))}

            {formGodziny.length > 0 && (
              <button
                type="button"
                onClick={zapiszGodziny}
                disabled={saving}
                style={primaryBtn}
              >
                {saving ? '…' : 'Zapisz godziny'}
              </button>
            )}

            {/* Zapisane godziny z bazy */}
            {taskData?.pomocnicy?.length > 0 && (
              <div style={{ marginTop: 24 }}>
                <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
                  📋 Zapisane godziny
                </h3>
                <div className="modern-data-stack">
                  {taskData.pomocnicy.map((p) => (
                    <ModernDataRow
                      key={p.id}
                      idLabel="Worker Cost"
                      idValue={`HELP-${p.id}`}
                      title={`${p.imie} ${p.nazwisko}`}
                      subtitle={`Status: ${p.status || 'brak'}`}
                      tone={p.status === 'Potwierdzone' ? 'success' : p.status === 'Odrzucone' ? 'danger' : 'warning'}
                      status={p.status || 'Oczekuje'}
                      statusValue={p.status}
                      statusState={p.status === 'Potwierdzone' ? 'success' : p.status === 'Odrzucone' ? 'danger' : 'warning'}
                      metrics={[
                        { label: 'Godziny', value: `${p.godziny} h`, tone: 'info' },
                        { label: 'Stawka', value: `${p.stawka_godzinowa} PLN/h` },
                        { label: 'Koszt', value: `${fmt(p.koszt)} PLN`, tone: 'warning' },
                      ]}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═══ KALKULATOR ══════════════════════════════════════════════════════ */}
        {tab === 'kalkulator' && (
          <div className="field-settlements-panel field-settlements-calculator">
            {taskData?.task && (
              <div style={{ background: 'var(--accent-surface)', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13 }}>
                <strong>{taskData.task.klient_nazwa}</strong>
                {' · '}
                <span style={{ color: 'var(--text-muted)' }}>Ekipa: {taskData.task.ekipa_nazwa || '—'}</span>
              </div>
            )}

            {/* Wartość brutto */}
            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>Wartość brutto (PLN)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={brutto}
                onChange={(e) => setBrutto(e.target.value)}
                placeholder="np. 1200.00"
                style={{ ...inputStyle, maxWidth: 240 }}
              />
            </div>

            {/* Stawka VAT */}
            <div style={{ marginBottom: 18 }}>
              <label style={labelStyle}>VAT</label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {['0', '5', '8', '23'].map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setVatStawka(v)}
                    style={{
                      padding: '8px 20px', borderRadius: 8, fontWeight: 700, fontSize: 14,
                      border: `1px solid ${vatStawka === v ? 'var(--accent)' : 'var(--border)'}`,
                      background: vatStawka === v ? 'var(--accent-surface)' : 'var(--surface-glass)',
                      color: vatStawka === v ? 'var(--accent)' : 'var(--text-muted)',
                      cursor: 'pointer',
                    }}
                  >
                    {v}%
                  </button>
                ))}
              </div>
            </div>

            {/* Podgląd pomocników */}
            {taskData?.pomocnicy?.length > 0 && (
              <div style={{ background: 'var(--surface-glass)', border: '1px solid var(--border)', borderRadius: 10, padding: 14, marginBottom: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 10 }}>Koszty pomocników</div>
                {taskData.pomocnicy.map((p) => (
                  <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, paddingBottom: 6, marginBottom: 6, borderBottom: '1px solid var(--border)' }}>
                    <span>{p.imie} {p.nazwisko}</span>
                    <span style={{ color: 'var(--text-muted)' }}>{p.godziny} h × {p.stawka_godzinowa}</span>
                    <span style={{ fontWeight: 700, color: '#f87171' }}>{fmt(p.koszt)} PLN</span>
                  </div>
                ))}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: 14, marginTop: 4 }}>
                  <span>Razem koszty</span>
                  <span style={{ color: '#f87171' }}>{fmt(sumaKosztow)} PLN</span>
                </div>
              </div>
            )}

            <div style={{ background: 'var(--surface-glass)', border: '1px solid var(--border)', borderRadius: 10, padding: 14, marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)', marginBottom: 10 }}>Koszty do marzy</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(140px, 1fr) minmax(120px, 160px)', gap: 10, marginBottom: 10 }}>
                <div>
                  <label style={labelStyle}>Kategoria</label>
                  <select
                    value={operationalCost.category}
                    onChange={(e) => setOperationalCost((current) => ({ ...current, category: e.target.value }))}
                    style={inputStyle}
                  >
                    {OPERATIONAL_COST_CATEGORIES.map((category) => (
                      <option key={category.key} value={category.key}>{category.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Kwota PLN</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={operationalCost.amount}
                    onChange={(e) => setOperationalCost((current) => ({ ...current, amount: e.target.value }))}
                    placeholder="0.00"
                    style={inputStyle}
                  />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'end' }}>
                <div>
                  <label style={labelStyle}>Notatka</label>
                  <input
                    type="text"
                    value={operationalCost.note}
                    onChange={(e) => setOperationalCost((current) => ({ ...current, note: e.target.value }))}
                    placeholder="np. paragon, paliwo do zlecenia"
                    style={inputStyle}
                  />
                </div>
                <button
                  type="button"
                  onClick={zapiszKosztOperacyjny}
                  disabled={saving || !taskId || !operationalCost.amount}
                  style={{ ...primaryBtn, padding: '8px 14px' }}
                >
                  Dodaj koszt
                </button>
              </div>
              {taskData?.koszty_operacyjne?.length > 0 && (
                <div style={{ marginTop: 12, display: 'grid', gap: 6 }}>
                  {taskData.koszty_operacyjne.map((cost) => (
                    <div key={cost.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12, color: 'var(--text)' }}>
                      <span>{cost.label || cost.category}{cost.note ? ` - ${cost.note}` : ''}</span>
                      <strong>{fmt(cost.amount)} PLN</strong>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ background: 'var(--surface-glass)', border: '1px solid var(--border)', borderRadius: 10, padding: 14, marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)', marginBottom: 10 }}>Materialy do marzy</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(160px, 1fr) minmax(80px, 110px) minmax(80px, 110px) minmax(120px, 150px)', gap: 10, marginBottom: 10 }}>
                <div>
                  <label style={labelStyle}>Nazwa</label>
                  <input
                    type="text"
                    value={materialCost.nazwa}
                    onChange={(e) => setMaterialCost((current) => ({ ...current, nazwa: e.target.value }))}
                    placeholder="np. kora"
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Ilosc</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={materialCost.ilosc}
                    onChange={(e) => setMaterialCost((current) => ({ ...current, ilosc: e.target.value }))}
                    placeholder="1"
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Jednostka</label>
                  <input
                    type="text"
                    value={materialCost.jednostka}
                    onChange={(e) => setMaterialCost((current) => ({ ...current, jednostka: e.target.value }))}
                    placeholder="szt"
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Koszt PLN</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={materialCost.koszt_laczny}
                    onChange={(e) => setMaterialCost((current) => ({ ...current, koszt_laczny: e.target.value }))}
                    placeholder="0.00"
                    aria-label="Koszt materialu PLN"
                    style={inputStyle}
                  />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'end' }}>
                <div>
                  <label style={labelStyle}>Notatka</label>
                  <input
                    type="text"
                    value={materialCost.notatka}
                    onChange={(e) => setMaterialCost((current) => ({ ...current, notatka: e.target.value }))}
                    placeholder="np. faktura materialowa"
                    style={inputStyle}
                  />
                </div>
                <button
                  type="button"
                  onClick={zapiszMaterial}
                  disabled={saving || !taskId || !materialCost.nazwa || !materialCost.koszt_laczny}
                  style={{ ...primaryBtn, padding: '8px 14px' }}
                >
                  Dodaj material
                </button>
              </div>
              {taskData?.materialy?.length > 0 && (
                <div style={{ marginTop: 12, display: 'grid', gap: 6 }}>
                  {taskData.materialy.map((material) => (
                    <div key={material.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12, color: 'var(--text)' }}>
                      <span>
                        {material.nazwa}
                        {material.ilosc ? ` - ${material.ilosc} ${material.jednostka || ''}` : ''}
                        {material.notatka ? ` - ${material.notatka}` : ''}
                      </span>
                      <strong>{fmt(material.koszt_laczny)} PLN</strong>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={obliczRozliczenie}
              disabled={saving || !brutto}
              style={{ ...primaryBtn, marginBottom: 20 }}
            >
              {saving ? '…' : 'Oblicz i zapisz'}
            </button>

            {/* Wynik */}
            {wynik && (
              <div style={{ background: 'var(--surface-glass)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', marginBottom: 14 }}>Wynik rozliczenia</div>
                {[
                  { label: 'Wartość brutto', value: `${fmt(wynik.wartosc_brutto)} PLN` },
                  { label: `VAT ${wynik.vat_stawka}%`, value: `${fmt(parseFloat(wynik.wartosc_brutto) - parseFloat(wynik.wartosc_netto))} PLN`, muted: true },
                  { label: 'Wartość netto', value: `${fmt(wynik.wartosc_netto)} PLN` },
                  { label: 'Koszt pomocników', value: `- ${fmt(wynik.koszt_pomocnikow)} PLN`, danger: true },
                  { label: 'Podstawa brygadzisty', value: `${fmt(wynik.podstawa_brygadzisty)} PLN` },
                ].map((r) => (
                  <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 8, marginBottom: 8, borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                    <span style={{ color: 'var(--text-muted)' }}>{r.label}</span>
                    <span style={{
                      fontWeight: 600,
                      color: r.danger ? '#f87171' : r.muted ? 'var(--text-muted)' : 'var(--text)',
                    }}>{r.value}</span>
                  </div>
                ))}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 10, marginTop: 4 }}>
                  <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>
                    Wynagrodzenie brygadzisty ({wynik.procent_brygadzisty}%)
                  </span>
                  <span style={{ fontSize: 24, fontWeight: 900, color: '#4ade80' }}>
                    {fmt(wynik.wynagrodzenie_brygadzisty)} PLN
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═══ DZIEŃ ═══════════════════════════════════════════════════════════ */}
        {tab === 'dzien' && (
          <div className="field-settlements-panel field-settlements-day">
            {/* Picker daty */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
              <label style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 600 }}>Data:</label>
              <input
                type="date"
                value={dayDate}
                onChange={(e) => setDayDate(e.target.value)}
                style={{ ...inputStyle, width: 160 }}
              />
              <button type="button" onClick={loadDay} style={{ ...primaryBtn, padding: '8px 14px' }}>
                Odśwież
              </button>
            </div>

            {/* Overview KPI */}
            {overview && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10, marginBottom: 20 }}>
                {[
                  { label: 'Dziś', value: `${fmt(overview.pay_today)} PLN`, color: 'var(--accent)' },
                  { label: 'Tydzień', value: `${fmt(overview.pay_week)} PLN`, color: '#60a5fa' },
                  { label: 'Miesiąc', value: `${fmt(overview.pay_month)} PLN`, color: '#4ade80' },
                  { label: 'Godz./miesiąc', value: `${parseFloat(overview.hours_month || 0).toFixed(1)} h`, color: '#fbbf24' },
                ].map((k) => (
                  <div key={k.label} style={{
                    background: 'var(--surface-glass)', border: '1px solid var(--border)',
                    borderTop: `3px solid ${k.color}`,
                    borderRadius: 10, padding: '12px 14px',
                  }}>
                    <div style={{ fontSize: 18, fontWeight: 800, color: k.color }}>{k.value}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{k.label}</div>
                  </div>
                ))}
              </div>
            )}

            {dayData && (
              <>
                {/* Podsumowanie dnia */}
                <div style={{ background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.25)', borderRadius: 12, padding: 20, marginBottom: 16, textAlign: 'center' }}>
                  <div style={{ fontSize: 12, color: '#4ade80', marginBottom: 6 }}>Zarobek dnia ({dayData.data})</div>
                  <div style={{ fontSize: 32, fontWeight: 900, color: '#4ade80' }}>
                    {fmt(dayData.podsumowanie.wynagrodzenie_brygadzisty)} PLN
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
                    {dayData.podsumowanie.liczba_zlecen} zleceń · koszt pomocników: {fmt(dayData.podsumowanie.koszt_pomocnikow)} PLN
                  </div>
                </div>

                {/* Zlecenia dnia */}
                {dayData.zlecenia.length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', margin: '0 0 10px' }}>Zlecenia dnia</h3>
                    {dayData.zlecenia.map((z) => (
                      <div
                        key={z.id}
                        style={{ background: 'var(--surface-glass)', border: '1px solid var(--border)', borderRadius: 10, padding: 14, marginBottom: 10, cursor: 'pointer' }}
                        onClick={() => navigate(`/zlecenia/${z.id}`)}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                          <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>{z.klient_nazwa}</span>
                          <span style={{ fontWeight: 800, color: '#4ade80', fontSize: 14 }}>
                            {z.wynagrodzenie_brygadzisty ? `${fmt(z.wynagrodzenie_brygadzisty)} PLN` : 'Brak rozliczenia'}
                          </span>
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: z.wartosc_brutto ? 8 : 0 }}>📍 {z.adres}</div>
                        {z.wartosc_brutto && (
                          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                            {[
                              `Brutto: ${fmt(z.wartosc_brutto)} PLN`,
                              `Netto: ${fmt(z.wartosc_netto)} PLN`,
                              `Pom.: -${fmt(z.koszt_pomocnikow)} PLN`,
                            ].map((t) => (
                              <span key={t} style={{ fontSize: 11, color: 'var(--text-muted)', background: 'var(--bg)', padding: '2px 8px', borderRadius: 6 }}>{t}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Godziny pomocników dnia */}
                {dayData.pomocnicy_godziny.length > 0 && (
                  <div>
                    <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', margin: '0 0 10px' }}>Godziny pomocników dnia</h3>
                    <div className="modern-data-stack">
                      {dayData.pomocnicy_godziny.map((p) => (
                        <ModernDataRow
                          key={p.id}
                          idLabel="Day Worker"
                          idValue={`DAY-${p.id}`}
                          title={`${p.imie} ${p.nazwisko}`}
                          subtitle={p.klient_nazwa || 'Zlecenie bez klienta'}
                          tone={p.status === 'Potwierdzone' ? 'success' : p.status === 'Odrzucone' ? 'danger' : 'warning'}
                          status={p.status || 'Oczekuje'}
                          statusValue={p.status}
                          statusState={p.status === 'Potwierdzone' ? 'success' : p.status === 'Odrzucone' ? 'danger' : 'warning'}
                          metrics={[
                            { label: 'Godziny', value: `${p.godziny} h` },
                            { label: 'Stawka', value: `${p.stawka_godzinowa} PLN` },
                            { label: 'Koszt', value: `${fmt(p.koszt)} PLN`, tone: 'warning' },
                          ]}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {dayData.zlecenia.length === 0 && dayData.pomocnicy_godziny.length === 0 && (
                  <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-muted)', fontSize: 14 }}>
                    Brak zleceń i godzin dla wybranego dnia
                  </div>
                )}
              </>
            )}

            {!dayData && (
              <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--text-muted)' }}>
                <div style={{ fontSize: 36, marginBottom: 10 }}>📊</div>
                <p style={{ margin: 0 }}>Wybierz datę i kliknij Odśwież</p>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

// ─── Style stałe ──────────────────────────────────────────────────────────────
const inputStyle = {
  padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)',
  background: 'var(--surface-glass)', color: 'var(--text)', fontSize: 14,
  outline: 'none', width: '100%', boxSizing: 'border-box',
};

const labelStyle = {
  display: 'block', marginBottom: 6, fontSize: 12,
  fontWeight: 600, color: 'var(--text-muted)',
};

const primaryBtn = {
  padding: '10px 24px', border: 'none', borderRadius: 10,
  background: 'var(--accent)', color: '#fff',
  fontWeight: 700, fontSize: 14, cursor: 'pointer',
};

const actionBtn = {
  flex: 1, padding: '8px 12px', borderRadius: 8,
  fontWeight: 600, fontSize: 13, cursor: 'pointer',
};
