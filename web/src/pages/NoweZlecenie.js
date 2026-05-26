import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../api';
import Sidebar from '../components/Sidebar';
import StatusMessage from '../components/StatusMessage';
import CityInput from '../components/CityInput';
import { getApiErrorMessage } from '../utils/apiError';
import { getLocalStorageJson } from '../utils/safeJsonLocalStorage';
import { getRoleDisplayName } from '../utils/roleDisplay';
import { getStoredToken, authHeaders } from '../utils/storedToken';
import { errorMessage, successMessage, warningMessage } from '../utils/statusMessage';
import {
  TASK_PRIORITIES,
  TASK_PRIORITY_COLORS,
  TASK_SERVICE_TYPES,
  buildTaskCreatePayload,
  createTaskFormDefaults,
  isTaskCreateFormValid,
} from '../utils/taskForm';
import { TASK_STATUS } from '../utils/taskWorkflow';

const IKONY = {
  klient:  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
  phone:   <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.18 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 8a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 14.92z"/></svg>,
  map:     <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>,
  city:    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>,
  tree:    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 22V12M12 12C12 7 7 3 3 3c0 4 2 8 5 10M12 12C12 7 17 3 21 3c0 4-2 8-5 10"/></svg>,
  alert:   <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>,
  money:   <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>,
  clock:   <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
  cal:     <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
  ekipa:   <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  estimator: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4Z"/></svg>,
  branch:  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>,
  note:    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>,
  back:    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>,
  plus:    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
};

export default function NoweZlecenie() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const sourceParam = params.get('source') || '';
  const klientIdParam = params.get('klientId') || '';
  const klientNameParam = params.get('klient') || '';
  const sourceLabel = sourceParam === 'wycena-kalendarz'
    ? 'Zrodlo: kalendarz wycen'
    : sourceParam === 'ogledziny'
      ? 'Zrodlo: modul ogledzin'
      : '';
  const [oddzialy, setOddzialy] = useState([]);
  const [ekipy, setEkipy] = useState([]);
  const [estimators, setEstimators] = useState([]);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [form, setForm] = useState(createTaskFormDefaults({
    klient_nazwa: /^\d+$/.test(klientNameParam) ? '' : klientNameParam,
    klient_telefon: params.get('telefon') || '',
    adres: params.get('adres') || '',
    miasto: params.get('miasto') || '',
    data_planowana: params.get('data') || '',
    godzina_rozpoczecia: params.get('godzina') || '',
    notatki_wewnetrzne: sourceLabel,
    status: TASK_STATUS.WYCENA_TERENOWA,
  }));

  const loadData = useCallback(async () => {
    try {
      const token = getStoredToken();
      const h = authHeaders(token);
      const [oRes, eRes, uRes, meRes] = await Promise.all([
        api.get(`/oddzialy`, { headers: h }),
        api.get(`/ekipy`, { headers: h }),
        api.get(`/uzytkownicy`, { headers: h }),
        api.get(`/auth/me`, { headers: h }),
      ]);
      setOddzialy(oRes.data);
      setEkipy(eRes.data);
      setEstimators((uRes.data || []).filter((u) => ['Wyceniajacy', 'Wyceniający', 'Specjalista'].includes(u.rola)));
      const freshUser = meRes.data;
      setUser(freshUser);
      if (freshUser) {
        localStorage.setItem('user', JSON.stringify(freshUser));
      }
      setForm(f => ({ ...f, oddzial_id: freshUser.oddzial_id || '' }));
      if (klientIdParam) {
        const klientRes = await api.get(`/klienci/${klientIdParam}`, { headers: h }).catch(() => null);
        const klient = klientRes?.data;
        if (klient) {
          const klientNazwa = klient.firma || [klient.imie, klient.nazwisko].filter(Boolean).join(' ').trim();
          setForm(f => ({
            ...f,
            klient_nazwa: klientNazwa || f.klient_nazwa,
            klient_telefon: klient.telefon || f.klient_telefon,
            adres: klient.adres || f.adres,
            miasto: klient.miasto || f.miasto,
          }));
        }
      }
    } catch {
      const parsedUser = getLocalStorageJson('user');
      if (!parsedUser) { navigate('/'); return; }
      setUser(parsedUser);
      setForm(f => ({ ...f, oddzial_id: parsedUser.oddzial_id || '' }));
    }
  }, [klientIdParam, navigate]);

  useEffect(() => { loadData(); }, [loadData]);

  const isDyrektor = ['Prezes', 'Dyrektor'].includes(user?.rola);
  const ekipyFiltered = form.oddzial_id
    ? ekipy.filter(e => e.oddzial_id === parseInt(form.oddzial_id))
    : ekipy;
  const isFormValid = Boolean(
    isTaskCreateFormValid(form, { requireEstimator: true, requireBranch: isDyrektor })
  );

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!isFormValid) {
      setError(warningMessage('Uzupełnij wszystkie wymagane pola.'));
      setSuccess('');
      return;
    }
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      const token = getStoredToken();
      const h = authHeaders(token);
      const payload = buildTaskCreatePayload(form, user, { initialStatus: TASK_STATUS.WYCENA_TERENOWA });
      const res = await api.post(`/tasks/nowe`, payload, { headers: h });
      const taskId = res.data.id;
      setSuccess(successMessage(`Zlecenie #${taskId} zostało utworzone!`));
      setTimeout(() => navigate(`/zlecenia/${taskId}`), 1500);
    } catch (err) {
      setError(errorMessage(getApiErrorMessage(err, 'Błąd podczas tworzenia zlecenia')));
    } finally {
      setLoading(false);
    }
  };

  const setField = (field) => (e) => setForm({ ...form, [field]: e.target.value });
  const todayDate = new Date().toISOString().split('T')[0];
  const priorKolor = TASK_PRIORITY_COLORS[form.priorytet] || '#1d4ed8';

  return (
    <div className="app-shell" style={{ display: 'flex', minHeight: '100vh', background: 'transparent' }}>
      <Sidebar />
      <main className="app-main" style={{ flex: 1, padding: '24px 28px', maxWidth: 980, margin: '0 auto', width: '100%' }}>

        {/* ── Nagłówek ─────────────────────────────────────────── */}
        <div style={{
          background: 'var(--surface-glass)',
          borderRadius: 8, padding: '20px 22px', marginBottom: 20,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          boxShadow: 'var(--shadow-md)',
          animation: 'fadeInUp 0.4s ease',
          border: '1px solid var(--border)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{
              width: 48, height: 48, borderRadius: 14,
              background: 'rgba(52,211,153,0.15)', border: '1px solid rgba(52,211,153,0.3)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--accent)',
            }}>
              {IKONY.plus}
            </div>
            <div>
              <h1 style={{ margin: 0, fontSize: 22, fontWeight: 900, color: 'var(--text)' }}>{t('pages.noweZlecenie.title')}</h1>
              <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--text-muted)', opacity: 1 }}>
                {t('pages.noweZlecenie.subtitle')}
              </p>
            </div>
          </div>
          <button
            onClick={() => navigate(-1)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border)',
              backgroundColor: 'var(--surface-field)', color: 'var(--text-sub)',
              cursor: 'pointer', fontSize: 13, fontWeight: 600, transition: 'all 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--accent-surface)'; e.currentTarget.style.color = 'var(--accent)'; }}
            onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'var(--surface-field)'; e.currentTarget.style.color = 'var(--text-sub)'; }}
          >
            {IKONY.back} {t('common.back')}
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>

            {/* ── LEWA KOLUMNA ─────────────────────────────── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

              {/* Dane klienta */}
              <Section title="Dane klienta" icon={IKONY.klient} accent="var(--accent)">
                <Field label="Klient *" icon={IKONY.klient}>
                  <input style={S.input} value={form.klient_nazwa} onChange={setField('klient_nazwa')} required placeholder="Imię i nazwisko lub firma" />
                </Field>
                <Field label="Telefon klienta" icon={IKONY.phone}>
                  <input style={S.input} value={form.klient_telefon} onChange={setField('klient_telefon')} placeholder="np. 500-100-200" type="tel" />
                </Field>
                <Field label="Adres *" icon={IKONY.map}>
                  <input style={S.input} value={form.adres} onChange={setField('adres')} required placeholder="ul. Przykładowa 1" />
                </Field>
                <Field label="Miasto *" icon={IKONY.city}>
                  <CityInput
                    style={S.input}
                    value={form.miasto}
                    onChange={setField('miasto')}
                    required
                    placeholder="np. Krakow"
                    extraCities={oddzialy.map((o) => o.miasto)}
                  />
                </Field>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <Field label="Pinezka LAT" icon={IKONY.map}>
                    <input style={S.input} value={form.pin_lat} onChange={setField('pin_lat')} placeholder="np. 50.0617" />
                  </Field>
                  <Field label="Pinezka LNG" icon={IKONY.map}>
                    <input style={S.input} value={form.pin_lng} onChange={setField('pin_lng')} placeholder="np. 19.9373" />
                  </Field>
                </div>
              </Section>

              {/* Notatki */}
              <Section title="Notatki wewnętrzne" icon={IKONY.note} accent="#1d4ed8">
                <textarea
                  style={{ ...S.input, resize: 'vertical', minHeight: 90, fontFamily: 'inherit', lineHeight: 1.5 }}
                  value={form.notatki_wewnetrzne}
                  onChange={setField('notatki_wewnetrzne')}
                  placeholder="Szczegóły zlecenia, instrukcje dla ekipy, uwagi..."
                  rows={4}
                />
              </Section>

            </div>

            {/* ── PRAWA KOLUMNA ─────────────────────────────── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

              {/* Szczegóły zlecenia */}
              <Section title="Szczegóły zlecenia" icon={IKONY.tree} accent="var(--accent)">
                <Field label="Tryb ankiety" icon={IKONY.note}>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, ankieta_uproszczona: true }))}
                      style={{ ...S.toggleBtn, ...(form.ankieta_uproszczona ? S.toggleBtnActive : {}) }}
                    >
                      Uproszczona (adres + pinezka)
                    </button>
                    <button
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, ankieta_uproszczona: false }))}
                      style={{ ...S.toggleBtn, ...(!form.ankieta_uproszczona ? S.toggleBtnActive : {}) }}
                    >
                      Pełna
                    </button>
                  </div>
                </Field>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  <Field label="Typ usługi" icon={IKONY.tree}>
                    <select style={S.input} value={form.typ_uslugi} onChange={setField('typ_uslugi')}>
                      {TASK_SERVICE_TYPES.map((type) => (
                        <option key={type} value={type}>{t(`serviceType.${type}`, { defaultValue: type })}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Priorytet" icon={IKONY.alert}>
                    <select
                      style={{ ...S.input, color: priorKolor, fontWeight: 700 }}
                      value={form.priorytet}
                      onChange={setField('priorytet')}
                    >
                      {TASK_PRIORITIES.map((priority) => (
                        <option key={priority} value={priority} style={{ color: TASK_PRIORITY_COLORS[priority] }}>{priority}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Wartość (PLN)" icon={IKONY.money}>
                    <input style={S.input} type="number" step="0.01" min="0" value={form.wartosc_planowana} onChange={setField('wartosc_planowana')} placeholder="np. 3500" />
                  </Field>
                  <Field label="Czas planowany (h)" icon={IKONY.clock}>
                    <input style={S.input} type="number" step="0.5" min="0" value={form.czas_planowany_godziny} onChange={setField('czas_planowany_godziny')} placeholder="np. 2.5" />
                  </Field>
                  <Field label="Data realizacji *" icon={IKONY.cal}>
                    <input style={S.input} type="date" value={form.data_planowana} onChange={setField('data_planowana')} min={todayDate} required />
                  </Field>
                  <Field label="Godzina rozpoczęcia" icon={IKONY.clock}>
                    <input style={S.input} type="time" value={form.godzina_rozpoczecia} onChange={setField('godzina_rozpoczecia')} />
                  </Field>
                </div>
              </Section>

              {/* Przypisanie */}
              <Section title="Przypisanie" icon={IKONY.ekipa} accent="var(--accent)">
                <Field label="Oddział" icon={IKONY.branch}>
                  {isDyrektor ? (
                    <select style={S.input} value={form.oddzial_id} onChange={e => setForm({ ...form, oddzial_id: e.target.value, ekipa_id: '' })} required>
                      <option value="">-- wybierz oddział --</option>
                      {oddzialy.map(o => <option key={o.id} value={o.id}>🏢 {o.nazwa}</option>)}
                    </select>
                  ) : (
                    <div style={{ ...S.input, color: 'var(--accent)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                      🏢 {oddzialy.find(o => o.id === parseInt(form.oddzial_id))?.nazwa || '—'}
                    </div>
                  )}
                </Field>
                <Field label="Specjalista ds. wyceny (kalendarz)" icon={IKONY.estimator}>
                  <select style={S.input} value={form.wyceniajacy_id} onChange={setField('wyceniajacy_id')}>
                    <option value="">-- wybierz specjalistę ds. wyceny --</option>
                    {estimators
                      .filter((u) => !form.oddzial_id || Number(u.oddzial_id) === Number(form.oddzial_id))
                      .map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.imie} {u.nazwisko} ({getRoleDisplayName(u.rola)})
                        </option>
                      ))}
                  </select>
                </Field>
                <Field label="Ekipa" icon={IKONY.ekipa}>
                  <select style={S.input} value={form.ekipa_id} onChange={setField('ekipa_id')}>
                    <option value="">-- przypisz później --</option>
                    {ekipyFiltered.map(e => (
                      <option key={e.id} value={e.id}>
                        {e.nazwa}
                      </option>
                    ))}
                  </select>
                  {/* Color dots for teams */}
                  {ekipyFiltered.length > 0 && (
                    <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                      {ekipyFiltered.map(e => (
                        <div
                          key={e.id}
                          onClick={() => setForm({ ...form, ekipa_id: String(e.id) })}
                          title={e.nazwa}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 5,
                            padding: '4px 10px', borderRadius: 8, cursor: 'pointer',
                            border: `1px solid ${form.ekipa_id === String(e.id) ? (e.kolor || 'var(--accent)') : 'var(--border)'}`,
                            backgroundColor: form.ekipa_id === String(e.id) ? (e.kolor || 'var(--accent)') + '22' : 'transparent',
                            transition: 'all 0.15s',
                          }}
                        >
                          <div style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: e.kolor || 'var(--text-muted)', flexShrink: 0 }} />
                          <span style={{ fontSize: 11, fontWeight: 600, color: form.ekipa_id === String(e.id) ? (e.kolor || 'var(--accent)') : 'var(--text-muted)' }}>
                            {e.nazwa}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </Field>
              </Section>

            </div>
          </div>

          {/* ── Komunikaty ───────────────────────────────────── */}
          <StatusMessage message={error} style={{ marginTop: 16 }} />
          <StatusMessage message={success} style={{ marginTop: 16 }} />

          {/* ── Przyciski ────────────────────────────────────── */}
          <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 20, paddingBottom: 20 }}>
            <button
              type="button"
              onClick={() => navigate(-1)}
              style={{
                padding: '11px 24px',
                borderRadius: 8,
                borderWidth: 1,
                borderStyle: 'solid',
                borderColor: 'var(--border)',
                backgroundColor: 'var(--surface-field)',
                color: 'var(--text-sub)',
                cursor: 'pointer',
                fontSize: 14,
                fontWeight: 600,
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--text)'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-sub)'; }}
            >
              Anuluj
            </button>
            <button
              type="submit"
              disabled={loading || !isFormValid}
              style={{
                padding: '11px 32px', borderRadius: 8, border: '1px solid rgba(20,131,79,0.22)',
                background: loading ? 'var(--surface-field)' : 'var(--accent-gradient)',
                color: 'var(--on-accent)', cursor: loading ? 'wait' : 'pointer',
                fontSize: 14, fontWeight: 800, transition: 'all 0.2s',
                boxShadow: loading ? 'none' : 'var(--shadow-sm)',
                display: 'flex', alignItems: 'center', gap: 8,
              }}
              onMouseEnter={e => { if (!loading) e.currentTarget.style.transform = 'translateY(-2px)'; }}
              onMouseLeave={e => { e.currentTarget.style.transform = 'none'; }}
            >
              {loading ? (
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ animation: 'spin 0.8s linear infinite' }}><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                  Zapisywanie...
                </>
              ) : (
                <>{IKONY.plus} Utwórz zlecenie</>
              )}
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}

// ── Komponenty pomocnicze ──────────────────────────────────────────────────────
function Section({ title, icon, accent = 'var(--accent)', children }) {
  return (
    <div style={{
      background: 'var(--surface-glass)', borderRadius: 8,
      border: '1px solid var(--border)',
      overflow: 'hidden',
      boxShadow: 'var(--shadow-md)',
      animation: 'fadeInUp 0.3s ease',
    }}>
      <div style={{
        padding: '14px 20px',
        borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: 10,
        background: 'var(--surface-field)',
      }}>
        <span style={{ color: accent, display: 'flex' }}>{icon}</span>
        <span style={{ fontSize: 14, fontWeight: 700, color: accent }}>{title}</span>
      </div>
      <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {children}
      </div>
    </div>
  );
}

function Field({ label, icon, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 5, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        <span style={{ color: 'var(--text-muted)', display: 'flex' }}>{icon}</span>
        {label}
      </label>
      {children}
    </div>
  );
}

const S = {
  input: {
    padding: '10px 12px', borderRadius: 8, fontSize: 14,
    border: '1px solid var(--border)', outline: 'none',
    width: '100%', boxSizing: 'border-box',
    transition: 'border-color 0.15s',
  },
  toggleBtn: {
    padding: '8px 12px',
    borderRadius: 8,
    border: '1px solid var(--border)',
    background: 'var(--surface-field)',
    color: 'var(--text-sub)',
    fontSize: 12,
    fontWeight: 700,
    cursor: 'pointer',
  },
  toggleBtnActive: {
    border: '1px solid var(--accent)',
    background: 'var(--accent-surface)',
    color: 'var(--accent-dk)',
  },
};
