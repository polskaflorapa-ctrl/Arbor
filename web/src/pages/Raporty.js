import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import AssessmentOutlined from '@mui/icons-material/AssessmentOutlined';
import AssignmentOutlined from '@mui/icons-material/AssignmentOutlined';
import AttachMoney from '@mui/icons-material/AttachMoney';
import BoltOutlined from '@mui/icons-material/BoltOutlined';
import BusinessOutlined from '@mui/icons-material/BusinessOutlined';
import CheckCircleOutline from '@mui/icons-material/CheckCircleOutline';
import CloseOutlined from '@mui/icons-material/CloseOutlined';
import ContentCutOutlined from '@mui/icons-material/ContentCutOutlined';
import DescriptionOutlined from '@mui/icons-material/DescriptionOutlined';
import ForestOutlined from '@mui/icons-material/ForestOutlined';
import GroupsOutlined from '@mui/icons-material/GroupsOutlined';
import HandymanOutlined from '@mui/icons-material/HandymanOutlined';
import Inventory2Outlined from '@mui/icons-material/Inventory2Outlined';
import LocalFloristOutlined from '@mui/icons-material/LocalFloristOutlined';
import SearchOutlined from '@mui/icons-material/SearchOutlined';
import TrackChangesOutlined from '@mui/icons-material/TrackChangesOutlined';
import api from '../api';
import PageHeader from '../components/PageHeader';
import Sidebar from '../components/Sidebar';
import TaskStatusIcon from '../components/TaskStatusIcon';
import { getLocalStorageJson } from '../utils/safeJsonLocalStorage';
import { getStoredToken, authHeaders } from '../utils/storedToken';

const SERVICE_TYPE_ROW = [
  { typ: 'Wycinka', Icon: ForestOutlined },
  { typ: 'Pielęgnacja', Icon: ContentCutOutlined },
  { typ: 'Ogrodnictwo', Icon: LocalFloristOutlined },
  { typ: 'Frezowanie pniaków', Icon: HandymanOutlined },
  { typ: 'Inne', Icon: Inventory2Outlined },
];

export default function Raporty() {
  const { t, i18n } = useTranslation();
  const [zlecenia, setZlecenia] = useState([]);
  const [oddzialy, setOddzialy] = useState([]);
  const [ekipy, setEkipy] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filtrOddzial, setFiltrOddzial] = useState('');
  const [filtrEkipa, setFiltrEkipa] = useState('');
  const [filtrMiesiac, setFiltrMiesiac] = useState(new Date().toISOString().slice(0, 7));
  const [filtrRok, setFiltrRok] = useState(new Date().getFullYear());
  const [activeTab, setActiveTab] = useState('podsumowanie');
  const [currentUser, setCurrentUser] = useState(null);
  const navigate = useNavigate();
 
  // POPRAWKA: obliczane na poziomie komponentu, dostępne w JSX
  const isDyrektor = currentUser?.rola === 'Dyrektor' || currentUser?.rola === 'Administrator';
  const isKierownik = currentUser?.rola === 'Kierownik';
 
  // POPRAWKA: parsedUser przekazywany bezpośrednio do loadData
  useEffect(() => {
    const parsedUser = getLocalStorageJson('user');
    if (!parsedUser) { navigate('/'); return; }
    setCurrentUser(parsedUser);
    loadData(parsedUser);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
 
  // POPRAWKA: async + przyjmuje user jako parametr + wybiera właściwy endpoint
  const loadData = async (user) => {
    try {
      const token = getStoredToken();
      const h = authHeaders(token);
      const rola = user?.rola;
      const endpoint = (rola === 'Dyrektor' || rola === 'Administrator')
        ? `/tasks/wszystkie`
        : `/tasks`;
 
      const [zRes, oRes, eRes] = await Promise.all([
        api.get(endpoint, { headers: h }),
        api.get(`/oddzialy`, { headers: h }),
        api.get(`/ekipy`, { headers: h }),
      ]);
      setZlecenia(zRes.data);
      setOddzialy(oRes.data);
      setEkipy(eRes.data);
    } catch (err) {
      console.log('Błąd ładowania:', err);
    } finally {
      setLoading(false);
    }
  };
 
  const filtrowane = zlecenia.filter(z => {
    if (filtrOddzial && z.oddzial_id?.toString() !== filtrOddzial) return false;
    if (filtrEkipa && z.ekipa_id?.toString() !== filtrEkipa) return false;
    if (filtrMiesiac && z.data_planowana) {
      const miesiac = z.data_planowana.split('T')[0].slice(0, 7);
      if (miesiac !== filtrMiesiac) return false;
    }
    if (filtrRok && z.data_planowana) {
      const rok = z.data_planowana.split('T')[0].slice(0, 4);
      if (rok !== filtrRok.toString()) return false;
    }
    return true;
  });
 
  const localeNum = i18n.language === 'uk' ? 'uk-UA' : i18n.language === 'ru' ? 'ru-RU' : 'pl-PL';
  const formatCurrency = (value) => {
    if (!value) return `0 PLN`;
    return parseFloat(value).toLocaleString(localeNum, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' PLN';
  };
 
  const sumaWartosc = filtrowane.reduce((s, z) => s + (parseFloat(z.wartosc_planowana) || 0), 0);
  const zakonczone = filtrowane.filter(z => z.status === 'Zakonczone');
  const wRealizacji = filtrowane.filter(z => z.status === 'W_Realizacji');
  const nowe = filtrowane.filter(z => z.status === 'Nowe');
  const zaplanowane = filtrowane.filter(z => z.status === 'Zaplanowane');
  const anulowane = filtrowane.filter(z => z.status === 'Anulowane');
  const skutecznosc = filtrowane.length > 0 ? ((zakonczone.length / filtrowane.length) * 100).toFixed(0) : 0;
 
  const statsByOddzial = oddzialy.map(o => {
    const zl = zlecenia.filter(z => z.oddzial_id === o.id);
    const zak = zl.filter(z => z.status === 'Zakonczone');
    const wartosc = zl.reduce((s, z) => s + (parseFloat(z.wartosc_planowana) || 0), 0);
    return { ...o, total: zl.length, zakonczone: zak.length, wartosc };
  });
 
  const statsByEkipa = ekipy.map(e => {
    const zl = zlecenia.filter(z => z.ekipa_id === e.id);
    const zak = zl.filter(z => z.status === 'Zakonczone');
    const wartosc = zl.reduce((s, z) => s + (parseFloat(z.wartosc_planowana) || 0), 0);
    return { ...e, total: zl.length, zakonczone: zak.length, wartosc };
  });
 
  const monthNames = useMemo(() => {
    const names = t('calendar.monthNames', { returnObjects: true });
    if (Array.isArray(names) && names.length === 12) return names;
    return ['Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec', 'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień'];
  }, [t]);

  const statystykiMiesieczne = useMemo(() => monthNames.map((nazwa, idx) => {
    const zl = zlecenia.filter(z => {
      if (!z.data_planowana) return false;
      const data = new Date(z.data_planowana);
      return data.getMonth() === idx && data.getFullYear() === parseInt(filtrRok, 10);
    });
    const wartosc = zl.reduce((s, z) => s + (parseFloat(z.wartosc_planowana) || 0), 0);
    return { nazwa, liczba: zl.length, wartosc };
  }), [monthNames, filtrRok, zlecenia]);
 
  const clearFilters = () => {
    setFiltrOddzial('');
    setFiltrEkipa('');
    setFiltrMiesiac(new Date().toISOString().slice(0, 7));
    setFiltrRok(new Date().getFullYear());
  };
 
  const getSkutecznoscColor = (value) => {
    if (value >= 70) return '#4CAF50';
    if (value >= 40) return '#F9A825';
    return '#EF5350';
  };
 
  const lata = [...new Set(zlecenia.map(z => z.data_planowana?.split('T')[0]?.slice(0, 4)).filter(Boolean))].sort((a,b)=>b-a);
 
  const ekipyFiltered = filtrOddzial
    ? ekipy.filter(e => e.oddzial_id === parseInt(filtrOddzial))
    : ekipy;
 
  return (
    <div style={styles.container}>
      <Sidebar />
      <div style={styles.main}>
        <PageHeader
          variant="plain"
          title={t('pages.raporty.title')}
          subtitle={t('pages.raporty.subtitle')}
          icon={<AssessmentOutlined style={{ fontSize: 26 }} />}
        />
 
        {/* Filtry */}
        <div style={styles.filtryRow}>
          <div style={styles.filtrGroup}>
            <label style={styles.filtrLabel}>{t('common.year')}:</label>
            <select style={styles.filtrInput} value={filtrRok} onChange={e => setFiltrRok(parseInt(e.target.value))}>
              {lata.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div style={styles.filtrGroup}>
            <label style={styles.filtrLabel}>{t('common.month')}:</label>
            <input style={styles.filtrInput} type="month" value={filtrMiesiac} onChange={e => setFiltrMiesiac(e.target.value)} />
          </div>
          {(isDyrektor || isKierownik) && (
            <div style={styles.filtrGroup}>
              <label style={styles.filtrLabel}>{t('common.branch')}:</label>
              <select style={styles.filtrInput} value={filtrOddzial} onChange={e => setFiltrOddzial(e.target.value)}>
                <option value="">{t('common.allBranches')}</option>
                {oddzialy.map(o => <option key={o.id} value={o.id}>{o.nazwa}</option>)}
              </select>
            </div>
          )}
          <div style={styles.filtrGroup}>
            <label style={styles.filtrLabel}>{t('common.team')}:</label>
            <select style={styles.filtrInput} value={filtrEkipa} onChange={e => setFiltrEkipa(e.target.value)}>
              <option value="">{t('common.allTeams')}</option>
              {ekipyFiltered.map(e => <option key={e.id} value={e.id}>{e.nazwa}</option>)}
            </select>
          </div>
          {(filtrOddzial || filtrEkipa || (filtrMiesiac !== new Date().toISOString().slice(0, 7)) || filtrRok !== new Date().getFullYear()) && (
            <button type="button" style={styles.clearBtn} onClick={clearFilters}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <CloseOutlined sx={{ fontSize: 16 }} />
                {t('common.clearFilters')}
              </span>
            </button>
          )}
        </div>
 
        {/* KPI */}
        <div style={styles.kpiRow}>
          <div style={{ ...styles.kpi, borderTopColor: 'var(--accent)' }}>
            <div style={styles.kpiIcon}><AssignmentOutlined sx={{ fontSize: 26, color: 'var(--accent)' }} /></div>
            <div style={styles.kpiNum}>{filtrowane.length}</div>
            <div style={styles.kpiLabel}>{t('pages.raporty.kpiAllTasks')}</div>
          </div>
          <div style={{ ...styles.kpi, borderTopColor: '#4CAF50' }}>
            <div style={styles.kpiIcon}><CheckCircleOutline sx={{ fontSize: 26, color: '#4CAF50' }} /></div>
            <div style={styles.kpiNum}>{zakonczone.length}</div>
            <div style={styles.kpiLabel}>{t('pages.raporty.kpiDone')}</div>
          </div>
          <div style={{ ...styles.kpi, borderTopColor: '#F9A825' }}>
            <div style={styles.kpiIcon}><BoltOutlined sx={{ fontSize: 26, color: '#F9A825' }} /></div>
            <div style={styles.kpiNum}>{wRealizacji.length}</div>
            <div style={styles.kpiLabel}>{t('pages.raporty.kpiInProgress')}</div>
          </div>
          <div style={{ ...styles.kpi, borderTopColor: '#2196F3' }}>
            <div style={styles.kpiIcon}><DescriptionOutlined sx={{ fontSize: 26, color: '#2196F3' }} /></div>
            <div style={styles.kpiNum}>{nowe.length}</div>
            <div style={styles.kpiLabel}>{t('pages.raporty.kpiNew')}</div>
          </div>
          <div style={{ ...styles.kpi, borderTopColor: 'var(--accent-dk)' }}>
            <div style={styles.kpiIcon}><AttachMoney sx={{ fontSize: 26, color: 'var(--accent-dk)' }} /></div>
            <div style={styles.kpiNum}>{formatCurrency(sumaWartosc)}</div>
            <div style={styles.kpiLabel}>{t('pages.raporty.kpiTotalValue')}</div>
          </div>
          <div style={{ ...styles.kpi, borderTopColor: getSkutecznoscColor(skutecznosc) }}>
            <div style={styles.kpiIcon}><TrackChangesOutlined sx={{ fontSize: 26, color: getSkutecznoscColor(skutecznosc) }} /></div>
            <div style={{ ...styles.kpiNum, color: getSkutecznoscColor(skutecznosc) }}>
              {skutecznosc}%
            </div>
            <div style={styles.kpiLabel}>{t('pages.raporty.kpiEffectiveness')}</div>
          </div>
        </div>
 
        {/* Tabs */}
        <div style={styles.tabs}>
          <button type="button" style={{...styles.tab, ...(activeTab === 'podsumowanie' ? styles.tabActive : {})}} onClick={() => setActiveTab('podsumowanie')}>
            {t('pages.raporty.tabSummary')}
          </button>
          <button type="button" style={{...styles.tab, ...(activeTab === 'oddzialy' ? styles.tabActive : {})}} onClick={() => setActiveTab('oddzialy')}>
            {t('pages.raporty.tabByBranch')}
          </button>
          <button type="button" style={{...styles.tab, ...(activeTab === 'ekipy' ? styles.tabActive : {})}} onClick={() => setActiveTab('ekipy')}>
            {t('pages.raporty.tabByTeam')}
          </button>
          <button type="button" style={{...styles.tab, ...(activeTab === 'miesiace' ? styles.tabActive : {})}} onClick={() => setActiveTab('miesiace')}>
            {t('pages.raporty.tabMonthly')}
          </button>
          <button type="button" style={{...styles.tab, ...(activeTab === 'zlecenia' ? styles.tabActive : {})}} onClick={() => setActiveTab('zlecenia')}>
            {t('pages.raporty.tabList')}
          </button>
        </div>
 
        {/* TAB: Podsumowanie */}
        {activeTab === 'podsumowanie' && (
          <div style={styles.twoCol}>
            <div style={styles.card}>
              <div style={styles.cardTitle}>{t('pages.raporty.cardStatusTitle')}</div>
              {[
                { key: 'Zakonczone', label: t('taskStatus.Zakonczone'), count: zakonczone.length, color: 'var(--accent)' },
                { key: 'W_Realizacji', label: t('taskStatus.W_Realizacji'), count: wRealizacji.length, color: '#F9A825' },
                { key: 'Nowe', label: t('taskStatus.Nowe'), count: nowe.length, color: '#2196F3' },
                { key: 'Zaplanowane', label: t('taskStatus.Zaplanowane'), count: zaplanowane.length, color: '#9C27B0' },
                { key: 'Anulowane', label: t('taskStatus.Anulowane'), count: anulowane.length, color: '#EF5350' },
              ].map(s => (
                <div key={s.key} style={styles.statusRow}>
                  <div style={styles.statusInfo}>
                    <span style={styles.statusIcon}><TaskStatusIcon status={s.key} size={18} /></span>
                    <span style={styles.statusLabel}>{s.label}</span>
                  </div>
                  <div style={styles.statusRight}>
                    <div style={styles.statusBar}>
                      <div style={{...styles.statusBarFill, width: filtrowane.length > 0 ? `${(s.count / filtrowane.length) * 100}%` : '0%', backgroundColor: s.color}} />
                    </div>
                    <span style={styles.statusCount}>{s.count}</span>
                    <span style={styles.statusPercent}>{filtrowane.length > 0 ? `${Math.round((s.count / filtrowane.length) * 100)}%` : '0%'}</span>
                  </div>
                </div>
              ))}
            </div>
 
            <div style={styles.card}>
              <div style={styles.cardTitle}>{t('pages.raporty.cardTypesTitle')}</div>
              {SERVICE_TYPE_ROW.map((item) => {
                const count = filtrowane.filter(z => z.typ_uslugi === item.typ).length;
                const wartosc = filtrowane.filter(z => z.typ_uslugi === item.typ).reduce((s, z) => s + (parseFloat(z.wartosc_planowana) || 0), 0);
                if (count === 0 && wartosc === 0) return null;
                const TypeIcon = item.Icon;
                return (
                  <div key={item.typ} style={styles.typRow}>
                    <div style={styles.typLabel}>
                      <span style={styles.typIcon}><TypeIcon sx={{ fontSize: 18, color: 'var(--accent)' }} /></span>
                      {t(`serviceType.${item.typ}`, { defaultValue: item.typ })}
                    </div>
                    <div style={styles.typRight}>
                      <span style={styles.typCount}>{t('pages.raporty.typeOrdersCount', { count })}</span>
                      <span style={styles.typWartosc}>{formatCurrency(wartosc)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
 
        {/* TAB: Per oddział */}
        {activeTab === 'oddzialy' && (
          <div style={styles.card}>
            <div style={styles.cardTitle}>{t('pages.raporty.branchResultsTitle')}</div>
            <div style={styles.tableScroll}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>{t('pages.raporty.thBranch')}</th>
                    <th style={styles.th}>{t('pages.raporty.thTasks')}</th>
                    <th style={styles.th}>{t('pages.raporty.thDone')}</th>
                    <th style={styles.th}>{t('pages.raporty.thEffectiveness')}</th>
                    <th style={styles.th}>{t('pages.raporty.thValue')}</th>
                    <th style={styles.th}></th>
                  </tr>
                </thead>
                <tbody>
                  {statsByOddzial.map((o, i) => {
                    const skut = o.total > 0 ? Math.round((o.zakonczone / o.total) * 100) : 0;
                    return (
                      <tr key={o.id} style={{backgroundColor: i%2===0?'var(--bg-card)':'var(--bg-deep)', cursor:'pointer'}}
                        onClick={() => { setFiltrOddzial(o.id.toString()); setActiveTab('zlecenia'); }}>
                        <td style={{ ...styles.td, fontWeight: '600' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                            <BusinessOutlined sx={{ fontSize: 18, color: 'var(--accent)', flexShrink: 0 }} />
                            {o.nazwa}
                          </span>
                        </td>
                        <td style={styles.td}>{o.total}</td>
                        <td style={styles.td}>{o.zakonczone}</td>
                        <td style={styles.td}>
                          <span style={{...styles.badge, backgroundColor: getSkutecznoscColor(skut)}}>
                            {skut}%
                          </span>
                        </td>
                        <td style={{...styles.td, fontWeight:'600', color:'var(--accent)'}}>
                          {formatCurrency(o.wartosc)}
                        </td>
                        <td style={styles.td}>
                          <button type="button" style={styles.viewBtn} aria-label={t('common.details')}>
                            <SearchOutlined sx={{ fontSize: 18, color: 'var(--text-sub)' }} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr style={{backgroundColor:'rgba(52,211,153,0.1)'}}>
                    <td style={{...styles.td, fontWeight:'bold'}}>{t('pages.raporty.footerTotal')}</td>
                    <td style={{...styles.td, fontWeight:'bold'}}>{zlecenia.length}</td>
                    <td style={{...styles.td, fontWeight:'bold'}}>{zlecenia.filter(z => z.status === 'Zakonczone').length}</td>
                    <td style={styles.td}>
                      <span style={{...styles.badge, backgroundColor: 'var(--bg-deep)'}}>
                        {zlecenia.length > 0 ? Math.round((zlecenia.filter(z => z.status === 'Zakonczone').length / zlecenia.length) * 100) : 0}%
                      </span>
                    </td>
                    <td style={{...styles.td, fontWeight:'bold', color:'var(--accent)', fontSize:'16px'}}>
                      {formatCurrency(zlecenia.reduce((s, z) => s + (parseFloat(z.wartosc_planowana) || 0), 0))}
                    </td>
                    <td style={styles.td}></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}
 
        {/* TAB: Per ekipa */}
        {activeTab === 'ekipy' && (
          <div style={styles.card}>
            <div style={styles.cardTitle}>{t('pages.raporty.teamResultsTitle')}</div>
            <div style={styles.tableScroll}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>{t('pages.raporty.thTeam')}</th>
                    <th style={styles.th}>{t('pages.raporty.thBranch')}</th>
                    <th style={styles.th}>{t('pages.raporty.thTasks')}</th>
                    <th style={styles.th}>{t('pages.raporty.thDone')}</th>
                    <th style={styles.th}>{t('pages.raporty.thEffectiveness')}</th>
                    <th style={styles.th}>{t('pages.raporty.thValue')}</th>
                  </tr>
                </thead>
                <tbody>
                  {statsByEkipa.filter(e => e.total > 0).map((e, i) => {
                    const skut = e.total > 0 ? Math.round((e.zakonczone / e.total) * 100) : 0;
                    return (
                      <tr key={e.id} style={{backgroundColor: i%2===0?'var(--bg-card)':'var(--bg-deep)', cursor:'pointer'}}
                        onClick={() => { setFiltrEkipa(e.id.toString()); setActiveTab('zlecenia'); }}>
                        <td style={{ ...styles.td, fontWeight: '600' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                            <GroupsOutlined sx={{ fontSize: 18, color: 'var(--accent)', flexShrink: 0 }} />
                            {e.nazwa}
                          </span>
                        </td>
                        <td style={styles.td}>{e.oddzial_nazwa || '-'}</td>
                        <td style={styles.td}>{e.total}</td>
                        <td style={styles.td}>{e.zakonczone}</td>
                        <td style={styles.td}>
                          <span style={{...styles.badge, backgroundColor: getSkutecznoscColor(skut)}}>
                            {skut}%
                          </span>
                        </td>
                        <td style={{...styles.td, fontWeight:'600', color:'var(--accent)'}}>
                          {formatCurrency(e.wartosc)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
 
        {/* TAB: Miesięczne */}
        {activeTab === 'miesiace' && (
          <div style={styles.card}>
            <div style={styles.cardTitle}>{t('pages.raporty.monthlyTitle', { year: filtrRok })}</div>
            <div style={styles.tableScroll}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>{t('pages.raporty.thMonth')}</th>
                    <th style={styles.th}>{t('pages.raporty.thTaskCount')}</th>
                    <th style={styles.th}>{t('pages.raporty.thValue')}</th>
                    <th style={styles.th}>{t('pages.raporty.thAvgValue')}</th>
                  </tr>
                </thead>
                <tbody>
                  {statystykiMiesieczne.map((m, i) => (
                    <tr key={i} style={{backgroundColor: i%2===0?'var(--bg-card)':'var(--bg-deep)'}}>
                      <td style={{...styles.td, fontWeight:'600'}}>{m.nazwa}</td>
                      <td style={styles.td}>{m.liczba}</td>
                      <td style={{...styles.td, fontWeight:'600', color:'var(--accent)'}}>{formatCurrency(m.wartosc)}</td>
                      <td style={styles.td}>{m.liczba > 0 ? formatCurrency(m.wartosc / m.liczba) : '0 PLN'}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{backgroundColor:'rgba(52,211,153,0.1)'}}>
                    <td style={{...styles.td, fontWeight:'bold'}}>{t('pages.raporty.footerSum')}</td>
                    <td style={{...styles.td, fontWeight:'bold'}}>{statystykiMiesieczne.reduce((s, m) => s + m.liczba, 0)}</td>
                    <td style={{...styles.td, fontWeight:'bold', color:'var(--accent)', fontSize:'16px'}}>
                      {formatCurrency(statystykiMiesieczne.reduce((s, m) => s + m.wartosc, 0))}
                    </td>
                    <td style={styles.td}>-</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}
 
        {/* TAB: Lista zleceń */}
        {activeTab === 'zlecenia' && (
          <div style={styles.card}>
            <div style={styles.cardTitle}>
              {t('pages.raporty.listTitle', { count: filtrowane.length })}
              {filtrowane.length > 0 && <span style={styles.sumWartosc}>{t('pages.raporty.listTotalValue', { value: formatCurrency(sumaWartosc) })}</span>}
            </div>
            {loading ? (
              <div style={styles.loading}>{t('pages.raporty.loadingTasks')}</div>
            ) : filtrowane.length === 0 ? (
              <div style={styles.empty}>
                <div style={styles.emptyIcon}>
                  <DescriptionOutlined sx={{ fontSize: 48, opacity: 0.45, color: 'var(--text-muted)' }} />
                </div>
                <p>{t('pages.raporty.emptyList')}</p>
              </div>
            ) : (
              <div style={styles.tableScroll}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>{t('pages.raporty.thId')}</th>
                      <th style={styles.th}>{t('pages.raporty.thClient')}</th>
                      <th style={styles.th}>{t('pages.raporty.thBranch')}</th>
                      <th style={styles.th}>{t('pages.raporty.thTeam')}</th>
                      <th style={styles.th}>{t('pages.zlecenia.thDate')}</th>
                      <th style={styles.th}>{t('pages.zlecenia.thStatus')}</th>
                      <th style={styles.th}>{t('pages.raporty.thValue')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtrowane.map((z, i) => (
                      <tr key={z.id} style={{backgroundColor: i%2===0?'var(--bg-card)':'var(--bg-deep)', cursor:'pointer'}}
                        onClick={() => navigate(`/zlecenia/${z.id}`)}>
                        <td style={styles.td}><span style={styles.idBadge}>#{z.id}</span></td>
                        <td style={{...styles.td, fontWeight:'600'}}>{z.klient_nazwa}</td>
                        <td style={styles.td}>{z.oddzial_nazwa || '-'}</td>
                        <td style={styles.td}>{z.ekipa_nazwa || <span style={styles.gray}>{t('common.missing')}</span>}</td>
                        <td style={styles.td}>{formatDate(z.data_planowana)}</td>
                        <td style={styles.td}>
                          <span style={{ ...styles.badge, backgroundColor: getStatusColor(z.status), display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <TaskStatusIcon status={z.status} size={15} color="#fff" />
                            {t(`taskStatus.${z.status}`, { defaultValue: z.status })}
                          </span>
                        </td>
                        <td style={{...styles.td, fontWeight:'600', color:'var(--accent)'}}>
                          {formatCurrency(z.wartosc_planowana)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
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
 
function getStatusColor(status) {
  switch (status) {
    case 'Zakonczone': return '#4CAF50';
    case 'W_Realizacji': return '#F9A825';
    case 'Nowe': return '#2196F3';
    case 'Zaplanowane': return '#9C27B0';
    case 'Anulowane': return '#EF5350';
    default: return '#6B7280';
  }
}
 
const styles = {
  container: { display: 'flex', minHeight: '100vh', backgroundColor: 'var(--bg)' },
  main: { flex: 1, padding: '24px', overflowX: 'hidden' },
  filtryRow: { display: 'flex', gap: 12, marginBottom: 20, alignItems: 'center', backgroundColor: 'var(--bg-card)', padding: '12px 20px', borderRadius: 12, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', flexWrap: 'wrap' },
  filtrGroup: { display: 'flex', alignItems: 'center', gap: 8 },
  filtrLabel: { fontSize: 13, fontWeight: '600', color: 'var(--text-sub)' },
  filtrInput: { padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, backgroundColor: 'var(--bg-card)' },
  clearBtn: { padding: '7px 14px', backgroundColor: 'rgba(248,113,113,0.1)', color: '#EF5350', border: '1px solid #FFCDD2', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: '500' },
  kpiRow: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 20 },
  kpi: { backgroundColor: 'var(--bg-card)', borderRadius: 12, padding: '14px 16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', borderTopWidth: 3, borderTopStyle: 'solid', textAlign: 'center' },
  kpiIcon: { display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  kpiNum: { fontSize: 'clamp(18px, 4vw, 22px)', fontWeight: 'bold', color: 'var(--text)' },
  kpiLabel: { fontSize: 11, color: 'var(--text-muted)', marginTop: 4 },
  tabs: { display: 'flex', gap: 4, marginBottom: 20, borderBottom: '2px solid var(--border)', flexWrap: 'wrap' },
  tab: { padding: '10px 20px', border: 'none', backgroundColor: 'transparent', cursor: 'pointer', fontSize: 14, fontWeight: '500', color: 'var(--text-muted)', borderBottom: '2px solid transparent', marginBottom: -2, transition: 'all 0.2s' },
  tabActive: { color: 'var(--accent)', borderBottom: '2px solid var(--accent)' },
  twoCol: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20 },
  card: { backgroundColor: 'var(--bg-card)', borderRadius: 16, padding: 20, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', marginBottom: 20 },
  cardTitle: { fontSize: 16, fontWeight: 'bold', color: 'var(--accent)', marginBottom: 16, paddingBottom: 10, borderBottom: '1px solid var(--border)' },
  sumWartosc: { fontSize: 13, fontWeight: 'normal', color: 'var(--text-muted)', marginLeft: 8 },
  statusRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)' },
  statusInfo: { display: 'flex', alignItems: 'center', gap: 8 },
  statusIcon: { display: 'inline-flex', alignItems: 'center', flexShrink: 0 },
  statusLabel: { fontSize: 14, color: 'var(--text-sub)' },
  statusRight: { display: 'flex', alignItems: 'center', gap: 12 },
  statusBar: { width: 120, height: 8, backgroundColor: 'var(--bg-deep)', borderRadius: 4, overflow: 'hidden' },
  statusBarFill: { height: '100%', borderRadius: 4, transition: 'width 0.3s' },
  statusCount: { fontSize: 14, fontWeight: 'bold', color: 'var(--text)', minWidth: 24, textAlign: 'right' },
  statusPercent: { fontSize: 12, color: 'var(--text-muted)', minWidth: 40 },
  typRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--border)' },
  typLabel: { fontSize: 14, color: 'var(--text-sub)', fontWeight: '500', display: 'flex', alignItems: 'center', gap: 8 },
  typIcon: { display: 'inline-flex', alignItems: 'center', flexShrink: 0 },
  typRight: { display: 'flex', gap: 16, alignItems: 'center' },
  typCount: { fontSize: 13, color: 'var(--text-muted)' },
  typWartosc: { fontSize: 13, fontWeight: '600', color: 'var(--accent)' },
  tableScroll: { overflowX: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse', minWidth: 600 },
  th: { padding: '12px 14px', backgroundColor: 'var(--bg-deep)', color: '#fff', textAlign: 'left', fontSize: 13, fontWeight: '600' },
  td: { padding: '11px 14px', fontSize: 13, color: 'var(--text-sub)', borderBottom: '1px solid var(--border)' },
  badge: { padding: '3px 10px', borderRadius: 20, color: '#fff', fontSize: 11, fontWeight: '600', display: 'inline-block' },
  idBadge: { backgroundColor: 'var(--bg-deep)', color: 'var(--accent)', padding: '2px 8px', borderRadius: 6, fontSize: 13, fontWeight: '600' },
  gray: { color: 'var(--text-muted)', fontStyle: 'italic' },
  viewBtn: { padding: '6px 10px', backgroundColor: 'var(--bg-deep)', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' },
  loading: { textAlign: 'center', padding: 40, color: 'var(--text-muted)' },
  empty: { textAlign: 'center', padding: 60, color: 'var(--text-muted)' },
  emptyIcon: { marginBottom: 12, display: 'flex', justifyContent: 'center' },
};
 