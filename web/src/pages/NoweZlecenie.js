import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../api';
import Sidebar from '../components/Sidebar';
import StatusMessage from '../components/StatusMessage';
import CityInput from '../components/CityInput';
import { getApiErrorMessage } from '../utils/apiError';
import { getLocalStorageJson } from '../utils/safeJsonLocalStorage';
import { getStoredToken, authHeaders } from '../utils/storedToken';
import { errorMessage, successMessage, warningMessage } from '../utils/statusMessage';

const TYPY = ['Wycinka', 'Pielęgnacja', 'Ogrodnictwo', 'Frezowanie pniaków', 'Inne'];
const PRIORYTETY = ['Niski', 'Normalny', 'Wysoki', 'Pilny'];
const PRIORYTET_KOLOR = { Niski: '#6B7280', Normalny: '#3B82F6', Wysoki: '#F59E0B', Pilny: '#EF4444' };

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
  const [oddzialy, setOddzialy] = useState([]);
  const [ekipy, setEkipy] = useState([]);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [form, setForm] = useState({
    klient_nazwa: '',
    klient_telefon: '',
    adres: '',
    miasto: '',
    typ_uslugi: 'Wycinka',
    priorytet: 'Normalny',
    wartosc_planowana: '',
    czas_planowany_godziny: '',
    data_planowana: params.get('data') || '',
    godzina_rozpoczecia: params.get('godzina') || '',
    notatki_wewnetrzne: '',
    oddzial_id: '',
    ekipa_id: ''
  });

  const loadData = useCallback(async () => {
    try {
      const token = getStoredToken();
      const h = authHeaders(token);
      const [oRes, eRes, meRes] = await Promise.all([
        api.get(`/oddzialy`, { headers: h }),
        api.get(`/ekipy`, { headers: h }),
        api.get(`/auth/me`, { headers: h }),
      ]);
      setOddzialy(oRes.data);
      setEkipy(eRes.data);
      const freshUser = meRes.data;
      setUser(freshUser);
      if (freshUser) {
        localStorage.setItem('user', JSON.stringify(freshUser));
      }
      setForm(f => ({ ...f, oddzial_id: freshUser.oddzial_id || '' }));
    } catch {
      const parsedUser = getLocalStorageJson('user');
      if (!parsedUser) { navigate('/'); return; }
      setUser(parsedUser);
      setForm(f => ({ ...f, oddzial_id: parsedUser.oddzial_id || '' }));
    }
  }, [navigate]);

  useEffect(() => { loadData(); }, [loadData]);

  const isDyrektor = user?.rola === 'Dyrektor' || user?.rola === 'Administrator';
  const ekipyFiltered = form.oddzial_id
    ? ekipy.filter(e => e.oddzial_id === parseInt(form.oddzial_id))
    : ekipy;
  const isFormValid = Boolean(
    form.klient_nazwa.trim() &&
    form.adres.trim() &&
    form.miasto.trim() &&
    form.data_planowana &&
    (!isDyrektor || form.oddzial_id)
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
      const payload = {
        klient_nazwa: form.klient_nazwa.trim(),
        klient_telefon: form.klient_telefon.trim() || null,
        adres: form.adres.trim(),
        miasto: form.miasto.trim(),
        typ_uslugi: form.typ_uslugi,
        priorytet: form.priorytet,
        wartosc_planowana: form.wartosc_planowana || null,
        czas_planowany_godziny: form.czas_planowany_godziny || null,
        data_planowana: form.data_planowana,
        godzina_rozpoczecia: form.godzina_rozpoczecia || null,
        notatki_wewnetrzne: form.notatki_wewnetrzne.trim() || null,
        oddzial_id: form.oddzial_id || user?.oddzial_id,
        ekipa_id: form.ekipa_id ? parseInt(form.ekipa_id) : null,
      };
      const res = await api.post(`/tasks`, payload, { headers: h });
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
  const priorKolor = PRIORYTET_KOLOR[form.priorytet] || '#3B82F6';

  return (
    <div style={{ display: 'flex', minHeight: '100vh', backgroundColor: 'var(--bg)' }}>
      <Sidebar />
      <div style={{ flex: 1, padding: '24px 28px', maxWidth: 980, margin: '0 auto', width: '100%' }}>

        {/* ── Nagłówek ─────────────────────────────────────────── */}
        <div style={{
          background: 'linear-gradient(135deg, var(--sidebar) 0%, #1B4332 100%)',
          borderRadius: 20, padding: '22px 28px', marginBottom: 24,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          boxShadow: '0 4px 24px rgba(0,0,0,0.35)',
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
              <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: '#fff' }}>{t('pages.noweZlecenie.title')}</h1>
              <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--accent)', opacity: 0.8 }}>
                {t('pages.noweZlecenie.subtitle')}
              </p>
            </div>
          </div>
          <button
            onClick={() => navigate(-1)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 16px', borderRadius: 10, border: '1px solid var(--border)',
              backgroundColor: 'rgba(255,255,255,0.06)', color: 'var(--text-sub)',
              cursor: 'pointer', fontSize: 13, fontWeight: 600, transition: 'all 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.12)'; e.currentTarget.style.color = '#fff'; }}
            onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.06)'; e.currentTarget.style.color = 'var(--text-sub)'; }}
          >
            {IKONY.back} {t('common.back')}
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>

            {/* ── LEWA KOLUMNA ─────────────────────────────── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

              {/* Dane klienta */}
              <Section title="Dane klienta" icon={IKONY.klient} accent="#34D399">
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
              </Section>

              {/* Notatki */}
              <Section title="Notatki wewnętrzne" icon={IKONY.note} accent="#60A5FA">
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
              <Section title="Szczegóły zlecenia" icon={IKONY.tree} accent="#34D399">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  <Field label="Typ usługi" icon={IKONY.tree}>
                    <select style={S.input} value={form.typ_uslugi} onChange={setField('typ_uslugi')}>
                      {TYPY.map(t => <option key={t}>{t}</option>)}
                    </select>
                  </Field>
                  <Field label="Priorytet" icon={IKONY.alert}>
                    <select
                      style={{ ...S.input, color: priorKolor, fontWeight: 700 }}
                      value={form.priorytet}
                      onChange={setField('priorytet')}
                    >
                      {PRIORYTETY.map(p => <option key={p} style={{ color: PRIORYTET_KOLOR[p] }}>{p}</option>)}
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
              <Section title="Przypisanie" icon={IKONY.ekipa} accent="#A78BFA">
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
                            padding: '4px 10px', borderRadius: 20, cursor: 'pointer',
                            border: `1px solid ${form.ekipa_id === String(e.id) ? (e.kolor || 'var(--accent)') : 'var(--border)'}`,
                            backgroundColor: form.ekipa_id === String(e.id) ? (e.kolor || 'var(--accent)') + '22' : 'transparent',
                            transition: 'all 0.15s',
                          }}
                        >
                          <div style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: e.kolor || '#6B7280', flexShrink: 0 }} />
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
                borderRadius: 10,
                borderWidth: 1,
                borderStyle: 'solid',
                borderColor: 'var(--border)',
                backgroundColor: 'var(--bg-card)',
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
                padding: '11px 32px', borderRadius: 10, border: 'none',
                background: loading ? 'var(--bg-deep)' : 'linear-gradient(135deg, var(--accent), var(--accent-dk))',
                color: '#0A1628', cursor: loading ? 'wait' : 'pointer',
                fontSize: 14, fontWeight: 800, transition: 'all 0.2s',
                boxShadow: loading ? 'none' : '0 4px 16px rgba(52,211,153,0.35)',
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
      </div>
    </div>
  );
}

// ── Komponenty pomocnicze ──────────────────────────────────────────────────────
function Section({ title, icon, accent = 'var(--accent)', children }) {
  return (
    <div style={{
      backgroundColor: 'var(--bg-card)', borderRadius: 16,
      border: '1px solid var(--border)',
      overflow: 'hidden',
      boxShadow: '0 2px 12px rgba(0,0,0,0.15)',
      animation: 'fadeInUp 0.3s ease',
    }}>
      <div style={{
        padding: '14px 20px',
        borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: 10,
        background: `linear-gradient(90deg, ${accent}18, transparent)`,
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
        <span style={{ color: 'var(--border2)', display: 'flex' }}>{icon}</span>
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
};
