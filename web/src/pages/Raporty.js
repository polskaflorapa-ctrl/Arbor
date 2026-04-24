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

const UI_COLORS = {
  success: '#166534',
  warning: '#b45309',
  info: '#1d4ed8',
  danger: '#dc2626',
  muted: '#64748b',
};

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
    if (value >= 70) return UI_COLORS.success;
    if (value >= 40) return UI_COLORS.warning;
    return UI_COLORS.danger;
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
          <div style={{ ...styles.kpi, borderTopColor: UI_COLORS.success }}>
            <div style={styles.kpiIcon}><CheckCircleOutline sx={{ fontSize: 26, color: UI_COLORS.success }} /></div>
            <div style={styles.kpiNum}>{zakonczone.length}</div>
            <div style={styles.kpiLabel}>{t('pages.raporty.kpiDone')}</div>
          </div>
          <div style={{ ...styles.kpi, borderTopColor: UI_COLORS.warning }}>
            <div style={styles.kpiIcon}><BoltOutlined sx={{ fontSize: 26, color: UI_COLORS.warning }} /></div>
            <div style={styles.kpiNum}>{wRealizacji.length}</div>
            <div style={styles.kpiLabel}>{t('pages.raporty.kpiInProgress')}</div>
          </div>
          <div style={{ ...styles.kpi, borderTopColor: UI_COLORS.info }}>
            <div style={styles.kpiIcon}><DescriptionOutlined sx={{ fontSize: 26, color: UI_COLORS.info }} /></div>
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
                { key: 'W_Realizacji', label: t('taskStatus.W_Realizacji'), count: wRealizacji.length, color: UI_COLORS.warning },
                { key: 'Nowe', label: t('taskStatus.Nowe'), count: nowe.length, color: UI_COLORS.info },
                { key: 'Zaplanowane', label: t('taskStatus.Zaplanowane'), count: zaplanowane.length, color: UI_COLORS.muted },
                { key: 'Anulowane', label: t('taskStatus.Anulowane'), count: anulowane.length, color: UI_COLORS.danger },
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
            <div style={styles.reportCardsGrid}>
              {statsByOddzial.map((o) => {
                const skut = o.total > 0 ? Math.round((o.zakonczone / o.total) * 100) : 0;
                return (
                  <div
                    key={o.id}
                    style={styles.reportMetricCard}
                    onClick={() => { setFiltrOddzial(o.id.toString()); setActiveTab('zlecenia'); }}
                  >
                    <div style={styles.reportTaskTop}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: 700, color: 'var(--text)' }}>
                        <BusinessOutlined sx={{ fontSize: 18, color: 'var(--accent)', flexShrink: 0 }} />
                        {o.nazwa}
                      </span>
                      <button type="button" style={styles.viewBtn} aria-label={t('common.details')}>
                        <SearchOutlined sx={{ fontSize: 18, color: 'var(--text-sub)' }} />
                      </button>
                    </div>
                    <div style={styles.reportTaskMeta}>
                      <span style={styles.reportMetaLabel}>{t('pages.raporty.thTasks')}</span>
                      <span style={styles.reportMetaValue}>{o.total}</span>
                    </div>
                    <div style={styles.reportTaskMeta}>
                      <span style={styles.reportMetaLabel}>{t('pages.raporty.thDone')}</span>
                      <span style={styles.reportMetaValue}>{o.zakonczone}</span>
                    </div>
                    <div style={styles.reportTaskMeta}>
                      <span style={styles.reportMetaLabel}>{t('pages.raporty.thEffectiveness')}</span>
                      <span style={{ ...styles.badge, backgroundColor: getSkutecznoscColor(skut) }}>{skut}%</span>
                    </div>
                    <div style={styles.reportTaskFooter}>
                      <span style={styles.reportMetaLabel}>{t('pages.raporty.thValue')}</span>
                      <span style={styles.reportValue}>{formatCurrency(o.wartosc)}</span>
                    </div>
                  </div>
                );
              })}
              <div style={{ ...styles.reportMetricCard, borderColor: 'var(--accent)' }}>
                <div style={{ ...styles.reportTaskClient, marginBottom: 4 }}>{t('pages.raporty.footerTotal')}</div>
                <div style={styles.reportTaskMeta}>
                  <span style={styles.reportMetaLabel}>{t('pages.raporty.thTasks')}</span>
                  <span style={styles.reportMetaValue}>{zlecenia.length}</span>
                </div>
                <div style={styles.reportTaskMeta}>
                  <span style={styles.reportMetaLabel}>{t('pages.raporty.thDone')}</span>
                  <span style={styles.reportMetaValue}>{zlecenia.filter(z => z.status === 'Zakonczone').length}</span>
                </div>
                <div style={styles.reportTaskMeta}>
                  <span style={styles.reportMetaLabel}>{t('pages.raporty.thEffectiveness')}</span>
                  <span style={{ ...styles.badge, backgroundColor: 'var(--bg-deep)' }}>
                    {zlecenia.length > 0 ? Math.round((zlecenia.filter(z => z.status === 'Zakonczone').length / zlecenia.length) * 100) : 0}%
                  </span>
                </div>
                <div style={styles.reportTaskFooter}>
                  <span style={styles.reportMetaLabel}>{t('pages.raporty.thValue')}</span>
                  <span style={styles.reportValue}>
                    {formatCurrency(zlecenia.reduce((s, z) => s + (parseFloat(z.wartosc_planowana) || 0), 0))}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
 
        {/* TAB: Per ekipa */}
        {activeTab === 'ekipy' && (
          <div style={styles.card}>
            <div style={styles.cardTitle}>{t('pages.raporty.teamResultsTitle')}</div>
            <div style={styles.reportCardsGrid}>
              {statsByEkipa.filter(e => e.total > 0).map((e) => {
                const skut = e.total > 0 ? Math.round((e.zakonczone / e.total) * 100) : 0;
                return (
                  <div
                    key={e.id}
                    style={styles.reportMetricCard}
                    onClick={() => { setFiltrEkipa(e.id.toString()); setActiveTab('zlecenia'); }}
                  >
                    <div style={styles.reportTaskTop}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: 700, color: 'var(--text)' }}>
                        <GroupsOutlined sx={{ fontSize: 18, color: 'var(--accent)', flexShrink: 0 }} />
                        {e.nazwa}
                      </span>
                      <span style={styles.reportMetaValue}>{e.oddzial_nazwa || '-'}</span>
                    </div>
                    <div style={styles.reportTaskMeta}>
                      <span style={styles.reportMetaLabel}>{t('pages.raporty.thTasks')}</span>
                      <span style={styles.reportMetaValue}>{e.total}</span>
                    </div>
                    <div style={styles.reportTaskMeta}>
                      <span style={styles.reportMetaLabel}>{t('pages.raporty.thDone')}</span>
                      <span style={styles.reportMetaValue}>{e.zakonczone}</span>
                    </div>
                    <div style={styles.reportTaskMeta}>
                      <span style={styles.reportMetaLabel}>{t('pages.raporty.thEffectiveness')}</span>
                      <span style={{ ...styles.badge, backgroundColor: getSkutecznoscColor(skut) }}>{skut}%</span>
                    </div>
                    <div style={styles.reportTaskFooter}>
                      <span style={styles.reportMetaLabel}>{t('pages.raporty.thValue')}</span>
                      <span style={styles.reportValue}>{formatCurrency(e.wartosc)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
 
        {/* TAB: Miesięczne */}
        {activeTab === 'miesiace' && (
          <div style={styles.card}>
            <div style={styles.cardTitle}>{t('pages.raporty.monthlyTitle', { year: filtrRok })}</div>
            <div style={styles.reportCardsGrid}>
              {statystykiMiesieczne.map((m, i) => {
                const maxVal = Math.max(...statystykiMiesieczne.map((x) => x.wartosc), 1);
                const width = Math.max(6, Math.round((m.wartosc / maxVal) * 100));
                return (
                  <div key={i} style={styles.reportMetricCard}>
                    <div style={styles.reportTaskTop}>
                      <span style={styles.reportTaskClient}>{m.nazwa}</span>
                      <span style={styles.reportMetaValue}>{m.liczba} {t('pages.raporty.thTaskCount').toLowerCase()}</span>
                    </div>
                    <div style={styles.monthBarTrack}>
                      <div style={{ ...styles.monthBarFill, width: `${width}%` }} />
                    </div>
                    <div style={styles.reportTaskMeta}>
                      <span style={styles.reportMetaLabel}>{t('pages.raporty.thValue')}</span>
                      <span style={styles.reportValue}>{formatCurrency(m.wartosc)}</span>
                    </div>
                    <div style={styles.reportTaskMeta}>
                      <span style={styles.reportMetaLabel}>{t('pages.raporty.thAvgValue')}</span>
                      <span style={styles.reportMetaValue}>{m.liczba > 0 ? formatCurrency(m.wartosc / m.liczba) : '0 PLN'}</span>
                    </div>
                  </div>
                );
              })}
              <div style={{ ...styles.reportMetricCard, borderColor: 'var(--accent)' }}>
                <div style={{ ...styles.reportTaskClient, marginBottom: 4 }}>{t('pages.raporty.footerSum')}</div>
                <div style={styles.reportTaskMeta}>
                  <span style={styles.reportMetaLabel}>{t('pages.raporty.thTaskCount')}</span>
                  <span style={styles.reportMetaValue}>{statystykiMiesieczne.reduce((s, m) => s + m.liczba, 0)}</span>
                </div>
                <div style={styles.reportTaskMeta}>
                  <span style={styles.reportMetaLabel}>{t('pages.raporty.thValue')}</span>
                  <span style={styles.reportValue}>
                    {formatCurrency(statystykiMiesieczne.reduce((s, m) => s + m.wartosc, 0))}
                  </span>
                </div>
              </div>
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
              <div style={styles.reportCardsGrid}>
                {filtrowane.map((z) => (
                  <div
                    key={z.id}
                    style={styles.reportTaskCard}
                    onClick={() => navigate(`/zlecenia/${z.id}`)}
                  >
                    <div style={styles.reportTaskTop}>
                      <span style={styles.idBadge}>#{z.id}</span>
                      <span style={{ ...styles.badge, backgroundColor: getStatusColor(z.status), display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <TaskStatusIcon status={z.status} size={15} color="#fff" />
                        {t(`taskStatus.${z.status}`, { defaultValue: z.status })}
                      </span>
                    </div>
                    <div style={styles.reportTaskClient}>{z.klient_nazwa}</div>
                    <div style={styles.reportTaskMeta}>
                      <span style={styles.reportMetaLabel}>{t('pages.raporty.thBranch')}</span>
                      <span style={styles.reportMetaValue}>{z.oddzial_nazwa || '-'}</span>
                    </div>
                    <div style={styles.reportTaskMeta}>
                      <span style={styles.reportMetaLabel}>{t('pages.raporty.thTeam')}</span>
                      <span style={styles.reportMetaValue}>{z.ekipa_nazwa || t('common.missing')}</span>
                    </div>
                    <div style={styles.reportTaskFooter}>
                      <span style={styles.reportDate}>{formatDate(z.data_planowana)}</span>
                      <span style={styles.reportValue}>{formatCurrency(z.wartosc_planowana)}</span>
                    </div>
                  </div>
                ))}
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
    case 'Zakonczone': return UI_COLORS.success;
    case 'W_Realizacji': return UI_COLORS.warning;
    case 'Nowe': return UI_COLORS.info;
    case 'Zaplanowane': return UI_COLORS.muted;
    case 'Anulowane': return UI_COLORS.danger;
    default: return UI_COLORS.muted;
  }
}
 
const styles = {
  container: { display: 'flex', minHeight: '100vh', backgroundColor: 'var(--bg)' },
  main: { flex: 1, padding: '24px', overflowX: 'hidden' },
  filtryRow: { display: 'flex', gap: 12, marginBottom: 20, alignItems: 'center', backgroundColor: 'var(--bg-card)', padding: '12px 20px', borderRadius: 12, boxShadow: 'var(--shadow-sm)', flexWrap: 'wrap' },
  filtrGroup: { display: 'flex', alignItems: 'center', gap: 8 },
  filtrLabel: { fontSize: 13, fontWeight: '600', color: 'var(--text-sub)' },
  filtrInput: { padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, backgroundColor: 'var(--bg-card)' },
  clearBtn: { padding: '7px 14px', backgroundColor: 'rgba(248,113,113,0.1)', color: 'var(--danger)', border: '1px solid rgba(248,113,113,0.35)', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: '500' },
  kpiRow: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 20 },
  kpi: { backgroundColor: 'var(--bg-card)', borderRadius: 12, padding: '14px 16px', boxShadow: 'var(--shadow-sm)', borderTopWidth: 3, borderTopStyle: 'solid', textAlign: 'center' },
  kpiIcon: { display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  kpiNum: { fontSize: 'clamp(18px, 4vw, 22px)', fontWeight: 'bold', color: 'var(--text)' },
  kpiLabel: { fontSize: 11, color: 'var(--text-muted)', marginTop: 4 },
  tabs: { display: 'flex', gap: 4, marginBottom: 20, borderBottom: '2px solid var(--border)', flexWrap: 'wrap' },
  tab: { padding: '10px 20px', border: 'none', backgroundColor: 'transparent', cursor: 'pointer', fontSize: 14, fontWeight: '500', color: 'var(--text-muted)', borderBottom: '2px solid transparent', marginBottom: -2, transition: 'all 0.2s' },
  tabActive: { color: 'var(--accent)', borderBottom: '2px solid var(--accent)' },
  twoCol: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20 },
  card: { backgroundColor: 'var(--bg-card)', borderRadius: 16, padding: 20, boxShadow: 'var(--shadow-sm)', marginBottom: 20 },
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
  reportCardsGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: 12 },
  reportTaskCard: {
    background: 'linear-gradient(150deg, var(--bg-card) 0%, var(--bg-card2) 100%)',
    border: '1px solid var(--border2)',
    borderRadius: 14,
    boxShadow: 'var(--shadow-sm)',
    padding: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    cursor: 'pointer',
  },
  reportMetricCard: {
    background: 'linear-gradient(150deg, var(--bg-card) 0%, var(--bg-card2) 100%)',
    border: '1px solid var(--border2)',
    borderRadius: 14,
    boxShadow: 'var(--shadow-sm)',
    padding: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    cursor: 'pointer',
  },
  reportTaskTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  reportTaskClient: { fontSize: 14, fontWeight: 700, color: 'var(--text)' },
  reportTaskMeta: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  reportMetaLabel: { fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', fontWeight: 700 },
  reportMetaValue: { fontSize: 12, color: 'var(--text-sub)', textAlign: 'right', fontWeight: 600 },
  reportTaskFooter: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  reportDate: { fontSize: 12, color: 'var(--text-sub)', fontWeight: 600 },
  reportValue: { fontSize: 13, color: 'var(--accent)', fontWeight: 800 },
  monthBarTrack: { width: '100%', height: 8, backgroundColor: 'var(--bg-deep)', borderRadius: 999, overflow: 'hidden' },
  monthBarFill: { height: '100%', borderRadius: 999, background: 'linear-gradient(90deg, var(--accent-dk), var(--accent))' },
};
 