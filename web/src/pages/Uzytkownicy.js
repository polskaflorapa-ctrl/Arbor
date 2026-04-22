import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import Sidebar from '../components/Sidebar';
import StatusMessage from '../components/StatusMessage';
import { getApiErrorMessage } from '../utils/apiError';
import { getLocalStorageJson } from '../utils/safeJsonLocalStorage';
import { getStoredToken, authHeaders } from '../utils/storedToken';
 
 
export default function Uzytkownicy() {
  const [uzytkownicy, setUzytkownicy] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState(null);
  const [oddzialy, setOddzialy] = useState([]);
 
  // Tryby widoku: 'lista' | 'szczegoly' | 'nowy' | 'edytuj'
  const [tryb, setTryb] = useState('lista');
  const [wybranyUser, setWybranyUser] = useState(null);
  const [kompetencje, setKompetencje] = useState([]);
 
  // Formularz użytkownika
  const [form, setForm] = useState({
    login: '', haslo: '', imie: '', nazwisko: '', email: '', telefon: '',
    rola: 'Brygadzista', oddzial_id: '', stawka_godzinowa: '',
    procent_wynagrodzenia: 15, stanowisko: '', data_zatrudnienia: '',
    adres_zamieszkania: '', kontakt_awaryjny_imie: '', kontakt_awaryjny_telefon: '',
    notatki: '', aktywny: true
  });
 
  // Formularz kompetencji
  const [formKomp, setFormKomp] = useState({
    nazwa: '', typ: 'inne', nr_dokumentu: '', data_uzyskania: '', data_waznosci: '', wydawca: ''
  });
 
  const [noweHaslo, setNoweHaslo] = useState('');
  const [pokazHaslo, setPokazHaslo] = useState(false);
  const [pokazFormHaslo, setPokazFormHaslo] = useState(false);
  const [pokazFormKomp, setPokazFormKomp] = useState(false);
  const [komunikat, setKomunikat] = useState({ tekst: '', typ: '' });
  const [filtrRola, setFiltrRola] = useState('');
  const [filtrOddzial, setFiltrOddzial] = useState('');
  const [szukaj, setSzukaj] = useState('');
 
  const navigate = useNavigate();
 
  const isDyrektor = currentUser?.rola === 'Dyrektor' || currentUser?.rola === 'Administrator';
  const isKierownik = currentUser?.rola === 'Kierownik';
  const mozeEdytowac = isDyrektor || isKierownik;
 
  useEffect(() => {
    const parsedUser = getLocalStorageJson('user');
    if (!parsedUser) { navigate('/'); return; }
    setCurrentUser(parsedUser);
    loadData(parsedUser);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
 
  const loadData = async (user) => {
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
      pokazKomunikat('Błąd ładowania danych: ' + getApiErrorMessage(err, err.message), 'error');
    } finally {
      setLoading(false);
    }
  };
 
  const pokazKomunikat = (tekst, typ = 'success') => {
    setKomunikat({ tekst, typ });
    setTimeout(() => setKomunikat({ tekst: '', typ: '' }), 4000);
  };
 
  const otworzSzczegoly = async (user) => {
    setWybranyUser(user);
    setTryb('szczegoly');
    setPokazFormHaslo(false);
    setPokazFormKomp(false);
    try {
      const token = getStoredToken();
      const h = authHeaders(token);
      const [uRes, kRes] = await Promise.all([
        api.get(`/uzytkownicy/${user.id}`, { headers: h }),
        api.get(`/uzytkownicy/${user.id}/kompetencje`, { headers: h }),
      ]);
      setWybranyUser(uRes.data);
      setKompetencje(kRes.data);
    } catch (err) {
      pokazKomunikat('Błąd ładowania szczegółów', 'error');
    }
  };
 
  const otworzEdycje = (user) => {
    setForm({
      login: user.login || '',
      haslo: '',
      imie: user.imie || '',
      nazwisko: user.nazwisko || '',
      email: user.email || '',
      telefon: user.telefon || '',
      rola: user.rola || 'Brygadzista',
      oddzial_id: user.oddzial_id || '',
      stawka_godzinowa: user.stawka_godzinowa || '',
      procent_wynagrodzenia: user.procent_wynagrodzenia || 15,
      stanowisko: user.stanowisko || '',
      data_zatrudnienia: user.data_zatrudnienia ? user.data_zatrudnienia.split('T')[0] : '',
      adres_zamieszkania: user.adres_zamieszkania || '',
      kontakt_awaryjny_imie: user.kontakt_awaryjny_imie || '',
      kontakt_awaryjny_telefon: user.kontakt_awaryjny_telefon || '',
      notatki: user.notatki || '',
      aktywny: user.aktywny
    });
    setWybranyUser(user);
    setTryb('edytuj');
  };
 
  const otworzNowy = () => {
    setForm({
      login: '', haslo: '', imie: '', nazwisko: '', email: '', telefon: '',
      rola: 'Brygadzista', oddzial_id: '', stawka_godzinowa: '',
      procent_wynagrodzenia: 15, stanowisko: '', data_zatrudnienia: '',
      adres_zamieszkania: '', kontakt_awaryjny_imie: '', kontakt_awaryjny_telefon: '',
      notatki: '', aktywny: true
    });
    setWybranyUser(null);
    setTryb('nowy');
  };
 
  const zapiszUzytkownika = async () => {
    try {
      const token = getStoredToken();
      const h = authHeaders(token);
      if (tryb === 'nowy') {
        await api.post(`/uzytkownicy`, form, { headers: h });
        pokazKomunikat('Użytkownik utworzony pomyślnie');
      } else {
        await api.put(`/uzytkownicy/${wybranyUser.id}`, form, { headers: h });
        pokazKomunikat('Dane użytkownika zaktualizowane');
      }
      await loadData(currentUser);
      setTryb('lista');
    } catch (err) {
      pokazKomunikat(getApiErrorMessage(err, 'Błąd zapisu'), 'error');
    }
  };
 
  const zmienHaslo = async () => {
    if (!noweHaslo || noweHaslo.length < 6) {
      pokazKomunikat('Hasło musi mieć minimum 6 znaków', 'error');
      return;
    }
    try {
      const token = getStoredToken();
      await api.put(`/uzytkownicy/${wybranyUser.id}/haslo`,
        { nowe_haslo: noweHaslo },
        { headers: authHeaders(token) }
      );
      pokazKomunikat('Hasło zmienione pomyślnie');
      setNoweHaslo('');
      setPokazFormHaslo(false);
    } catch (err) {
      pokazKomunikat(getApiErrorMessage(err, 'Błąd zmiany hasła'), 'error');
    }
  };
 
  const zmienAktywnosc = async (userId, aktywny) => {
    try {
      const token = getStoredToken();
      await api.put(`/uzytkownicy/${userId}/aktywny`,
        { aktywny },
        { headers: authHeaders(token) }
      );
      pokazKomunikat(`Użytkownik ${aktywny ? 'aktywowany' : 'dezaktywowany'}`);
      setUzytkownicy(prev => prev.map(u => u.id === userId ? { ...u, aktywny } : u));
      if (wybranyUser?.id === userId) setWybranyUser(prev => ({ ...prev, aktywny }));
    } catch (err) {
      pokazKomunikat('Błąd zmiany statusu', 'error');
    }
  };
 
  const dodajKompetencje = async () => {
    if (!formKomp.nazwa) { pokazKomunikat('Podaj nazwę kompetencji', 'error'); return; }
    try {
      const token = getStoredToken();
      const h = authHeaders(token);
      await api.post(`/uzytkownicy/${wybranyUser.id}/kompetencje`, formKomp, { headers: h });
      pokazKomunikat('Kompetencja dodana');
      setFormKomp({ nazwa: '', typ: 'inne', nr_dokumentu: '', data_uzyskania: '', data_waznosci: '', wydawca: '' });
      setPokazFormKomp(false);
      const kRes = await api.get(`/uzytkownicy/${wybranyUser.id}/kompetencje`, { headers: h });
      setKompetencje(kRes.data);
    } catch (err) {
      pokazKomunikat('Błąd dodawania kompetencji', 'error');
    }
  };
 
  const usunKompetencje = async (kid) => {
    if (!window.confirm('Usunąć tę kompetencję?')) return;
    try {
      const token = getStoredToken();
      await api.delete(`/uzytkownicy/${wybranyUser.id}/kompetencje/${kid}`,
        { headers: authHeaders(token) }
      );
      pokazKomunikat('Kompetencja usunięta');
      setKompetencje(prev => prev.filter(k => k.id !== kid));
    } catch (err) {
      pokazKomunikat('Błąd usuwania kompetencji', 'error');
    }
  };
 
  const filtrowane = uzytkownicy.filter(u => {
    if (filtrRola && u.rola !== filtrRola) return false;
    if (filtrOddzial && u.oddzial_id?.toString() !== filtrOddzial) return false;
    if (szukaj) {
      const q = szukaj.toLowerCase();
      if (!`${u.imie} ${u.nazwisko} ${u.login} ${u.email}`.toLowerCase().includes(q)) return false;
    }
    return true;
  });
 
  const getRolaColor = (rola) => {
    const map = {
      'Dyrektor':                   '#8B5CF6',
      'Administrator':              '#F59E0B',
      'Kierownik':                  '#3B82F6',
      'Brygadzista':                '#10B981',
      'Specjalista':                '#06B6D4',
      'Wyceniający':                '#A78BFA',
      'Pomocnik':                   '#94A3B8',
      'Pomocnik bez doświadczenia': '#64748B',
      'Magazynier':                 '#F97316',
    };
    return map[rola] || '#64748B';
  };
 
  const isWazna = (data) => {
    if (!data) return null;
    const diff = new Date(data) - new Date();
    const dni = Math.ceil(diff / (1000 * 60 * 60 * 24));
    if (dni < 0) return 'expired';
    if (dni < 30) return 'soon';
    return 'ok';
  };
 
  return (
    <div style={s.container}>
      <Sidebar />
      <div style={s.main}>
 
        {/* Komunikat */}
        <StatusMessage
          message={komunikat.tekst ? `${komunikat.typ === 'error' ? '❌' : '✅'} ${komunikat.tekst}` : ''}
          style={{ ...s.komunikat, border: '1px solid' }}
        />
 
        {/* ===== LISTA ===== */}
        {tryb === 'lista' && (
          <>
            <div style={s.headerRow}>
              <div>
                <h1 style={s.title}>👥 Użytkownicy</h1>
                <p style={s.sub}>Zarządzanie pracownikami i uprawnieniami</p>
              </div>
              {mozeEdytowac && (
                <button style={s.btnPrimary} onClick={otworzNowy}>+ Nowy użytkownik</button>
              )}
            </div>
 
            <div style={s.filtryRow}>
              <input style={s.searchInput} placeholder="🔍 Szukaj po imieniu, loginie, emailu..."
                value={szukaj} onChange={e => setSzukaj(e.target.value)} />
              <select style={s.filtrInput} value={filtrRola} onChange={e => setFiltrRola(e.target.value)}>
                <option value="">Wszystkie role</option>
                <option value="Dyrektor">Dyrektor</option>
                <option value="Administrator">Administrator</option>
                <option value="Kierownik">Kierownik</option>
                <option value="Brygadzista">Brygadzista</option>
                <option value="Specjalista">Specjalista</option>
                <option value="Wyceniający">Wyceniający</option>
                <option value="Pomocnik">Pomocnik</option>
                <option value="Pomocnik bez doświadczenia">Pomocnik bez doświadczenia</option>
                <option value="Magazynier">Magazynier</option>
              </select>
              {isDyrektor && (
                <select style={s.filtrInput} value={filtrOddzial} onChange={e => setFiltrOddzial(e.target.value)}>
                  <option value="">Wszystkie oddziały</option>
                  {oddzialy.map(o => <option key={o.id} value={o.id}>🏢 {o.nazwa}</option>)}
                </select>
              )}
              {(filtrRola || filtrOddzial || szukaj) && (
                <button style={s.clearBtn} onClick={() => { setFiltrRola(''); setFiltrOddzial(''); setSzukaj(''); }}>
                  ✕ Wyczyść
                </button>
              )}
              <span style={s.countBadge}>{filtrowane.length} / {uzytkownicy.length}</span>
            </div>
 
            {loading ? (
              <div style={s.loading}>⏳ Ładowanie...</div>
            ) : (
              <div style={s.card}>
                <div style={s.tableScroll}>
                  <table style={s.table}>
                    <thead>
                      <tr>
                        <th style={s.th}>Pracownik</th>
                        <th style={s.th}>Rola</th>
                        <th style={s.th}>Oddział</th>
                        <th style={s.th}>Kontakt</th>
                        <th style={s.th}>Status</th>
                        <th style={s.th}>Akcje</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtrowane.length === 0 ? (
                        <tr><td colSpan={6} style={{ ...s.td, textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                          Brak użytkowników spełniających kryteria
                        </td></tr>
                      ) : filtrowane.map((u, i) => (
                        <tr key={u.id} style={{ backgroundColor: i % 2 === 0 ? 'var(--bg-card)' : 'var(--bg-deep)', cursor: 'pointer' }}
                          onClick={() => otworzSzczegoly(u)}>
                          <td style={s.td}>
                            <div style={s.avatarRow}>
                              <div style={{ ...s.avatar, backgroundColor: getRolaColor(u.rola) }}>
                                {u.imie?.[0]}{u.nazwisko?.[0]}
                              </div>
                              <div>
                                <div style={s.fullName}>{u.imie} {u.nazwisko}</div>
                                <div style={s.loginText}>@{u.login}</div>
                              </div>
                            </div>
                          </td>
                          <td style={s.td}>
                            <span style={{ ...s.rolaBadge, backgroundColor: getRolaColor(u.rola) }}>
                              {u.rola}
                            </span>
                          </td>
                          <td style={s.td}>{u.oddzial_nazwa || <span style={s.gray}>—</span>}</td>
                          <td style={s.td}>
                            <div style={{ fontSize: 12 }}>{u.email || '—'}</div>
                            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{u.telefon || ''}</div>
                          </td>
                          <td style={s.td}>
                            <span style={{ ...s.statusBadge, backgroundColor: u.aktywny ? 'rgba(52,211,153,0.1)' : '#FFEBEE', color: u.aktywny ? 'var(--accent)' : '#C62828', border: `1px solid ${u.aktywny ? '#A5D6A7' : '#EF9A9A'}` }}>
                              {u.aktywny ? '✅ Aktywny' : '❌ Nieaktywny'}
                            </span>
                          </td>
                          <td style={s.td} onClick={e => e.stopPropagation()}>
                            <div style={s.akcjeRow}>
                              <button style={s.btnSm} onClick={() => otworzSzczegoly(u)}>👁</button>
                              {mozeEdytowac && (
                                <>
                                  <button style={s.btnSm} onClick={() => otworzEdycje(u)}>✏️</button>
                                  <button style={{ ...s.btnSm, backgroundColor: u.aktywny ? '#FFEBEE' : 'rgba(52,211,153,0.1)' }}
                                    onClick={() => zmienAktywnosc(u.id, !u.aktywny)}>
                                    {u.aktywny ? '🔒' : '🔓'}
                                  </button>
                                </>
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
          </>
        )}
 
        {/* ===== SZCZEGÓŁY ===== */}
        {tryb === 'szczegoly' && wybranyUser && (
          <>
            <div style={s.headerRow}>
              <div style={s.breadcrumb}>
                <button style={s.backBtn} onClick={() => setTryb('lista')}>← Powrót</button>
                <h1 style={s.title}>👤 {wybranyUser.imie} {wybranyUser.nazwisko}</h1>
              </div>
              {mozeEdytowac && (
                <div style={{ display: 'flex', gap: 8 }}>
                  <button style={s.btnSecondary} onClick={() => otworzEdycje(wybranyUser)}>✏️ Edytuj</button>
                  <button style={{ ...s.btnSecondary, backgroundColor: wybranyUser.aktywny ? '#FFEBEE' : 'rgba(52,211,153,0.1)', color: wybranyUser.aktywny ? '#C62828' : 'var(--accent)' }}
                    onClick={() => zmienAktywnosc(wybranyUser.id, !wybranyUser.aktywny)}>
                    {wybranyUser.aktywny ? '🔒 Dezaktywuj' : '🔓 Aktywuj'}
                  </button>
                </div>
              )}
            </div>
 
            <div style={s.twoCol}>
              <div style={s.card}>
                <div style={s.cardTitle}>📋 Dane podstawowe</div>
                <div style={s.avatarBig}>
                  <div style={{ ...s.avatarLarge, backgroundColor: getRolaColor(wybranyUser.rola) }}>
                    {wybranyUser.imie?.[0]}{wybranyUser.nazwisko?.[0]}
                  </div>
                  <span style={{ ...s.rolaBadge, backgroundColor: getRolaColor(wybranyUser.rola), fontSize: 13 }}>
                    {wybranyUser.rola}
                  </span>
                </div>
                {[
                  { label: 'Login', value: `@${wybranyUser.login}` },
                  { label: 'Imię i nazwisko', value: `${wybranyUser.imie} ${wybranyUser.nazwisko}` },
                  { label: 'Email', value: wybranyUser.email },
                  { label: 'Telefon', value: wybranyUser.telefon },
                  { label: 'Oddział', value: wybranyUser.oddzial_nazwa },
                  { label: 'Stanowisko', value: wybranyUser.stanowisko },
                  { label: 'Data zatrudnienia', value: wybranyUser.data_zatrudnienia ? wybranyUser.data_zatrudnienia.split('T')[0] : null },
                  { label: 'Status', value: wybranyUser.aktywny ? '✅ Aktywny' : '❌ Nieaktywny' },
                ].map(row => row.value ? (
                  <div key={row.label} style={s.detailRow}>
                    <span style={s.detailLabel}>{row.label}</span>
                    <span style={s.detailValue}>{row.value}</span>
                  </div>
                ) : null)}
              </div>
 
              <div>
                {isDyrektor && (
                  <div style={{ ...s.card, marginBottom: 16 }}>
                    <div style={s.cardTitle}>💰 Dane finansowe</div>
                    {wybranyUser.stawka_godzinowa && (
                      <div style={s.detailRow}>
                        <span style={s.detailLabel}>Stawka godzinowa</span>
                        <span style={s.detailValue}>{wybranyUser.stawka_godzinowa} PLN/h</span>
                      </div>
                    )}
                    {wybranyUser.procent_wynagrodzenia && (
                      <div style={s.detailRow}>
                        <span style={s.detailLabel}>Procent wynagrodzenia</span>
                        <span style={s.detailValue}>{wybranyUser.procent_wynagrodzenia}%</span>
                      </div>
                    )}
                  </div>
                )}
 
                <div style={{ ...s.card, marginBottom: 16 }}>
                  <div style={s.cardTitle}>🆘 Kontakt awaryjny</div>
                  {wybranyUser.kontakt_awaryjny_imie || wybranyUser.kontakt_awaryjny_telefon ? (
                    <>
                      {wybranyUser.kontakt_awaryjny_imie && (
                        <div style={s.detailRow}>
                          <span style={s.detailLabel}>Imię</span>
                          <span style={s.detailValue}>{wybranyUser.kontakt_awaryjny_imie}</span>
                        </div>
                      )}
                      {wybranyUser.kontakt_awaryjny_telefon && (
                        <div style={s.detailRow}>
                          <span style={s.detailLabel}>Telefon</span>
                          <span style={s.detailValue}>{wybranyUser.kontakt_awaryjny_telefon}</span>
                        </div>
                      )}
                    </>
                  ) : <p style={s.gray}>Brak danych</p>}
                </div>
 
                {wybranyUser.adres_zamieszkania && (
                  <div style={{ ...s.card, marginBottom: 16 }}>
                    <div style={s.cardTitle}>🏠 Adres zamieszkania</div>
                    <p style={{ margin: 0, fontSize: 14 }}>{wybranyUser.adres_zamieszkania}</p>
                  </div>
                )}
 
                {wybranyUser.notatki && (
                  <div style={s.card}>
                    <div style={s.cardTitle}>📝 Notatki</div>
                    <p style={{ margin: 0, fontSize: 14, whiteSpace: 'pre-wrap' }}>{wybranyUser.notatki}</p>
                  </div>
                )}
              </div>
            </div>
 
            {/* Zmiana hasła */}
            {isDyrektor && (
              <div style={s.card}>
                <div style={s.cardTitle}>🔑 Zmiana hasła</div>
                {!pokazFormHaslo ? (
                  <button style={s.btnSecondary} onClick={() => setPokazFormHaslo(true)}>Zmień hasło</button>
                ) : (
                  <div style={s.inlineForm}>
                    <div style={{ position: 'relative' }}>
                      <input style={{ ...s.input, paddingRight: 40 }} type={pokazHaslo ? 'text' : 'password'}
                        placeholder="Nowe hasło (min. 6 znaków)"
                        value={noweHaslo} onChange={e => setNoweHaslo(e.target.value)} />
                      <button style={s.eyeBtn} onClick={() => setPokazHaslo(!pokazHaslo)}>
                        {pokazHaslo ? '🙈' : '👁'}
                      </button>
                    </div>
                    <button style={s.btnPrimary} onClick={zmienHaslo}>Zapisz</button>
                    <button style={s.btnGray} onClick={() => { setPokazFormHaslo(false); setNoweHaslo(''); }}>Anuluj</button>
                  </div>
                )}
              </div>
            )}
 
            {/* Kompetencje */}
            <div style={s.card}>
              <div style={{ ...s.cardTitle, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>🎓 Kompetencje ({kompetencje.length})</span>
                {mozeEdytowac && (
                  <button style={s.btnSmGreen} onClick={() => setPokazFormKomp(!pokazFormKomp)}>+ Dodaj</button>
                )}
              </div>
 
              {pokazFormKomp && (
                <div style={s.kompForm}>
                  <div style={s.formGrid}>
                    <div style={s.formGroup}>
                      <label style={s.label}>Nazwa *</label>
                      <input style={s.input} placeholder="np. Uprawnienia wysokościowe"
                        value={formKomp.nazwa} onChange={e => setFormKomp({ ...formKomp, nazwa: e.target.value })} />
                    </div>
                    <div style={s.formGroup}>
                      <label style={s.label}>Typ</label>
                      <select style={s.input} value={formKomp.typ} onChange={e => setFormKomp({ ...formKomp, typ: e.target.value })}>
                        <option value="inne">Inne</option>
                        <option value="uprawnienia">Uprawnienia</option>
                        <option value="kurs">Kurs</option>
                        <option value="certyfikat">Certyfikat</option>
                        <option value="prawo_jazdy">Prawo jazdy</option>
                      </select>
                    </div>
                    <div style={s.formGroup}>
                      <label style={s.label}>Nr dokumentu</label>
                      <input style={s.input} placeholder="Numer certyfikatu"
                        value={formKomp.nr_dokumentu} onChange={e => setFormKomp({ ...formKomp, nr_dokumentu: e.target.value })} />
                    </div>
                    <div style={s.formGroup}>
                      <label style={s.label}>Wydawca</label>
                      <input style={s.input} placeholder="Instytucja wydająca"
                        value={formKomp.wydawca} onChange={e => setFormKomp({ ...formKomp, wydawca: e.target.value })} />
                    </div>
                    <div style={s.formGroup}>
                      <label style={s.label}>Data uzyskania</label>
                      <input style={s.input} type="date"
                        value={formKomp.data_uzyskania} onChange={e => setFormKomp({ ...formKomp, data_uzyskania: e.target.value })} />
                    </div>
                    <div style={s.formGroup}>
                      <label style={s.label}>Data ważności</label>
                      <input style={s.input} type="date"
                        value={formKomp.data_waznosci} onChange={e => setFormKomp({ ...formKomp, data_waznosci: e.target.value })} />
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                    <button style={s.btnPrimary} onClick={dodajKompetencje}>Dodaj kompetencję</button>
                    <button style={s.btnGray} onClick={() => setPokazFormKomp(false)}>Anuluj</button>
                  </div>
                </div>
              )}
 
              {kompetencje.length === 0 ? (
                <p style={s.gray}>Brak zarejestrowanych kompetencji</p>
              ) : (
                <div style={s.tableScroll}>
                  <table style={s.table}>
                    <thead>
                      <tr>
                        <th style={s.th}>Nazwa</th>
                        <th style={s.th}>Typ</th>
                        <th style={s.th}>Nr dokumentu</th>
                        <th style={s.th}>Data uzyskania</th>
                        <th style={s.th}>Ważność</th>
                        {mozeEdytowac && <th style={s.th}></th>}
                      </tr>
                    </thead>
                    <tbody>
                      {kompetencje.map((k, i) => {
                        const waznosc = isWazna(k.data_waznosci);
                        return (
                          <tr key={k.id} style={{ backgroundColor: i % 2 === 0 ? 'var(--bg-card)' : 'var(--bg-deep)' }}>
                            <td style={{ ...s.td, fontWeight: '600' }}>{k.nazwa}</td>
                            <td style={s.td}>{k.typ}</td>
                            <td style={s.td}>{k.nr_dokumentu || '—'}</td>
                            <td style={s.td}>{k.data_uzyskania ? k.data_uzyskania.split('T')[0] : '—'}</td>
                            <td style={s.td}>
                              {k.data_waznosci ? (
                                <span style={{ ...s.waznosc, backgroundColor: waznosc === 'expired' ? '#FFEBEE' : waznosc === 'soon' ? '#FFF8E1' : 'rgba(52,211,153,0.1)', color: waznosc === 'expired' ? '#C62828' : waznosc === 'soon' ? '#F57F17' : 'var(--accent)' }}>
                                  {waznosc === 'expired' ? '⚠️ ' : waznosc === 'soon' ? '⏰ ' : '✅ '}
                                  {k.data_waznosci.split('T')[0]}
                                </span>
                              ) : <span style={s.gray}>bezterminowo</span>}
                            </td>
                            {mozeEdytowac && (
                              <td style={s.td}>
                                <button style={{ ...s.btnSm, backgroundColor: 'rgba(248,113,113,0.1)', color: '#C62828' }}
                                  onClick={() => usunKompetencje(k.id)}>🗑</button>
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
 
        {/* ===== NOWY / EDYTUJ ===== */}
        {(tryb === 'nowy' || tryb === 'edytuj') && (
          <>
            <div style={s.headerRow}>
              <div style={s.breadcrumb}>
                <button style={s.backBtn} onClick={() => setTryb(wybranyUser ? 'szczegoly' : 'lista')}>← Powrót</button>
                <h1 style={s.title}>{tryb === 'nowy' ? '➕ Nowy użytkownik' : `✏️ Edytuj: ${wybranyUser?.imie} ${wybranyUser?.nazwisko}`}</h1>
              </div>
            </div>
 
            <div style={s.card}>
              <div style={s.cardTitle}>👤 Dane podstawowe</div>
              <div style={s.formGrid}>
                {tryb === 'nowy' && (
                  <div style={s.formGroup}>
                    <label style={s.label}>Login *</label>
                    <input style={s.input} placeholder="Unikalny login"
                      value={form.login} onChange={e => setForm({ ...form, login: e.target.value })} />
                  </div>
                )}
                {tryb === 'nowy' && (
                  <div style={s.formGroup}>
                    <label style={s.label}>Hasło *</label>
                    <input style={s.input} type="password" placeholder="Min. 6 znaków"
                      value={form.haslo} onChange={e => setForm({ ...form, haslo: e.target.value })} />
                  </div>
                )}
                <div style={s.formGroup}>
                  <label style={s.label}>Imię *</label>
                  <input style={s.input} placeholder="Imię"
                    value={form.imie} onChange={e => setForm({ ...form, imie: e.target.value })} />
                </div>
                <div style={s.formGroup}>
                  <label style={s.label}>Nazwisko *</label>
                  <input style={s.input} placeholder="Nazwisko"
                    value={form.nazwisko} onChange={e => setForm({ ...form, nazwisko: e.target.value })} />
                </div>
                <div style={s.formGroup}>
                  <label style={s.label}>Email</label>
                  <input style={s.input} type="email" placeholder="email@firma.pl"
                    value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
                </div>
                <div style={s.formGroup}>
                  <label style={s.label}>Telefon</label>
                  <input style={s.input} placeholder="+48 000 000 000"
                    value={form.telefon} onChange={e => setForm({ ...form, telefon: e.target.value })} />
                </div>
                <div style={s.formGroup}>
                  <label style={s.label}>Rola</label>
                  <select style={s.input} value={form.rola} onChange={e => setForm({ ...form, rola: e.target.value })}>
                    {isDyrektor && <option value="Dyrektor">Dyrektor</option>}
                    {isDyrektor && <option value="Administrator">Administrator</option>}
                    {isDyrektor && <option value="Kierownik">Kierownik</option>}
                    <option value="Brygadzista">Brygadzista</option>
                    <option value="Specjalista">Specjalista</option>
                    {isDyrektor && <option value="Wyceniający">Wyceniający</option>}
                    <option value="Pomocnik">Pomocnik</option>
                    <option value="Pomocnik bez doświadczenia">Pomocnik bez doświadczenia</option>
                    <option value="Magazynier">Magazynier</option>
                  </select>
                </div>
                {isDyrektor && (
                  <div style={s.formGroup}>
                    <label style={s.label}>Oddział</label>
                    <select style={s.input} value={form.oddzial_id} onChange={e => setForm({ ...form, oddzial_id: e.target.value })}>
                      <option value="">— brak —</option>
                      {oddzialy.map(o => <option key={o.id} value={o.id}>🏢 {o.nazwa}</option>)}
                    </select>
                  </div>
                )}
                <div style={s.formGroup}>
                  <label style={s.label}>Stanowisko</label>
                  <input style={s.input} placeholder="np. Arborystą"
                    value={form.stanowisko} onChange={e => setForm({ ...form, stanowisko: e.target.value })} />
                </div>
                <div style={s.formGroup}>
                  <label style={s.label}>Data zatrudnienia</label>
                  <input style={s.input} type="date"
                    value={form.data_zatrudnienia} onChange={e => setForm({ ...form, data_zatrudnienia: e.target.value })} />
                </div>
              </div>
            </div>
 
            {isDyrektor && (
              <div style={s.card}>
                <div style={s.cardTitle}>💰 Dane finansowe</div>
                <div style={s.formGrid}>
                  <div style={s.formGroup}>
                    <label style={s.label}>Stawka godzinowa (PLN/h)</label>
                    <input style={s.input} type="number" step="0.01" placeholder="0.00"
                      value={form.stawka_godzinowa} onChange={e => setForm({ ...form, stawka_godzinowa: e.target.value })} />
                  </div>
                  <div style={s.formGroup}>
                    <label style={s.label}>Procent wynagrodzenia (%)</label>
                    <input style={s.input} type="number" step="0.1" placeholder="15"
                      value={form.procent_wynagrodzenia} onChange={e => setForm({ ...form, procent_wynagrodzenia: e.target.value })} />
                  </div>
                </div>
              </div>
            )}
 
            <div style={s.card}>
              <div style={s.cardTitle}>📬 Dane dodatkowe</div>
              <div style={s.formGrid}>
                <div style={{ ...s.formGroup, gridColumn: '1 / -1' }}>
                  <label style={s.label}>Adres zamieszkania</label>
                  <input style={s.input} placeholder="ul. Przykładowa 1, 00-000 Warszawa"
                    value={form.adres_zamieszkania} onChange={e => setForm({ ...form, adres_zamieszkania: e.target.value })} />
                </div>
                <div style={s.formGroup}>
                  <label style={s.label}>Kontakt awaryjny — imię</label>
                  <input style={s.input} placeholder="Imię i nazwisko"
                    value={form.kontakt_awaryjny_imie} onChange={e => setForm({ ...form, kontakt_awaryjny_imie: e.target.value })} />
                </div>
                <div style={s.formGroup}>
                  <label style={s.label}>Kontakt awaryjny — telefon</label>
                  <input style={s.input} placeholder="+48 000 000 000"
                    value={form.kontakt_awaryjny_telefon} onChange={e => setForm({ ...form, kontakt_awaryjny_telefon: e.target.value })} />
                </div>
                <div style={{ ...s.formGroup, gridColumn: '1 / -1' }}>
                  <label style={s.label}>Notatki</label>
                  <textarea style={{ ...s.input, minHeight: 80, resize: 'vertical' }} placeholder="Dodatkowe informacje..."
                    value={form.notatki} onChange={e => setForm({ ...form, notatki: e.target.value })} />
                </div>
              </div>
            </div>
 
            <div style={s.formButtons}>
              <button style={s.btnPrimary} onClick={zapiszUzytkownika}>
                {tryb === 'nowy' ? '✅ Utwórz użytkownika' : '✅ Zapisz zmiany'}
              </button>
              <button style={s.btnGray} onClick={() => setTryb(wybranyUser ? 'szczegoly' : 'lista')}>
                Anuluj
              </button>
            </div>
          </>
        )}
 
      </div>
    </div>
  );
}
 
const s = {
  container: { display: 'flex', minHeight: '100vh', backgroundColor: 'var(--bg)' },
  main: { flex: 1, padding: '24px', overflowX: 'hidden' },
  headerRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, flexWrap: 'wrap', gap: 12 },
  breadcrumb: { display: 'flex', alignItems: 'center', gap: 12 },
  title: { fontSize: 'clamp(22px, 5vw, 28px)', fontWeight: 'bold', color: 'var(--accent)', margin: 0 },
  sub: { color: 'var(--text-muted)', marginTop: 4, fontSize: 14 },
  backBtn: { padding: '6px 14px', backgroundColor: 'var(--bg-deep)', color: 'var(--accent)', border: '1px solid #A5D6A7', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: '500' },
  filtryRow: { display: 'flex', gap: 10, marginBottom: 20, alignItems: 'center', backgroundColor: 'var(--bg-card)', padding: '12px 16px', borderRadius: 12, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', flexWrap: 'wrap' },
  searchInput: { padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, minWidth: 220, flex: 1 },
  filtrInput: { padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, backgroundColor: 'var(--bg-card)' },
  clearBtn: { padding: '7px 14px', backgroundColor: 'rgba(248,113,113,0.1)', color: '#EF5350', border: '1px solid #FFCDD2', borderRadius: 8, cursor: 'pointer', fontSize: 12 },
  countBadge: { fontSize: 12, color: 'var(--text-muted)', marginLeft: 'auto', whiteSpace: 'nowrap' },
  card: { backgroundColor: 'var(--bg-card)', borderRadius: 16, padding: 20, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', marginBottom: 16 },
  cardTitle: { fontSize: 15, fontWeight: 'bold', color: 'var(--accent)', marginBottom: 16, paddingBottom: 10, borderBottom: '1px solid var(--border)' },
  twoCol: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, marginBottom: 0 },
  tableScroll: { overflowX: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse', minWidth: 500 },
  th: { padding: '11px 14px', backgroundColor: 'var(--bg-deep)', color: '#fff', textAlign: 'left', fontSize: 13, fontWeight: '600' },
  td: { padding: '11px 14px', fontSize: 13, color: 'var(--text-sub)', borderBottom: '1px solid var(--border)' },
  avatarRow: { display: 'flex', alignItems: 'center', gap: 10 },
  avatar: { width: 36, height: 36, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 13, fontWeight: 'bold', flexShrink: 0 },
  avatarBig: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 },
  avatarLarge: { width: 56, height: 56, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 20, fontWeight: 'bold', flexShrink: 0 },
  fullName: { fontWeight: '600', fontSize: 14, color: 'var(--text)' },
  loginText: { fontSize: 12, color: 'var(--text-muted)' },
  rolaBadge: { padding: '3px 10px', borderRadius: 20, color: '#fff', fontSize: 11, fontWeight: '600', display: 'inline-block' },
  statusBadge: { padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: '600', display: 'inline-block' },
  waznosc: { padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: '600', display: 'inline-block' },
  akcjeRow: { display: 'flex', gap: 6 },
  btnSm: { padding: '5px 9px', backgroundColor: 'var(--bg-deep)', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 },
  btnSmGreen: { padding: '5px 12px', backgroundColor: 'var(--bg-deep)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: '600' },
  btnPrimary: { padding: '10px 20px', backgroundColor: 'var(--bg-deep)', color: '#fff', border: 'none', borderRadius: 10, cursor: 'pointer', fontSize: 14, fontWeight: '600' },
  btnSecondary: { padding: '8px 16px', backgroundColor: 'var(--bg-deep)', color: 'var(--accent)', border: '1px solid #A5D6A7', borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: '500' },
  btnGray: { padding: '10px 20px', backgroundColor: 'var(--bg-deep)', color: 'var(--text-sub)', border: '1px solid var(--border)', borderRadius: 10, cursor: 'pointer', fontSize: 14 },
  detailRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '8px 0', borderBottom: '1px solid var(--border)', gap: 12 },
  detailLabel: { fontSize: 13, color: 'var(--text-muted)', minWidth: 140 },
  detailValue: { fontSize: 13, color: 'var(--text)', fontWeight: '500', textAlign: 'right' },
  formGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 },
  formGroup: { display: 'flex', flexDirection: 'column', gap: 5 },
  label: { fontSize: 13, fontWeight: '600', color: 'var(--text-sub)' },
  input: { padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, backgroundColor: 'var(--bg-card)', outline: 'none' },
  inlineForm: { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 },
  eyeBtn: { position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 16 },
  kompForm: { backgroundColor: 'var(--bg-card)', borderRadius: 10, padding: 16, marginBottom: 16, border: '1px solid var(--border)' },
  formButtons: { display: 'flex', gap: 12, marginTop: 8, flexWrap: 'wrap' },
  komunikat: { padding: '12px 16px', borderRadius: 10, border: '1px solid', marginBottom: 16, fontSize: 14, fontWeight: '500' },
  loading: { textAlign: 'center', padding: 60, color: 'var(--text-muted)', fontSize: 16 },
  gray: { color: 'var(--text-muted)', fontStyle: 'italic', fontSize: 13 },
};
 