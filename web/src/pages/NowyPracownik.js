import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getLocalStorageJson } from '../utils/safeJsonLocalStorage';
import { getStoredToken, authHeaders } from '../utils/storedToken';
import api from '../api';
import Sidebar from '../components/Sidebar';
import StatusMessage from '../components/StatusMessage';
import { getApiErrorMessage } from '../utils/apiError';
import { errorMessage, warningMessage, successMessage } from '../utils/statusMessage';


export default function NowyPracownik() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [oddzialy, setOddzialy] = useState([]);
  const [ekipy, setEkipy] = useState([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [currentUser, setCurrentUser] = useState(null);
  const [form, setForm] = useState({
    imie: '', nazwisko: '', login: '', haslo: '',
    email: '', telefon: '', rola: 'Pomocnik',
    oddzial_id: '', ekipa_id: '',
    stawka_godzinowa: '',
    procent_wynagrodzenia: '15',
    stanowisko: '', data_zatrudnienia: '',
    kontakt_awaryjny_imie: '', kontakt_awaryjny_telefon: '',
    notatki: ''
  });

  const loadData = useCallback(async () => {
    try {
      const token = getStoredToken();
      const h = authHeaders(token);
      const [oRes, eRes] = await Promise.all([
        api.get(`/oddzialy`, { headers: h }),
        api.get(`/ekipy`, { headers: h }),
      ]);
      setOddzialy(oRes.data);
      setEkipy(eRes.data);
    } catch (err) {
      console.log('Błąd ładowania:', err);
    }
  }, []);

  useEffect(() => {
    const token = getStoredToken();
    if (!token) { navigate('/'); return; }
    const u = getLocalStorageJson('user');
    if (u) setCurrentUser(u);
    loadData();
  }, [navigate, loadData]);

  const isDyrektor = currentUser?.rola === 'Dyrektor' || currentUser?.rola === 'Administrator';
  const isKierownik = currentUser?.rola === 'Kierownik';
  const canEdit = isDyrektor || isKierownik;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.login || !form.haslo || !form.imie || !form.nazwisko) {
      setMsg(warningMessage(t('pages.nowyPracownik.warnRequired')));
      return;
    }
    if (form.haslo.length < 6) {
      setMsg(warningMessage(t('pages.nowyPracownik.warnPasswordLen')));
      return;
    }
    setSaving(true);
    try {
      const token = getStoredToken();
      const payload = {
        ...form,
        stawka_godzinowa: form.stawka_godzinowa || null,
        procent_wynagrodzenia: form.rola === 'Brygadzista' ? (form.procent_wynagrodzenia || 15) : null,
        oddzial_id: form.oddzial_id || null,
        ekipa_id: form.ekipa_id || null,
        data_zatrudnienia: form.data_zatrudnienia || null,
      };
      const res = await api.post(`/uzytkownicy`, payload, {
        headers: authHeaders(token)
      });
      setMsg(successMessage(t('pages.nowyPracownik.successCreated', { id: res.data.id })));
      setTimeout(() => navigate('/uzytkownicy'), 1500);
    } catch (err) {
      setMsg(errorMessage(`Błąd: ${getApiErrorMessage(err, 'nieznany')}`));
    } finally {
      setSaving(false);
    }
  };

  const setField = (field) => (e) => setForm({ ...form, [field]: e.target.value });

  const isBrygadzista = form.rola === 'Brygadzista';
  const isSpecjalista = form.rola === 'Specjalista';
  const isPomocnik    = form.rola === 'Pomocnik' || form.rola === 'Pomocnik bez doświadczenia';
  const maStawkeGodz  = isPomocnik || isSpecjalista || form.rola === 'Magazynier';

  const ekipyFiltered = form.oddzial_id
    ? ekipy.filter(e => e.oddzial_id === parseInt(form.oddzial_id))
    : ekipy;

  const todayDate = new Date().toISOString().split('T')[0];

  if (!canEdit) {
    return <div style={styles.container}><Sidebar /><div style={styles.main}>{t('pages.nowyPracownik.noPermission')}</div></div>;
  }

  return (
    <div style={styles.container}>
      <Sidebar />
      <div style={styles.main}>
        <div style={styles.topBar}>
          <button style={styles.backBtn} onClick={() => navigate('/uzytkownicy')}>← {t('common.back')}</button>
          <h1 style={styles.title}>{t('pages.nowyPracownik.title')}</h1>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={styles.section}>
            <div style={styles.sectionTitle}>{t('pages.nowyPracownik.sectionPersonal')}</div>
            <div style={styles.grid}>
              <div style={styles.field}><label>{t('pages.nowyPracownik.firstName')}</label><input style={styles.input} value={form.imie} onChange={setField('imie')} required /></div>
              <div style={styles.field}><label>{t('pages.nowyPracownik.lastName')}</label><input style={styles.input} value={form.nazwisko} onChange={setField('nazwisko')} required /></div>
              <div style={styles.field}><label>{t('pages.nowyPracownik.phone')}</label><input style={styles.input} value={form.telefon} onChange={setField('telefon')} /></div>
              <div style={styles.field}><label>{t('pages.nowyPracownik.email')}</label><input style={styles.input} type="email" value={form.email} onChange={setField('email')} /></div>
              <div style={styles.field}><label>{t('pages.nowyPracownik.position')}</label><input style={styles.input} value={form.stanowisko} onChange={setField('stanowisko')} /></div>
              <div style={styles.field}><label>{t('pages.nowyPracownik.hireDate')}</label><input style={styles.input} type="date" value={form.data_zatrudnienia} onChange={setField('data_zatrudnienia')} max={todayDate} /></div>
            </div>
          </div>

          <div style={styles.section}>
            <div style={styles.sectionTitle}>{t('pages.nowyPracownik.sectionLogin')}</div>
            <div style={styles.grid}>
              <div style={styles.field}><label>{t('pages.nowyPracownik.login')}</label><input style={styles.input} value={form.login} onChange={setField('login')} required /></div>
              <div style={styles.field}><label>{t('pages.nowyPracownik.password')}</label><input style={styles.input} type="password" value={form.haslo} onChange={setField('haslo')} required /></div>
            </div>
          </div>

          <div style={styles.section}>
            <div style={styles.sectionTitle}>{t('pages.nowyPracownik.sectionRole')}</div>
            <div style={styles.grid}>
              <div style={styles.field}><label>{t('pages.nowyPracownik.role')}</label>
                <select style={styles.input} value={form.rola} onChange={setField('rola')}>
                  <optgroup label={t('pages.nowyPracownik.optgroupMgmt')}>
                    <option value="Dyrektor">Dyrektor</option>
                    <option value="Administrator">Administrator</option>
                    <option value="Kierownik">Kierownik</option>
                  </optgroup>
                  <optgroup label={t('pages.nowyPracownik.optgroupTeam')}>
                    <option value="Brygadzista">Brygadzista</option>
                    <option value="Specjalista">Specjalista</option>
                    <option value="Pomocnik">Pomocnik</option>
                    <option value="Pomocnik bez doświadczenia">Pomocnik bez doświadczenia</option>
                  </optgroup>
                  <optgroup label={t('pages.nowyPracownik.optgroupOther')}>
                    <option value="Wyceniający">Wyceniający</option>
                    <option value="Magazynier">Magazynier</option>
                  </optgroup>
                </select>
              </div>
              <div style={styles.field}><label>{t('pages.nowyPracownik.branch')}</label>
                <select style={styles.input} value={form.oddzial_id} onChange={e => setForm({ ...form, oddzial_id: e.target.value, ekipa_id: '' })}>
                  <option value="">{t('pages.nowyPracownik.selectBranch')}</option>
                  {oddzialy.map(o => <option key={o.id} value={o.id}>{o.nazwa}</option>)}
                </select>
              </div>
            </div>
            {(isPomocnik || isBrygadzista || isSpecjalista) && form.oddzial_id && (
              <div style={styles.field}><label>{t('pages.nowyPracownik.assignTeam')}</label>
                <select style={styles.input} value={form.ekipa_id} onChange={setField('ekipa_id')}>
                  <option value="">{t('common.noneShort')}</option>
                  {ekipyFiltered.map(e => <option key={e.id} value={e.id}>{e.nazwa}</option>)}
                </select>
              </div>
            )}
          </div>

          <div style={styles.section}>
            <div style={styles.sectionTitle}>{t('pages.nowyPracownik.sectionPay')}</div>
            <div style={styles.grid}>
              {isBrygadzista ? (
                <>
                  <div style={styles.field}><label>{t('pages.nowyPracownik.rateHelpers')}</label><input style={styles.input} type="number" step="0.5" value={form.stawka_godzinowa} onChange={setField('stawka_godzinowa')} /></div>
                  <div style={styles.field}><label>{t('pages.nowyPracownik.percentJob')}</label><input style={styles.input} type="number" min="1" max="100" step="0.5" value={form.procent_wynagrodzenia} onChange={setField('procent_wynagrodzenia')} /></div>
                </>
              ) : maStawkeGodz ? (
                <div style={styles.field}><label>{t('pages.nowyPracownik.hourlyRate')}</label><input style={styles.input} type="number" step="0.5" value={form.stawka_godzinowa} onChange={setField('stawka_godzinowa')} /></div>
              ) : null}
            </div>
          </div>

          <div style={styles.section}>
            <div style={styles.sectionTitle}>{t('pages.nowyPracownik.sectionEmergency')}</div>
            <div style={styles.grid}>
              <div style={styles.field}><label>{t('pages.nowyPracownik.emergencyName')}</label><input style={styles.input} value={form.kontakt_awaryjny_imie} onChange={setField('kontakt_awaryjny_imie')} /></div>
              <div style={styles.field}><label>{t('pages.nowyPracownik.emergencyPhone')}</label><input style={styles.input} value={form.kontakt_awaryjny_telefon} onChange={setField('kontakt_awaryjny_telefon')} /></div>
            </div>
          </div>

          <div style={styles.section}>
            <div style={styles.sectionTitle}>{t('pages.nowyPracownik.sectionNotes')}</div>
            <textarea style={styles.textarea} value={form.notatki} onChange={setField('notatki')} rows={3} />
          </div>

          <StatusMessage message={msg} />

          <div style={styles.btnRow}>
            <button type="button" style={styles.cancelBtn} onClick={() => navigate('/uzytkownicy')}>{t('common.cancel')}</button>
            <button type="submit" style={styles.submitBtn} disabled={saving}>{saving ? t('common.creating') : t('pages.nowyPracownik.createAccount')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

const styles = {
  container: { display: 'flex', minHeight: '100vh', backgroundColor: 'var(--bg)' },
  main: { flex: 1, padding: '20px', maxWidth: 900, margin: '0 auto', width: '100%' },
  topBar: { display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24, flexWrap: 'wrap' },
  backBtn: { padding: '8px 16px', backgroundColor: 'var(--bg-card)', border: 'none', borderRadius: 8, cursor: 'pointer' },
  title: { fontSize: 24, fontWeight: 'bold', color: 'var(--accent)', margin: 0 },
  section: { backgroundColor: 'var(--bg-card)', borderRadius: 12, padding: 20, marginBottom: 16, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  sectionTitle: { fontSize: 16, fontWeight: 'bold', color: 'var(--accent)', marginBottom: 16, paddingBottom: 8, borderBottom: '1px solid var(--border)' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 },
  field: { display: 'flex', flexDirection: 'column', gap: 6 },
  input: { padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 14, outline: 'none', width: '100%' },
  textarea: { padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 14, outline: 'none', width: '100%', resize: 'vertical', fontFamily: 'inherit' },
  btnRow: { display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 16 },
  cancelBtn: { padding: '10px 24px', backgroundColor: 'var(--bg-card)', border: 'none', borderRadius: 8, cursor: 'pointer' },
  submitBtn: { padding: '10px 28px', backgroundColor: 'var(--bg-deep)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 'bold' }
};
