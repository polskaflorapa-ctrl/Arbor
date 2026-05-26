import { useEffect, useState, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import api from '../api';
import Sidebar from '../components/Sidebar';
import StatusMessage from '../components/StatusMessage';
import ModernDataRow from '../components/ModernDataRow';
import { getApiErrorMessage } from '../utils/apiError';
import { getLocalStorageJson } from '../utils/safeJsonLocalStorage';
import { getStoredToken, authHeaders } from '../utils/storedToken';
import { getRoleDisplayName } from '../utils/roleDisplay';
import { getRolaColor } from '../theme';
import { telHref } from '../utils/telLink';
import PayrollRatesPanel from '../components/PayrollRatesPanel';
import AccountCircleOutlined from '@mui/icons-material/AccountCircleOutlined';
import DeleteOutline from '@mui/icons-material/DeleteOutline';
import EditOutlined from '@mui/icons-material/EditOutlined';
import LockOpenOutlined from '@mui/icons-material/LockOpenOutlined';
import LockOutlined from '@mui/icons-material/LockOutlined';
import VisibilityOffOutlined from '@mui/icons-material/VisibilityOffOutlined';
import VisibilityOutlined from '@mui/icons-material/VisibilityOutlined';

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
  const location = useLocation();
  const openedFromRouteRef = useRef(null);
 
  const isDyrektor = ['Prezes', 'Dyrektor'].includes(currentUser?.rola);
  const isAdmin = currentUser?.rola === 'Administrator';
  const isKierownik = currentUser?.rola === 'Kierownik';
  const isSalesDirector = [
    'Dyrektor Sprzedazy',
    'Dyrektor Sprzedaży',
    'Dyrektor dzialu sprzedaz',
    'Dyrektor działu sprzedaż',
  ].includes(currentUser?.rola);
  const mozeEdytowac = isDyrektor || isAdmin || isKierownik;
  const mozePrzenosicSpecjalistow = isDyrektor || isSalesDirector;
  const mozePrzeniescUsera = (u) => mozePrzenosicSpecjalistow && u?.rola === 'Specjalista';
 
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

  /** Otwórz kartę z `/uzytkownicy/:id` (stan z UzytkownikDetail). */
  useEffect(() => {
    const ouid = location.state?.openUserId;
    if (!ouid) {
      openedFromRouteRef.current = null;
      return;
    }
    if (openedFromRouteRef.current === ouid) return;
    if (uzytkownicy.length === 0) return;

    const finish = (u) => {
      openedFromRouteRef.current = ouid;
      void otworzSzczegoly(u).finally(() => {
        navigate('/uzytkownicy', { replace: true, state: {} });
      });
    };

    const fromList = uzytkownicy.find((x) => Number(x.id) === Number(ouid));
    if (fromList) {
      finish(fromList);
      return;
    }

    const token = getStoredToken();
    void api
      .get(`/uzytkownicy/${ouid}`, { headers: authHeaders(token) })
      .then((r) => finish(r.data))
      .catch(() => {
        openedFromRouteRef.current = null;
        pokazKomunikat('Nie znaleziono użytkownika lub brak dostępu.', 'error');
        navigate('/uzytkownicy', { replace: true, state: {} });
      });
    // otworzSzczegoly / pokazKomunikat — stabilne względem renderu
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state, uzytkownicy, navigate]);
 
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

  const przeniesSpecjaliste = async (userId, oddzialId) => {
    if (!oddzialId) return;
    try {
      const token = getStoredToken();
      const { data } = await api.patch(
        `/uzytkownicy/${userId}/oddzial`,
        { oddzial_id: Number(oddzialId) },
        { headers: authHeaders(token) }
      );
      pokazKomunikat('Specjalista przeniesiony do wybranego oddzialu');
      setUzytkownicy(prev => prev.map(u => u.id === userId ? { ...u, ...data } : u));
      if (wybranyUser?.id === userId) setWybranyUser(prev => ({ ...prev, ...data }));
    } catch (err) {
      pokazKomunikat(getApiErrorMessage(err, 'Nie udalo sie przeniesc specjalisty'), 'error');
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
          message={komunikat.tekst ? `${komunikat.typ === 'error' ? 'Błąd: ' : ''}${komunikat.tekst}` : ''}
          style={s.komunikat}
        />
 
        {/* ===== LISTA ===== */}
        {tryb === 'lista' && (
          <>
            <div style={s.headerRow}>
              <div>
                <h1 style={s.title}>Użytkownicy</h1>
                <p style={s.sub}>Zarządzanie pracownikami i uprawnieniami</p>
              </div>
              {mozeEdytowac && (
                <button style={s.btnPrimary} onClick={otworzNowy}>+ Nowy użytkownik</button>
              )}
            </div>

            <div style={s.filtryRow}>
              <input style={s.searchInput} placeholder="Szukaj po imieniu, loginie, emailu..."
                value={szukaj} onChange={e => setSzukaj(e.target.value)} />
              <select style={s.filtrInput} value={filtrRola} onChange={e => setFiltrRola(e.target.value)}>
                <option value="">Wszystkie role</option>
                <option value="Prezes">Prezes</option>
                <option value="Dyrektor">Dyrektor</option>
                <option value="Dyrektor Sprzedaży">Dyrektor sprzedaży</option>
                <option value="Administrator">Administrator</option>
                <option value="Kierownik">Kierownik</option>
                <option value="Brygadzista">Brygadzista</option>
                <option value="Specjalista">Specjalista</option>
                <option value="Wyceniający">Specjalista ds. wyceny</option>
                <option value="Pomocnik">Pomocnik</option>
                <option value="Pomocnik bez doświadczenia">Pomocnik bez doświadczenia</option>
                <option value="Magazynier">Magazynier</option>
              </select>
              {(isDyrektor || isSalesDirector) && (
                <select style={s.filtrInput} value={filtrOddzial} onChange={e => setFiltrOddzial(e.target.value)}>
                  <option value="">Wszystkie oddziały</option>
                  {oddzialy.map(o => <option key={o.id} value={o.id}>{o.nazwa}</option>)}
                </select>
              )}
              {(filtrRola || filtrOddzial || szukaj) && (
                <button style={s.clearBtn} onClick={() => { setFiltrRola(''); setFiltrOddzial(''); setSzukaj(''); }}>
                  Wyczyść
                </button>
              )}
              <span style={s.countBadge}>{filtrowane.length} / {uzytkownicy.length}</span>
            </div>

            {loading ? (
              <div style={s.loading}>Ładowanie...</div>
            ) : (
              <div style={s.listCardsWrap}>
                {filtrowane.length === 0 ? (
                  <div style={{ ...s.card, textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                    Brak użytkowników spełniających kryteria
                  </div>
                ) : (
                  <div style={s.listCardsGrid}>
                    {filtrowane.map((u) => (
                      <div key={u.id} style={s.userListCard} onClick={() => otworzSzczegoly(u)}>
                        <div style={s.userListTop}>
                          <div style={s.avatarRow}>
                            <div style={{ ...s.avatar, backgroundColor: getRolaColor(u.rola) }}>
                              {u.imie?.[0]}{u.nazwisko?.[0]}
                            </div>
                            <div>
                              <div style={s.fullName}>{u.imie} {u.nazwisko}</div>
                              <div style={s.loginText}>@{u.login}</div>
                            </div>
                          </div>
                          <div style={s.akcjeRow} onClick={(e) => e.stopPropagation()}>
                            <button style={s.actionIconBtn} title="Szczegóły" aria-label="Szczegóły użytkownika" onClick={() => otworzSzczegoly(u)}>
                              <VisibilityOutlined style={s.iconSm} />
                            </button>
                            <button style={s.actionIconBtn} title="Profil pracownika" aria-label="Profil pracownika" onClick={() => navigate(`/profil/${u.id}`)}>
                              <AccountCircleOutlined style={s.iconSm} />
                            </button>
                            {mozeEdytowac && (
                              <>
                                <button style={s.actionIconBtn} title="Edytuj" aria-label="Edytuj użytkownika" onClick={() => otworzEdycje(u)}>
                                  <EditOutlined style={s.iconSm} />
                                </button>
                                <button
                                  style={{ ...s.actionIconBtn, ...(u.aktywny ? s.actionIconBtnDanger : s.actionIconBtnSuccess) }}
                                  title={u.aktywny ? 'Dezaktywuj' : 'Aktywuj'}
                                  aria-label={u.aktywny ? 'Dezaktywuj użytkownika' : 'Aktywuj użytkownika'}
                                  onClick={() => zmienAktywnosc(u.id, !u.aktywny)}>
                                  {u.aktywny ? <LockOutlined style={s.iconSm} /> : <LockOpenOutlined style={s.iconSm} />}
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                        <div style={s.userListMetaRow}>
                          <span style={{ ...s.rolaBadge, backgroundColor: getRolaColor(u.rola) }}>{getRoleDisplayName(u.rola)}</span>
                          <span style={s.userListBranch}>{u.oddzial_nazwa || '—'}</span>
                        </div>
                        {mozePrzeniescUsera(u) && (
                          <select
                            style={s.transferSelect}
                            value={u.oddzial_id || ''}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => {
                              e.stopPropagation();
                              przeniesSpecjaliste(u.id, e.target.value);
                            }}
                          >
                            <option value="">Przenies do oddzialu...</option>
                            {oddzialy.map(o => <option key={o.id} value={o.id}>{o.nazwa}</option>)}
                          </select>
                        )}
                        <div style={s.userListContact}>{u.email || '—'}</div>
                        <div style={s.userListContactMuted}>
                          {u.telefon ? (
                            telHref(u.telefon) ? (
                              <a href={telHref(u.telefon)} onClick={(e) => e.stopPropagation()} style={{ color: 'var(--accent)', fontWeight: 600, textDecoration: 'none' }}>
                                {u.telefon}
                              </a>
                            ) : (
                              u.telefon
                            )
                          ) : (
                            '—'
                          )}
                        </div>
                        <div style={s.userListBottom}>
                          <span style={{
                            ...s.statusBadge,
                            backgroundColor: u.aktywny ? 'var(--accent-surface)' : 'rgba(248,113,113,0.12)',
                            color: u.aktywny ? 'var(--accent-dk)' : 'var(--danger)',
                            border: `1px solid ${u.aktywny ? 'var(--logo-tint-border)' : 'rgba(248,113,113,0.35)'}`
                          }}>
                            {u.aktywny ? 'Aktywny' : 'Nieaktywny'}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
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
                <h1 style={s.title}>{wybranyUser.imie} {wybranyUser.nazwisko}</h1>
              </div>
              {mozeEdytowac && (
                <div style={s.headerActions}>
                  <button style={s.btnSecondary} onClick={() => navigate(`/profil/${wybranyUser.id}`)}>Profil pracownika</button>
                  <button style={s.btnSecondary} onClick={() => otworzEdycje(wybranyUser)}>Edytuj</button>
                  <button style={{ ...s.btnSecondary, backgroundColor: wybranyUser.aktywny ? 'rgba(248,113,113,0.12)' : 'var(--accent-surface)', color: wybranyUser.aktywny ? 'var(--danger)' : 'var(--accent-dk)' }}
                    onClick={() => zmienAktywnosc(wybranyUser.id, !wybranyUser.aktywny)}>
                    {wybranyUser.aktywny ? 'Dezaktywuj' : 'Aktywuj'}
                  </button>
                </div>
              )}
            </div>
 
            <div style={s.twoCol}>
              <div style={s.card}>
                <div style={s.cardTitle}>Dane podstawowe</div>
                <div style={s.avatarBig}>
                  <div style={{ ...s.avatarLarge, backgroundColor: getRolaColor(wybranyUser.rola) }}>
                    {wybranyUser.imie?.[0]}{wybranyUser.nazwisko?.[0]}
                  </div>
                  <span style={{ ...s.rolaBadge, backgroundColor: getRolaColor(wybranyUser.rola), fontSize: 13 }}>
                    {getRoleDisplayName(wybranyUser.rola)}
                  </span>
                </div>
                {[
                  { label: 'Login', value: `@${wybranyUser.login}` },
                  { label: 'Imię i nazwisko', value: `${wybranyUser.imie} ${wybranyUser.nazwisko}` },
                  { label: 'Email', value: wybranyUser.email },
                  { label: 'Telefon', value: wybranyUser.telefon, kind: 'tel' },
                  { label: 'Oddział', value: wybranyUser.oddzial_nazwa },
                  { label: 'Stanowisko', value: wybranyUser.stanowisko },
                  { label: 'Data zatrudnienia', value: wybranyUser.data_zatrudnienia ? wybranyUser.data_zatrudnienia.split('T')[0] : null },
                  { label: 'Status', value: wybranyUser.aktywny ? 'Aktywny' : 'Nieaktywny' },
                ].map((row) => {
                  if (!row.value && row.value !== 0) return null;
                  const display =
                    row.kind === 'tel' && telHref(row.value) ? (
                      <a href={telHref(row.value)} style={{ color: 'var(--accent)', fontWeight: 600, textDecoration: 'none' }}>
                        {row.value}
                      </a>
                    ) : (
                      row.value
                    );
                  return (
                    <div key={row.label} style={s.detailRow}>
                      <span style={s.detailLabel}>{row.label}</span>
                      <span style={s.detailValue}>{display}</span>
                    </div>
                  );
                })}
                {mozePrzeniescUsera(wybranyUser) && (
                  <div style={{ ...s.inlineForm, marginTop: 14 }}>
                    <label style={s.label}>Przenies do oddzialu</label>
                    <select
                      style={s.input}
                      value={wybranyUser.oddzial_id || ''}
                      onChange={(e) => przeniesSpecjaliste(wybranyUser.id, e.target.value)}
                    >
                      <option value="">Wybierz oddzial</option>
                      {oddzialy.map(o => <option key={o.id} value={o.id}>{o.nazwa}</option>)}
                    </select>
                  </div>
                )}
              </div>
 
              <div>
                {isDyrektor && (
                  <div style={{ ...s.card, marginBottom: 16 }}>
                    <div style={s.cardTitle}>Dane finansowe</div>
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

                <PayrollRatesPanel
                  userId={wybranyUser.id}
                  allowEdit={mozeEdytowac}
                  onMessage={(tekst, typ) => pokazKomunikat(tekst, typ || 'success')}
                />
 
                <div style={{ ...s.card, marginBottom: 16 }}>
                  <div style={s.cardTitle}>Kontakt awaryjny</div>
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
                          <span style={s.detailValue}>
                            {telHref(wybranyUser.kontakt_awaryjny_telefon) ? (
                              <a href={telHref(wybranyUser.kontakt_awaryjny_telefon)} style={{ color: 'var(--accent)', fontWeight: 600, textDecoration: 'none' }}>
                                {wybranyUser.kontakt_awaryjny_telefon}
                              </a>
                            ) : (
                              wybranyUser.kontakt_awaryjny_telefon
                            )}
                          </span>
                        </div>
                      )}
                    </>
                  ) : <p style={s.gray}>Brak danych</p>}
                </div>
 
                {wybranyUser.adres_zamieszkania && (
                  <div style={{ ...s.card, marginBottom: 16 }}>
                    <div style={s.cardTitle}>Adres zamieszkania</div>
                    <p style={{ margin: 0, fontSize: 14 }}>{wybranyUser.adres_zamieszkania}</p>
                  </div>
                )}
 
                {wybranyUser.notatki && (
                  <div style={s.card}>
                    <div style={s.cardTitle}>Notatki</div>
                    <p style={{ margin: 0, fontSize: 14, whiteSpace: 'pre-wrap' }}>{wybranyUser.notatki}</p>
                  </div>
                )}
              </div>
            </div>
 
            {/* Zmiana hasła */}
            {isDyrektor && (
              <div style={s.card}>
                <div style={s.cardTitle}>Zmiana hasła</div>
                {!pokazFormHaslo ? (
                  <button style={s.btnSecondary} onClick={() => setPokazFormHaslo(true)}>Zmień hasło</button>
                ) : (
                  <div style={s.inlineForm}>
                    <div style={{ position: 'relative' }}>
                      <input style={{ ...s.input, paddingRight: 40 }} type={pokazHaslo ? 'text' : 'password'}
                        placeholder="Nowe hasło (min. 6 znaków)"
                        value={noweHaslo} onChange={e => setNoweHaslo(e.target.value)} />
                      <button style={s.eyeBtn} onClick={() => setPokazHaslo(!pokazHaslo)}>
                        {pokazHaslo ? <VisibilityOffOutlined style={s.iconSm} /> : <VisibilityOutlined style={s.iconSm} />}
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
                <span>Kompetencje ({kompetencje.length})</span>
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
                <div className="modern-data-stack">
                  {kompetencje.map((k) => {
                    const waznosc = isWazna(k.data_waznosci);
                    return (
                      <ModernDataRow
                        key={k.id}
                        idLabel="Competency ID"
                        idValue={`COMP-${k.id}`}
                        title={k.nazwa}
                        subtitle={k.nr_dokumentu || 'Brak numeru dokumentu'}
                        tone={waznosc === 'expired' ? 'danger' : waznosc === 'soon' ? 'warning' : 'success'}
                        status={waznosc === 'expired' ? 'WYGASŁO' : waznosc === 'soon' ? 'DO ODNOWIENIA' : 'AKTYWNA'}
                        statusValue={waznosc}
                        statusState={waznosc === 'expired' ? 'danger' : waznosc === 'soon' ? 'warning' : 'success'}
                        metrics={[
                          { label: 'Typ', value: k.typ, mono: false },
                          { label: 'Data uzyskania', value: k.data_uzyskania ? k.data_uzyskania.split('T')[0] : 'brak' },
                          { label: 'Ważność', value: k.data_waznosci ? k.data_waznosci.split('T')[0] : 'bezterminowo', tone: waznosc === 'expired' ? 'danger' : waznosc === 'soon' ? 'warning' : 'success' },
                        ]}
                        actions={
                          mozeEdytowac ? (
                            <button
                              style={{ ...s.actionIconBtn, ...s.actionIconBtnDanger }}
                              title="Usuń kompetencję"
                              aria-label="Usuń kompetencję"
                              onClick={() => usunKompetencje(k.id)}
                            >
                              <DeleteOutline style={s.iconSm} />
                            </button>
                          ) : null
                        }
                      />
                    );
                  })}
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
                <h1 style={s.title}>{tryb === 'nowy' ? 'Nowy użytkownik' : `Edytuj użytkownika: ${wybranyUser?.imie} ${wybranyUser?.nazwisko}`}</h1>
              </div>
            </div>
 
            <div style={s.card}>
              <div style={s.cardTitle}>Dane podstawowe</div>
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
                    {isDyrektor && <option value="Prezes">Prezes</option>}
                    {isDyrektor && <option value="Dyrektor">Dyrektor</option>}
                    {isDyrektor && <option value="Dyrektor Sprzedaży">Dyrektor sprzedaży</option>}
                    {isDyrektor && <option value="Administrator">Administrator</option>}
                    {isDyrektor && <option value="Kierownik">Kierownik</option>}
                    <option value="Brygadzista">Brygadzista</option>
                    <option value="Specjalista">Specjalista</option>
                    {isDyrektor && <option value="Wyceniający">Specjalista ds. wyceny</option>}
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
                      {oddzialy.map(o => <option key={o.id} value={o.id}>{o.nazwa}</option>)}
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
                <div style={s.cardTitle}>Dane finansowe</div>
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
              <div style={s.cardTitle}>Dane dodatkowe</div>
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
                {tryb === 'nowy' ? 'Utwórz użytkownika' : 'Zapisz zmiany'}
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
  breadcrumb: { display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flexWrap: 'wrap' },
  headerActions: { display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' },
  title: { fontSize: 'clamp(22px, 5vw, 28px)', fontWeight: 'bold', color: 'var(--accent)', margin: 0 },
  sub: { color: 'var(--text-muted)', marginTop: 4, fontSize: 14 },
  backBtn: { padding: '6px 14px', backgroundColor: 'var(--bg-deep)', color: 'var(--accent)', border: '1px solid var(--logo-tint-border)', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: '500' },
  filtryRow: { display: 'flex', gap: 10, marginBottom: 20, alignItems: 'center', background: 'var(--surface-glass)', padding: '12px 16px', borderRadius: 8, boxShadow: 'var(--shadow-md)', border: '1px solid var(--glass-border)', flexWrap: 'wrap' },
  searchInput: { padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, minWidth: 220, flex: 1 },
  filtrInput: { padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, backgroundColor: 'var(--surface-field)' },
  clearBtn: { padding: '7px 14px', backgroundColor: 'rgba(248,113,113,0.1)', color: 'var(--danger)', border: '1px solid rgba(248,113,113,0.35)', borderRadius: 8, cursor: 'pointer', fontSize: 12 },
  countBadge: { fontSize: 12, color: 'var(--text-muted)', marginLeft: 'auto', whiteSpace: 'nowrap' },
  card: { background: 'var(--surface-glass)', border: '1px solid var(--glass-border)', borderRadius: 8, padding: 20, boxShadow: 'var(--shadow-md)', marginBottom: 16 },
  listCardsWrap: { display: 'flex', flexDirection: 'column', gap: 10 },
  listCardsGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 340px), 1fr))', gap: 14 },
  userListCard: {
    background: 'var(--surface-glass)',
    border: '1px solid var(--glass-border)',
    borderRadius: 8,
    boxShadow: 'var(--shadow-md)',
    padding: 14,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    cursor: 'pointer',
    minWidth: 0,
    overflow: 'hidden',
  },
  userListTop: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', alignItems: 'flex-start', gap: 10 },
  userListMetaRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  userListBranch: { fontSize: 12, color: 'var(--text-sub)', fontWeight: 600 },
  transferSelect: { padding: '7px 9px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 12, backgroundColor: 'var(--surface-field)', color: 'var(--text)', width: '100%' },
  userListContact: { fontSize: 12, color: 'var(--text)', fontWeight: 500 },
  userListContactMuted: { fontSize: 12, color: 'var(--text-muted)' },
  userListBottom: { display: 'flex', justifyContent: 'flex-end' },
  cardTitle: { fontSize: 14, fontWeight: '800', color: 'var(--text)', marginBottom: 16, paddingBottom: 10, borderBottom: '1px solid var(--border)', letterSpacing: 0 },
  twoCol: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, marginBottom: 0 },
  tableScroll: { overflowX: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse', minWidth: 500 },
  th: { padding: '11px 14px', backgroundColor: 'var(--surface-field)', color: 'var(--text-muted)', textAlign: 'left', fontSize: 13, fontWeight: '700' },
  td: { padding: '11px 14px', fontSize: 13, color: 'var(--text-sub)', borderBottom: '1px solid var(--border)' },
  avatarRow: { display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 },
  avatar: { width: 36, height: 36, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 13, fontWeight: 'bold', flexShrink: 0 },
  avatarBig: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 },
  avatarLarge: { width: 56, height: 56, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 20, fontWeight: 'bold', flexShrink: 0 },
  fullName: { fontWeight: '700', fontSize: 14, color: 'var(--text)', lineHeight: 1.25, overflowWrap: 'anywhere' },
  loginText: { fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 170 },
  rolaBadge: { padding: '3px 10px', borderRadius: 20, color: '#fff', fontSize: 11, fontWeight: '600', display: 'inline-block' },
  statusBadge: { padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: '600', display: 'inline-block' },
  waznosc: { padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: '600', display: 'inline-block' },
  akcjeRow: { display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap', flexShrink: 0, maxWidth: 168 },
  actionIconBtn: {
    width: 36,
    height: 36,
    minWidth: 36,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
    backgroundColor: 'var(--surface-field)',
    color: 'var(--accent)',
    border: '1px solid var(--logo-tint-border)',
    borderRadius: 8,
    cursor: 'pointer',
    lineHeight: 1,
  },
  actionIconBtnDanger: { backgroundColor: 'rgba(248,113,113,0.12)', color: 'var(--danger)', border: '1px solid rgba(248,113,113,0.35)' },
  actionIconBtnSuccess: { backgroundColor: 'var(--accent-surface)', color: 'var(--accent-dk)', border: '1px solid var(--logo-tint-border)' },
  iconSm: { fontSize: 18, display: 'block' },
  btnSm: { padding: '5px 9px', backgroundColor: 'var(--surface-field)', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', fontSize: 13 },
  btnSmGreen: { padding: '5px 12px', background: 'linear-gradient(180deg, var(--accent), var(--accent-dk))', color: '#fff', border: '1px solid var(--accent-dk)', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: '700', boxShadow: 'var(--shadow-sm)' },
  btnPrimary: { padding: '10px 20px', background: 'linear-gradient(180deg, var(--accent), var(--accent-dk))', color: '#fff', border: '1px solid var(--accent-dk)', borderRadius: 10, cursor: 'pointer', fontSize: 14, fontWeight: '700', boxShadow: 'var(--shadow-sm)' },
  btnSecondary: { padding: '8px 16px', backgroundColor: 'var(--surface-field)', color: 'var(--accent)', border: '1px solid var(--logo-tint-border)', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: '500' },
  btnGray: { padding: '10px 20px', backgroundColor: 'var(--surface-field)', color: 'var(--text-sub)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', fontSize: 14 },
  detailRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '8px 0', borderBottom: '1px solid var(--border)', gap: 12 },
  detailLabel: { fontSize: 13, color: 'var(--text-muted)', minWidth: 140 },
  detailValue: { fontSize: 13, color: 'var(--text)', fontWeight: '500', textAlign: 'right' },
  formGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 },
  formGroup: { display: 'flex', flexDirection: 'column', gap: 5 },
  label: { fontSize: 13, fontWeight: '600', color: 'var(--text-sub)' },
  input: { padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, backgroundColor: 'var(--surface-field)', outline: 'none' },
  inlineForm: { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 },
  eyeBtn: { position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 16 },
  kompForm: { backgroundColor: 'var(--surface-field)', borderRadius: 8, padding: 16, marginBottom: 16, border: '1px solid var(--border)' },
  formButtons: { display: 'flex', gap: 12, marginTop: 8, flexWrap: 'wrap' },
  komunikat: { padding: '12px 16px', borderRadius: 10, borderWidth: 1, borderStyle: 'solid', marginBottom: 16, fontSize: 14, fontWeight: '500' },
  loading: { textAlign: 'center', padding: 60, color: 'var(--text-muted)', fontSize: 16 },
  gray: { color: 'var(--text-muted)', fontStyle: 'italic', fontSize: 13 },
};
