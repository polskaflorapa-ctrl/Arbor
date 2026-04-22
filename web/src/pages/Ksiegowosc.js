import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../api';
import Sidebar from '../components/Sidebar';
import StatusMessage from '../components/StatusMessage';
import PageHeader from '../components/PageHeader';
import CityInput from '../components/CityInput';
import ReceiptLongOutlined from '@mui/icons-material/ReceiptLongOutlined';
import DescriptionOutlined from '@mui/icons-material/DescriptionOutlined';
import PaymentsOutlined from '@mui/icons-material/PaymentsOutlined';
import CheckCircleOutline from '@mui/icons-material/CheckCircleOutline';
import HourglassEmptyOutlined from '@mui/icons-material/HourglassEmptyOutlined';
import WarningAmberOutlined from '@mui/icons-material/WarningAmberOutlined';
import { getApiErrorMessage } from '../utils/apiError';
import { errorMessage, successMessage } from '../utils/statusMessage';
import useTimedMessage from '../hooks/useTimedMessage';
import { getLocalStorageJson } from '../utils/safeJsonLocalStorage';
import { getStoredToken, authHeaders } from '../utils/storedToken';


const STATUS_KOLOR = {
  Nieoplacona: '#F9A825',
  Oplacona: '#4CAF50',
  Przeterminowana: '#EF5350',
  Anulowana: '#9CA3AF',
};

export default function Ksiegowosc() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [tab, setTab] = useState('faktury');
  const [faktury, setFaktury] = useState([]);
  const [stats, setStats] = useState({});
  const [oddzialy, setOddzialy] = useState([]);
  const [zlecenia, setZlecenia] = useState([]);
  const [saving, setSaving] = useState(false);
  const { message: msg, showMessage: showMsg } = useTimedMessage();
  const [currentUser, setCurrentUser] = useState(null);
  const [filtrStatus, setFiltrStatus] = useState('');
  const [filtrOddzial, setFiltrOddzial] = useState('');
  const [filtrRok, setFiltrRok] = useState(new Date().getFullYear());
  const [ustawienia, setUstawienia] = useState({
    nazwa: '', nip: '', adres: '', kod_pocztowy: '',
    miasto: '', konto_bankowe: '', bank_nazwa: '', email: '', telefon: ''
  });

  const [form, setForm] = useState({
    klient_nazwa: '', klient_nip: '', klient_adres: '',
    klient_email: '', klient_typ: 'firma',
    data_wystawienia: new Date().toISOString().split('T')[0],
    data_sprzedazy: new Date().toISOString().split('T')[0],
    termin_platnosci: '',
    forma_platnosci: 'przelew',
    task_id: '', uwagi: '',
    pozycje: [
      { nazwa: '', jednostka: 'szt', ilosc: 1, cena_netto: '', vat_stawka: 23 }
    ]
  });

  const loadAll = useCallback(async () => {
    try {
      const token = getStoredToken();
      const h = authHeaders(token);
      const [fRes, sRes, oRes, zRes, uRes] = await Promise.all([
        api.get(`/ksiegowosc/faktury`, { headers: h }),
        api.get(`/ksiegowosc/faktury/stats`, { headers: h }),
        api.get(`/oddzialy`, { headers: h }),
        api.get(`/tasks/wszystkie`, { headers: h }),
        api.get(`/ksiegowosc/ustawienia`, { headers: h }),
      ]);
      setFaktury(fRes.data);
      setStats(sRes.data);
      setOddzialy(oRes.data);
      setZlecenia(zRes.data);
      if (uRes.data) setUstawienia(prev => ({ ...prev, ...uRes.data }));
    } catch (err) {
      console.log('Błąd ładowania:', err);
      showMsg(errorMessage('Błąd ładowania danych'));
    }
  }, [showMsg]);

  useEffect(() => {
    const token = getStoredToken();
    if (!token) { navigate('/'); return; }
    const u = getLocalStorageJson('user');
    if (u) setCurrentUser(u);
    loadAll();
  }, [navigate, loadAll]);

  const isDyrektor = currentUser?.rola === 'Dyrektor' || currentUser?.rola === 'Administrator';
  const isKierownik = currentUser?.rola === 'Kierownik';

  const filtrowane = faktury.filter(f => {
    if (filtrStatus && f.status !== filtrStatus) return false;
    if (filtrOddzial && f.oddzial_id?.toString() !== filtrOddzial) return false;
    if (filtrRok && new Date(f.data_wystawienia).getFullYear() !== filtrRok) return false;
    return true;
  });

  const saveUstawienia = async () => {
    setSaving(true);
    try {
      const token = getStoredToken();
      await api.put(`/ksiegowosc/ustawienia`, ustawienia, {
        headers: authHeaders(token)
      });
      showMsg(successMessage('Ustawienia zapisane!'));
    } catch (err) {
      showMsg(errorMessage('Błąd zapisu'));
    } finally {
      setSaving(false);
    }
  };

  const pobierzFakturePdf = async (fakturaId) => {
    try {
      const res = await api.get(`/pdf/faktura/${fakturaId}`, { responseType: 'blob' });
      const blobUrl = window.URL.createObjectURL(res.data);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = `faktura-${fakturaId}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      showMsg(errorMessage(getApiErrorMessage(err, 'Nie udało się pobrać PDF faktury.')));
    }
  };

  const zmienStatus = async (id, status) => {
    try {
      const token = getStoredToken();
      await api.put(`/ksiegowosc/faktury/${id}/status`, { status }, {
        headers: authHeaders(token)
      });
      showMsg(successMessage(`Status zmieniony na ${status}`));
      loadAll();
    } catch (err) {
      showMsg(errorMessage('Błąd zmiany statusu'));
    }
  };

  const dodajPozycje = () => {
    setForm(f => ({
      ...f,
      pozycje: [...f.pozycje, { nazwa: '', jednostka: 'szt', ilosc: 1, cena_netto: '', vat_stawka: 23 }]
    }));
  };

  const usunPozycje = (idx) => {
    setForm(f => ({ ...f, pozycje: f.pozycje.filter((_, i) => i !== idx) }));
  };

  const updatePozycja = (idx, field, value) => {
    setForm(f => {
      const p = [...f.pozycje];
      p[idx] = { ...p[idx], [field]: value };
      return { ...f, pozycje: p };
    });
  };

  const wypelnijZZlecenia = (taskId) => {
    const z = zlecenia.find(z => z.id === parseInt(taskId));
    if (!z) return;
    setForm(f => ({
      ...f,
      task_id: taskId,
      klient_nazwa: z.klient_nazwa || '',
      klient_adres: z.adres + (z.miasto ? ', ' + z.miasto : ''),
      pozycje: [{
        nazwa: z.typ_uslugi || 'Usługa',
        jednostka: 'usł',
        ilosc: 1,
        cena_netto: z.wartosc_planowana || '',
        vat_stawka: 23
      }]
    }));
  };

  const handleSaveFaktura = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const token = getStoredToken();
      const res = await api.post(`/ksiegowosc/faktury`, form, {
        headers: authHeaders(token)
      });
      showMsg(successMessage(`Faktura ${res.data.numer} utworzona!`));
      setTab('faktury');
      loadAll();
      setForm({
        klient_nazwa: '', klient_nip: '', klient_adres: '',
        klient_email: '', klient_typ: 'firma',
        data_wystawienia: new Date().toISOString().split('T')[0],
        data_sprzedazy: new Date().toISOString().split('T')[0],
        termin_platnosci: '', forma_platnosci: 'przelew',
        task_id: '', uwagi: '',
        pozycje: [{ nazwa: '', jednostka: 'szt', ilosc: 1, cena_netto: '', vat_stawka: 23 }]
      });
    } catch (err) {
      showMsg(errorMessage(`Błąd: ${getApiErrorMessage(err, 'nieznany')}`));
    } finally {
      setSaving(false);
    }
  };

  const sumaNetto = form.pozycje.reduce((s, p) => s + (parseFloat(p.ilosc) || 0) * (parseFloat(p.cena_netto) || 0), 0);
  const sumaVat = form.pozycje.reduce((s, p) => {
    const netto = (parseFloat(p.ilosc) || 0) * (parseFloat(p.cena_netto) || 0);
    return s + netto * (parseFloat(p.vat_stawka) || 0) / 100;
  }, 0);
  const sumaBrutto = sumaNetto + sumaVat;

  const fmt = (n) => parseFloat(n || 0).toLocaleString('pl-PL', { minimumFractionDigits: 2 });

  const roczneStaty = faktury.reduce((acc, f) => {
    const rok = new Date(f.data_wystawienia).getFullYear();
    if (!acc[rok]) acc[rok] = 0;
    acc[rok] += parseFloat(f.brutto) || 0;
    return acc;
  }, {});

  return (
    <div style={styles.container}>
      <Sidebar />
      <div style={styles.main}>
        {/* Nagłówek */}
        <PageHeader
          variant="plain"
          title={t('pages.ksiegowosc.title')}
          subtitle={t('pages.ksiegowosc.subtitle')}
          icon={<ReceiptLongOutlined style={{ fontSize: 26 }} />}
          actions={
            <>
              <StatusMessage message={msg} />
              <button type="button" style={styles.addBtn} onClick={() => setTab('nowa')}>
                + {t('pages.ksiegowosc.newInvoice')}
              </button>
            </>
          }
        />

        {/* KPI */}
        <div style={styles.kpiRow}>
          <div style={styles.kpi}>
            <div style={styles.kpiIcon}><DescriptionOutlined style={{ fontSize: 22 }} /></div>
            <div style={styles.kpiNum}>{stats.total || 0}</div>
            <div style={styles.kpiLabel}>Wszystkich faktur</div>
          </div>
          <div style={styles.kpi}>
            <div style={styles.kpiIcon}><PaymentsOutlined style={{ fontSize: 22 }} /></div>
            <div style={styles.kpiNum}>{fmt(stats.przychod_total)} PLN</div>
            <div style={styles.kpiLabel}>Łączny przychód</div>
          </div>
          <div style={{...styles.kpi, borderTop: '4px solid #4CAF50'}}>
            <div style={styles.kpiIcon}><CheckCircleOutline style={{ fontSize: 22 }} /></div>
            <div style={styles.kpiNum}>{fmt(stats.oplacone)} PLN</div>
            <div style={styles.kpiLabel}>Opłacone</div>
          </div>
          <div style={{...styles.kpi, borderTop: '4px solid #F9A825'}}>
            <div style={styles.kpiIcon}><HourglassEmptyOutlined style={{ fontSize: 22 }} /></div>
            <div style={styles.kpiNum}>{fmt(stats.nieoplacone)} PLN</div>
            <div style={styles.kpiLabel}>Nieopłacone</div>
          </div>
          <div style={{...styles.kpi, borderTop: '4px solid #EF5350'}}>
            <div style={styles.kpiIcon}><WarningAmberOutlined style={{ fontSize: 22 }} /></div>
            <div style={styles.kpiNum}>{fmt(stats.przeterminowane)} PLN</div>
            <div style={styles.kpiLabel}>Przeterminowane</div>
          </div>
        </div>

        {/* Tabs */}
        <div style={styles.tabs}>
          {[
            { key: 'faktury', label: `${t('pages.ksiegowosc.tabInvoices')} (${faktury.length})` },
            { key: 'nowa', label: t('pages.ksiegowosc.tabNewInvoice') },
            { key: 'ustawienia', label: t('pages.ksiegowosc.tabCompanySettings') },
          ].map(t => (
            <button
              key={t.key}
              style={{...styles.tab, ...(tab === t.key ? styles.tabActive : {})}}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* LISTA FAKTUR */}
        {tab === 'faktury' && (
          <div style={styles.card}>
            <div style={styles.filtryRow}>
              <div style={styles.filtrGroup}>
                <label style={styles.filtrLabel}>Status:</label>
                <select style={styles.filtrSelect} value={filtrStatus} onChange={e => setFiltrStatus(e.target.value)}>
                  <option value="">Wszystkie</option>
                  <option value="Nieoplacona">{t('pages.ksiegowosc.optUnpaid')}</option>
                  <option value="Oplacona">{t('pages.ksiegowosc.optPaid')}</option>
                  <option value="Przeterminowana">{t('pages.ksiegowosc.optOverdue')}</option>
                  <option value="Anulowana">{t('pages.ksiegowosc.optCancelled')}</option>
                </select>
              </div>
              <div style={styles.filtrGroup}>
                <label style={styles.filtrLabel}>Rok:</label>
                <select style={styles.filtrSelect} value={filtrRok} onChange={e => setFiltrRok(parseInt(e.target.value))}>
                  {Object.keys(roczneStaty).sort((a,b)=>b-a).map(r => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>
              {(isDyrektor || isKierownik) && (
                <div style={styles.filtrGroup}>
                  <label style={styles.filtrLabel}>Oddział:</label>
                  <select style={styles.filtrSelect} value={filtrOddzial} onChange={e => setFiltrOddzial(e.target.value)}>
                    <option value="">Wszystkie oddziały</option>
                    {oddzialy.map(o => <option key={o.id} value={o.id}>🏢 {o.nazwa}</option>)}
                  </select>
                </div>
              )}
              {(filtrStatus || filtrOddzial || filtrRok !== new Date().getFullYear()) && (
                <button style={styles.clearBtn} onClick={() => { setFiltrStatus(''); setFiltrOddzial(''); setFiltrRok(new Date().getFullYear()); }}>
                  ✕ Wyczyść filtry
                </button>
              )}
              <span style={styles.filtrCount}>📊 {filtrowane.length} faktur</span>
            </div>

            {filtrowane.length === 0 ? (
              <div style={styles.empty}>
                <div style={styles.emptyIcon}>🧾</div>
                <p>Brak faktur</p>
                <p style={styles.emptySub}>Kliknij "+ Nowa faktura" aby wystawić pierwszą fakturę</p>
              </div>
            ) : (
              <div style={styles.tableWrap}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      {['Numer', 'Klient', 'Data', 'Termin', 'Netto', 'VAT', 'Brutto', 'Płatność', 'Status', 'Akcja'].map(h => (
                        <th key={h} style={styles.th}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtrowane.map((f, i) => (
                      <tr key={f.id} style={{backgroundColor: i % 2 === 0 ? 'var(--bg-card)' : 'var(--bg-deep)'}}>
                        <td style={{...styles.td, fontWeight: '700', color: 'var(--accent)'}}>{f.numer}</td>
                        <td style={styles.td}>
                          <div style={styles.klientNazwa}>{f.klient_nazwa}</div>
                          {f.klient_nip && <div style={styles.klientNip}>NIP: {f.klient_nip}</div>}
                        </td>
                        <td style={styles.td}>{formatDate(f.data_wystawienia)}</td>
                        <td style={{...styles.td, color: isOverdue(f.termin_platnosci, f.status) ? '#EF5350' : 'var(--text)'}}>
                          {formatDate(f.termin_platnosci) || '-'}
                         </td>
                        <td style={styles.td}>{fmt(f.netto)} PLN</td>
                        <td style={styles.td}>{fmt(f.vat_kwota)} PLN</td>
                        <td style={{...styles.td, fontWeight: '700', color: 'var(--accent)'}}>{fmt(f.brutto)} PLN</td>
                        <td style={styles.td}>
                          <span style={styles.platBadge}>{f.forma_platnosci}</span>
                        </td>
                        <td style={styles.td}>
                          <select
                            style={{...styles.statusSelect, borderColor: STATUS_KOLOR[f.status] || '#9CA3AF'}}
                            value={f.status}
                            onChange={e => zmienStatus(f.id, e.target.value)}
                          >
                            <option value="Nieoplacona">{t('pages.ksiegowosc.optUnpaidShort')}</option>
                            <option value="Oplacona">{t('pages.ksiegowosc.optPaidShort')}</option>
                            <option value="Przeterminowana">⚠️ Przeterminowana</option>
                            <option value="Anulowana">❌ Anulowana</option>
                          </select>
                        </td>
                        <td style={styles.td}>
                          <button style={styles.pdfBtn} onClick={() => pobierzFakturePdf(f.id)}>
                            📄 PDF
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* NOWA FAKTURA */}
        {tab === 'nowa' && (
          <form onSubmit={handleSaveFaktura}>
            <div style={styles.card}>
              <div style={styles.cardTitle}>📌 Powiąż ze zleceniem (opcjonalnie)</div>
              <select style={styles.input} value={form.task_id} onChange={e => wypelnijZZlecenia(e.target.value)}>
                <option value="">-- wybierz zlecenie --</option>
                {zlecenia.map(z => (
                  <option key={z.id} value={z.id}>
                    #{z.id} {z.klient_nazwa} — {z.adres} ({z.status})
                  </option>
                ))}
              </select>
            </div>

            <div style={styles.card}>
              <div style={styles.cardTitle}>👤 Dane klienta</div>
              <div style={styles.grid}>
                <div style={styles.field}>
                  <label style={styles.label}>Typ klienta</label>
                  <select style={styles.input} value={form.klient_typ} onChange={e => setForm({...form, klient_typ: e.target.value})}>
                    <option value="firma">🏢 Firma</option>
                    <option value="prywatny">👤 Osoba prywatna</option>
                  </select>
                </div>
                <div style={styles.field}>
                  <label style={styles.label}>Nazwa klienta *</label>
                  <input style={styles.input} value={form.klient_nazwa} required
                    onChange={e => setForm({...form, klient_nazwa: e.target.value})}
                    placeholder="Firma lub imię i nazwisko" />
                </div>
                {form.klient_typ === 'firma' && (
                  <div style={styles.field}>
                    <label style={styles.label}>NIP klienta</label>
                    <input style={styles.input} value={form.klient_nip}
                      onChange={e => setForm({...form, klient_nip: e.target.value})}
                      placeholder="np. 1234567890" />
                  </div>
                )}
                <div style={styles.field}>
                  <label style={styles.label}>Adres klienta</label>
                  <input style={styles.input} value={form.klient_adres}
                    onChange={e => setForm({...form, klient_adres: e.target.value})}
                    placeholder="ul. Przykładowa 1, Kraków" />
                </div>
                <div style={styles.field}>
                  <label style={styles.label}>Email klienta</label>
                  <input style={styles.input} type="email" value={form.klient_email}
                    onChange={e => setForm({...form, klient_email: e.target.value})}
                    placeholder="klient@firma.pl" />
                </div>
              </div>
            </div>

            <div style={styles.card}>
              <div style={styles.cardTitle}>{t('pages.ksiegowosc.invoiceDataTitle')}</div>
              <div style={styles.grid}>
                <div style={styles.field}>
                  <label style={styles.label}>Data wystawienia *</label>
                  <input style={styles.input} type="date" value={form.data_wystawienia} required
                    onChange={e => setForm({...form, data_wystawienia: e.target.value})} />
                </div>
                <div style={styles.field}>
                  <label style={styles.label}>Data sprzedaży *</label>
                  <input style={styles.input} type="date" value={form.data_sprzedazy} required
                    onChange={e => setForm({...form, data_sprzedazy: e.target.value})} />
                </div>
                <div style={styles.field}>
                  <label style={styles.label}>Termin płatności</label>
                  <input style={styles.input} type="date" value={form.termin_platnosci}
                    onChange={e => setForm({...form, termin_platnosci: e.target.value})} />
                </div>
                <div style={styles.field}>
                  <label style={styles.label}>Forma płatności</label>
                  <select style={styles.input} value={form.forma_platnosci}
                    onChange={e => setForm({...form, forma_platnosci: e.target.value})}>
                    <option value="przelew">💳 Przelew bankowy</option>
                    <option value="gotowka">💵 Gotówka</option>
                    <option value="karta">💳 Karta</option>
                  </select>
                </div>
              </div>
            </div>

            <div style={styles.card}>
              <div style={{...styles.cardTitle, display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                <span>📦 Pozycje faktury</span>
                <button type="button" style={styles.addPozBtn} onClick={dodajPozycje}>+ Dodaj pozycję</button>
              </div>

              <div style={styles.tableWrap}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      {['Nazwa', 'Jedn.', 'Ilość', 'Cena netto', 'VAT %', 'Wartość netto', 'Wartość brutto', ''].map(h => (
                        <th key={h} style={styles.th}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {form.pozycje.map((p, idx) => {
                      const wNetto = (parseFloat(p.ilosc) || 0) * (parseFloat(p.cena_netto) || 0);
                      const wBrutto = wNetto * (1 + (parseFloat(p.vat_stawka) || 0) / 100);
                      return (
                        <tr key={idx}>
                          <td style={styles.td}>
                            <input style={{...styles.inputSm, width: 180}} value={p.nazwa} required
                              onChange={e => updatePozycja(idx, 'nazwa', e.target.value)}
                              placeholder="np. Wycinka drzew" />
                          </td>
                          <td style={styles.td}>
                            <select style={styles.inputSm} value={p.jednostka}
                              onChange={e => updatePozycja(idx, 'jednostka', e.target.value)}>
                              <option value="szt">szt</option>
                              <option value="usł">usł</option>
                              <option value="godz">godz</option>
                              <option value="m2">m²</option>
                              <option value="m3">m³</option>
                              <option value="km">km</option>
                            </select>
                          </td>
                          <td style={styles.td}>
                            <input style={{...styles.inputSm, width: 60}} type="number" step="0.5" value={p.ilosc}
                              onChange={e => updatePozycja(idx, 'ilosc', e.target.value)} />
                          </td>
                          <td style={styles.td}>
                            <input style={{...styles.inputSm, width: 90}} type="number" step="0.01" value={p.cena_netto} required
                              onChange={e => updatePozycja(idx, 'cena_netto', e.target.value)}
                              placeholder="0.00" />
                          </td>
                          <td style={styles.td}>
                            <select style={styles.inputSm} value={p.vat_stawka}
                              onChange={e => updatePozycja(idx, 'vat_stawka', e.target.value)}>
                              <option value="23">23%</option>
                              <option value="8">8%</option>
                              <option value="5">5%</option>
                              <option value="0">0%</option>
                            </select>
                          </td>
                          <td style={{...styles.td, fontWeight: '600'}}>{fmt(wNetto)} PLN</td>
                          <td style={{...styles.td, fontWeight: '700', color: 'var(--accent)'}}>{fmt(wBrutto)} PLN</td>
                          <td style={styles.td}>
                            {form.pozycje.length > 1 && (
                              <button type="button" style={styles.delBtn} onClick={() => usunPozycje(idx)}>✕</button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div style={styles.sumaBox}>
                <div style={styles.sumaRow}>
                  <span>Razem netto:</span>
                  <span style={{fontWeight: '600'}}>{fmt(sumaNetto)} PLN</span>
                </div>
                <div style={styles.sumaRow}>
                  <span>VAT:</span>
                  <span style={{fontWeight: '600', color: '#F9A825'}}>{fmt(sumaVat)} PLN</span>
                </div>
                <div style={{...styles.sumaRow, borderTop: '2px solid var(--border)', paddingTop: 8, marginTop: 4}}>
                  <span style={{fontSize: 16, fontWeight: 'bold'}}>Do zapłaty:</span>
                  <span style={{fontSize: 20, fontWeight: 'bold', color: 'var(--accent)'}}>{fmt(sumaBrutto)} PLN</span>
                </div>
              </div>
            </div>

            <div style={styles.card}>
              <div style={styles.field}>
                <label style={styles.label}>📝 Uwagi / Notatka na fakturze</label>
                <textarea style={{...styles.input, height: 80}}
                  value={form.uwagi}
                  onChange={e => setForm({...form, uwagi: e.target.value})}
                  placeholder="np. Dziękujemy za skorzystanie z naszych usług" />
              </div>
            </div>

            <div style={styles.btnRow}>
              <button type="button" style={styles.cancelBtn} onClick={() => setTab('faktury')}>Anuluj</button>
              <button type="submit" style={styles.submitBtn} disabled={saving}>
                {saving ? t('common.saving') : t('pages.ksiegowosc.issueInvoice')}
              </button>
            </div>
          </form>
        )}

        {/* USTAWIENIA FIRMY */}
        {tab === 'ustawienia' && (
          <div style={styles.card}>
            <div style={styles.cardTitle}>🏢 Dane firmy (będą drukowane na fakturach)</div>
            <div style={styles.grid}>
              <div style={styles.field}>
                <label style={styles.label}>Nazwa firmy *</label>
                <input style={styles.input} value={ustawienia.nazwa || ''}
                  onChange={e => setUstawienia({...ustawienia, nazwa: e.target.value})} />
              </div>
              <div style={styles.field}>
                <label style={styles.label}>NIP *</label>
                <input style={styles.input} value={ustawienia.nip || ''}
                  onChange={e => setUstawienia({...ustawienia, nip: e.target.value})}
                  placeholder="np. 1234567890" />
              </div>
              <div style={styles.field}>
                <label style={styles.label}>Adres</label>
                <input style={styles.input} value={ustawienia.adres || ''}
                  onChange={e => setUstawienia({...ustawienia, adres: e.target.value})}
                  placeholder="ul. Przykładowa 1" />
              </div>
              <div style={styles.field}>
                <label style={styles.label}>Kod pocztowy</label>
                <input style={styles.input} value={ustawienia.kod_pocztowy || ''}
                  onChange={e => setUstawienia({...ustawienia, kod_pocztowy: e.target.value})}
                  placeholder="00-000" />
              </div>
              <div style={styles.field}>
                <label style={styles.label}>Miasto</label>
                <CityInput
                  style={styles.input}
                  value={ustawienia.miasto || ''}
                  onChange={e => setUstawienia({...ustawienia, miasto: e.target.value})}
                  extraCities={oddzialy.map((o) => o.miasto)}
                />
              </div>
              <div style={styles.field}>
                <label style={styles.label}>Email firmy</label>
                <input style={styles.input} type="email" value={ustawienia.email || ''}
                  onChange={e => setUstawienia({...ustawienia, email: e.target.value})} />
              </div>
              <div style={styles.field}>
                <label style={styles.label}>Telefon firmy</label>
                <input style={styles.input} value={ustawienia.telefon || ''}
                  onChange={e => setUstawienia({...ustawienia, telefon: e.target.value})} />
              </div>
              <div style={styles.field}>
                <label style={styles.label}>Numer konta bankowego</label>
                <input style={styles.input} value={ustawienia.konto_bankowe || ''}
                  onChange={e => setUstawienia({...ustawienia, konto_bankowe: e.target.value})}
                  placeholder="PL00 0000 0000 0000 0000 0000 0000" />
              </div>
              <div style={styles.field}>
                <label style={styles.label}>Nazwa banku</label>
                <input style={styles.input} value={ustawienia.bank_nazwa || ''}
                  onChange={e => setUstawienia({...ustawienia, bank_nazwa: e.target.value})}
                  placeholder="np. PKO Bank Polski" />
              </div>
            </div>
            <div style={{...styles.btnRow, marginTop: 24}}>
              <button style={styles.submitBtn} onClick={saveUstawienia} disabled={saving}>
                {saving ? t('common.saving') : t('pages.ksiegowosc.saveSettings')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function formatDate(d) {
  if (!d) return '-';
  return d.split('T')[0];
}

function isOverdue(termin, status) {
  if (!termin || status === 'Oplacona' || status === 'Anulowana') return false;
  return new Date(termin) < new Date();
}

const styles = {
  container: { display: 'flex', minHeight: '100vh', backgroundColor: 'var(--bg)' },
  main: { flex: 1, padding: '24px', overflowX: 'hidden' },
  headerRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, flexWrap: 'wrap', gap: 12 },
  title: { fontSize: 'clamp(24px, 5vw, 28px)', fontWeight: 'bold', color: 'var(--accent)', margin: 0 },
  sub: { color: 'var(--text-muted)', marginTop: 4, fontSize: 'clamp(12px, 3vw, 14px)' },
  headerRight: { display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' },
  addBtn: { padding: '10px 20px', backgroundColor: 'var(--bg-deep)', color: '#fff', border: 'none', borderRadius: 10, cursor: 'pointer', fontSize: 14, fontWeight: 'bold', transition: 'all 0.2s', '&:hover': { backgroundColor: 'var(--bg-deep)', transform: 'translateY(-1px)' } },
  kpiRow: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 20 },
  kpi: { backgroundColor: 'var(--bg-card)', borderRadius: 12, padding: '14px 16px', textAlign: 'center', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', borderTop: '4px solid var(--accent)' },
  kpiIcon: { fontSize: 24, marginBottom: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' },
  kpiNum: { fontSize: 'clamp(18px, 4vw, 20px)', fontWeight: 'bold', color: 'var(--text)' },
  kpiLabel: { fontSize: 11, color: 'var(--text-muted)', marginTop: 4 },
  tabs: { display: 'flex', gap: 4, marginBottom: 16, borderBottom: '2px solid var(--border)', flexWrap: 'wrap' },
  tab: { padding: '10px 20px', border: 'none', backgroundColor: 'transparent', cursor: 'pointer', fontSize: 14, fontWeight: '500', color: 'var(--text-muted)', borderBottom: '2px solid transparent', marginBottom: -2 },
  tabActive: { color: 'var(--accent)', borderBottom: '2px solid var(--accent)' },
  card: { backgroundColor: 'var(--bg-card)', borderRadius: 12, padding: 24, marginBottom: 16, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  cardTitle: { fontSize: 15, fontWeight: 'bold', color: 'var(--accent)', marginBottom: 16, paddingBottom: 10, borderBottom: '1px solid var(--border)' },
  filtryRow: { display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' },
  filtrGroup: { display: 'flex', alignItems: 'center', gap: 6 },
  filtrLabel: { fontSize: 12, fontWeight: '600', color: 'var(--text-sub)' },
  filtrSelect: { padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, backgroundColor: 'var(--bg-card)' },
  clearBtn: { padding: '6px 12px', backgroundColor: 'rgba(248,113,113,0.1)', color: '#EF5350', border: '1px solid #FFCDD2', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: '500' },
  filtrCount: { fontSize: 13, color: 'var(--accent)', fontWeight: '600', marginLeft: 'auto' },
  tableWrap: { overflowX: 'auto', borderRadius: 12 },
  table: { width: '100%', borderCollapse: 'collapse', minWidth: 900 },
  th: { padding: '10px 12px', backgroundColor: 'var(--bg-deep)', color: '#fff', textAlign: 'left', fontSize: 12, fontWeight: '600' },
  td: { padding: '10px 12px', fontSize: 13, color: 'var(--text-sub)', borderBottom: '1px solid var(--border)' },
  klientNazwa: { fontWeight: '600', color: 'var(--text)' },
  klientNip: { fontSize: 11, color: 'var(--text-muted)', marginTop: 2 },
  statusSelect: {
    padding: '4px 8px',
    borderRadius: 6,
    borderWidth: 2,
    borderStyle: 'solid',
    borderColor: 'var(--border)',
    fontSize: 12,
    cursor: 'pointer',
    backgroundColor: 'var(--bg-card)',
  },
  platBadge: { backgroundColor: 'var(--bg-deep)', color: 'var(--accent)', padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: '600' },
  pdfBtn: { padding: '4px 10px', backgroundColor: 'var(--bg-deep)', color: 'var(--accent)', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: '600', transition: 'all 0.2s', '&:hover': { backgroundColor: 'var(--bg-deep)', color: '#fff' } },
  empty: { textAlign: 'center', padding: 60, color: 'var(--text-muted)' },
  emptyIcon: { fontSize: 48, marginBottom: 12, opacity: 0.5 },
  emptySub: { fontSize: 12, marginTop: 4, opacity: 0.7 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 },
  field: { display: 'flex', flexDirection: 'column', gap: 6 },
  label: { fontSize: 13, fontWeight: '600', color: 'var(--text-sub)' },
  input: { padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 14, outline: 'none', width: '100%', boxSizing: 'border-box' },
  inputSm: { padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', fontSize: 13, outline: 'none', width: '100%', boxSizing: 'border-box' },
  addPozBtn: { padding: '6px 14px', backgroundColor: 'var(--bg-deep)', color: 'var(--accent)', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: '600' },
  delBtn: { padding: '4px 8px', backgroundColor: 'rgba(248,113,113,0.1)', color: '#EF5350', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12 },
  sumaBox: { backgroundColor: 'var(--bg-card)', borderRadius: 10, padding: '16px 20px', maxWidth: 340, marginLeft: 'auto', marginTop: 16 },
  sumaRow: { display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 14, color: 'var(--text-sub)' },
  btnRow: { display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 8 },
  cancelBtn: { padding: '12px 24px', backgroundColor: 'var(--bg-card)', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 14, transition: 'all 0.2s', '&:hover': { backgroundColor: '#D1D5DB' } },
  submitBtn: { padding: '12px 28px', backgroundColor: 'var(--bg-deep)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: 'bold', transition: 'all 0.2s', '&:hover': { backgroundColor: 'var(--bg-deep)', transform: 'translateY(-1px)' } },
};
