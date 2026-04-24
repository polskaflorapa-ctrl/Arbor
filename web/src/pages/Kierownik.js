import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import AssignmentOutlined from '@mui/icons-material/AssignmentOutlined';
import BoltOutlined from '@mui/icons-material/BoltOutlined';
import BusinessOutlined from '@mui/icons-material/BusinessOutlined';
import CheckCircleOutline from '@mui/icons-material/CheckCircleOutline';
import LocalPhoneOutlined from '@mui/icons-material/LocalPhoneOutlined';
import MapOutlined from '@mui/icons-material/MapOutlined';
import api from '../api';
import PageHeader from '../components/PageHeader';
import Sidebar from '../components/Sidebar';
import StatusMessage from '../components/StatusMessage';
import TaskStatusIcon from '../components/TaskStatusIcon';
import { errorMessage, successMessage } from '../utils/statusMessage';
import useTimedMessage from '../hooks/useTimedMessage';
import { getLocalStorageJson } from '../utils/safeJsonLocalStorage';
import { getStoredToken, authHeaders } from '../utils/storedToken';


const STATUS_KOLOR = {
  Nowe: 'var(--accent)',
  Zaplanowane: '#81C784',
  W_Realizacji: '#F9A825',
  Zakonczone: '#4CAF50',
  Anulowane: '#EF5350'
};

export default function Kierownik() {
  const { t } = useTranslation();
  const [zlecenia, setZlecenia] = useState([]);
  const [ekipy, setEkipy] = useState([]);
  const [oddzialy, setOddzialy] = useState([]);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const { message: msg, showMessage: showMsg } = useTimedMessage();
  const [filtrOddzial, setFiltrOddzial] = useState('');
  const [filtrStatus, setFiltrStatus] = useState('');
  const [filtrData, setFiltrData] = useState('');
  const [filtrEkipa, setFiltrEkipa] = useState('');
  const [sortBy, setSortBy] = useState('data');
  const navigate = useNavigate();

  const isDyrektor = (u) => u?.rola === 'Dyrektor' || u?.rola === 'Administrator';
  const isKierownik = (u) => u?.rola === 'Kierownik';

  const loadData = useCallback(async (u) => {
    try {
      const token = getStoredToken();
      const h = authHeaders(token);
      const endpoint = (u?.rola === 'Dyrektor' || u?.rola === 'Administrator')
        ? `/tasks/wszystkie`
        : `/tasks`;
      const [zRes, eRes, oRes] = await Promise.all([
        api.get(endpoint, { headers: h }),
        api.get(`/ekipy`, { headers: h }),
        api.get(`/oddzialy`, { headers: h }),
      ]);
      setZlecenia(zRes.data);
      setEkipy(eRes.data);
      setOddzialy(oRes.data);
    } catch (err) {
      console.log('Błąd ładowania:', err);
      showMsg(errorMessage('Błąd ładowania danych'));
    } finally {
      setLoading(false);
    }
  }, [showMsg]);

  useEffect(() => {
    const parsedUser = getLocalStorageJson('user');
    if (!parsedUser) { navigate('/'); return; }
    setUser(parsedUser);
    if (isKierownik(parsedUser)) {
      setFiltrOddzial(parsedUser.oddzial_id?.toString() || '');
    }
    loadData(parsedUser);
  }, [navigate, loadData]);

  const przypisz = async (taskId, ekipaId) => {
    try {
      const token = getStoredToken();
      await api.put(`/tasks/${taskId}/przypisz`,
        { ekipa_id: ekipaId || null },
        { headers: authHeaders(token) }
      );
      showMsg(successMessage('Ekipa przypisana!'));
      loadData(user);
    } catch (err) {
      showMsg(errorMessage('Błąd zapisu'));
    }
  };

  const zmienStatus = async (taskId, status) => {
    try {
      const token = getStoredToken();
      await api.put(`/tasks/${taskId}/status`,
        { status },
        { headers: authHeaders(token) }
      );
      showMsg(successMessage(`Status zmieniony na ${status}`));
      loadData(user);
    } catch (err) {
      showMsg(errorMessage('Błąd zmiany statusu'));
    }
  };

  const filtrowane = zlecenia.filter(z => {
    if (filtrOddzial && z.oddzial_id?.toString() !== filtrOddzial) return false;
    if (filtrStatus && z.status !== filtrStatus) return false;
    if (filtrData && z.data_planowana?.split('T')[0] !== filtrData) return false;
    if (filtrEkipa && z.ekipa_id?.toString() !== filtrEkipa) return false;
    return true;
  }).sort((a, b) => {
    if (sortBy === 'data') return new Date(b.data_planowana) - new Date(a.data_planowana);
    if (sortBy === 'priorytet') {
      const priority = { 'Pilny': 4, 'Wysoki': 3, 'Normalny': 2, 'Niski': 1 };
      return (priority[b.priorytet] || 0) - (priority[a.priorytet] || 0);
    }
    return 0;
  });

  const ekipyDlaOddzialu = (oddzialId) =>
    ekipy.filter(e => !oddzialId || e.oddzial_id === parseInt(oddzialId));

  const statsByOddzial = oddzialy.map(o => ({
    ...o,
    nowe: zlecenia.filter(z => z.oddzial_id === o.id && z.status === 'Nowe').length,
    w_realizacji: zlecenia.filter(z => z.oddzial_id === o.id && z.status === 'W_Realizacji').length,
    zakonczone: zlecenia.filter(z => z.oddzial_id === o.id && z.status === 'Zakonczone').length,
    lacznie: zlecenia.filter(z => z.oddzial_id === o.id).length,
  }));

  const clearFilters = () => {
    setFiltrOddzial('');
    setFiltrStatus('');
    setFiltrData('');
    setFiltrEkipa('');
  };

  return (
    <div style={styles.container}>
      <Sidebar />
      <div style={styles.main}>
        <PageHeader
          variant="plain"
          title={t('pages.kierownik.title')}
          subtitle={t('pages.kierownik.subtitle')}
          icon={<MapOutlined style={{ fontSize: 26 }} />}
          actions={
            <>
              <StatusMessage message={msg} />
              <button type="button" style={styles.addBtn} onClick={() => navigate('/nowe-zlecenie')}>
                + {t('common.newOrder')}
              </button>
            </>
          }
        />

        {/* Statystyki oddziałów (tylko dla dyrektora) */}
        {isDyrektor(user) && (
          <div style={styles.oddzialyRow}>
            {statsByOddzial.map(o => (
              <div
                key={o.id}
                style={{
                  ...styles.oddzialCard,
                  borderTop: `4px solid ${filtrOddzial === o.id.toString() ? 'var(--accent)' : 'var(--border)'}`
                }}
                onClick={() => setFiltrOddzial(filtrOddzial === o.id.toString() ? '' : o.id.toString())}
              >
                <div style={{ ...styles.oddzialNazwa, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <BusinessOutlined sx={{ fontSize: 20, color: 'var(--accent)' }} />
                  {o.nazwa}
                </div>
                <div style={{ ...styles.oddzialStats, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ color: 'var(--accent)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <AssignmentOutlined sx={{ fontSize: 16 }} />
                    {o.nowe}
                  </span>
                  <span style={{ color: '#F9A825', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <BoltOutlined sx={{ fontSize: 16 }} />
                    {o.w_realizacji}
                  </span>
                  <span style={{ color: 'var(--accent)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <CheckCircleOutline sx={{ fontSize: 16 }} />
                    {o.zakonczone}
                  </span>
                </div>
                <div style={styles.oddzialTotal}>Łącznie: {o.lacznie}</div>
              </div>
            ))}
          </div>
        )}

        {/* Filtry */}
        <div style={styles.filtryRow}>
          <div style={styles.filtrGroup}>
            <label style={styles.filtrLabel}>{t('pages.kierownik.filterStatus')}</label>
            <select style={styles.filtrSelect} value={filtrStatus} onChange={e => setFiltrStatus(e.target.value)}>
              <option value="">{t('pages.kierownik.all')}</option>
              <option value="Nowe">{t('taskStatus.Nowe')}</option>
              <option value="Zaplanowane">{t('taskStatus.Zaplanowane')}</option>
              <option value="W_Realizacji">{t('taskStatus.W_Realizacji')}</option>
              <option value="Zakonczone">{t('taskStatus.Zakonczone')}</option>
              <option value="Anulowane">{t('taskStatus.Anulowane')}</option>
            </select>
          </div>
          <div style={styles.filtrGroup}>
            <label style={styles.filtrLabel}>{t('pages.kierownik.filterDate')}</label>
            <input style={styles.filtrSelect} type="date" value={filtrData} onChange={e => setFiltrData(e.target.value)} />
          </div>
          <div style={styles.filtrGroup}>
            <label style={styles.filtrLabel}>{t('pages.kierownik.filterTeam')}</label>
            <select style={styles.filtrSelect} value={filtrEkipa} onChange={e => setFiltrEkipa(e.target.value)}>
              <option value="">{t('common.allTeams')}</option>
              {ekipy.filter(e => !filtrOddzial || e.oddzial_id?.toString() === filtrOddzial).map(e => (
                <option key={e.id} value={e.id}>{e.nazwa}</option>
              ))}
            </select>
          </div>
          <div style={styles.filtrGroup}>
            <label style={styles.filtrLabel}>{t('pages.kierownik.filterSort')}</label>
            <select style={styles.filtrSelect} value={sortBy} onChange={e => setSortBy(e.target.value)}>
              <option value="data">{t('pages.kierownik.sortByDate')}</option>
              <option value="priorytet">{t('pages.kierownik.sortByPriority')}</option>
            </select>
          </div>
          {(filtrOddzial || filtrStatus || filtrData || filtrEkipa) && (
            <button style={styles.clearBtn} onClick={clearFilters}>{t('pages.kierownik.clearFilters')}</button>
          )}
          <div style={styles.filtrCount}>{t('pages.kierownik.countTasks', { count: filtrowane.length })}</div>
        </div>

        {/* Lista zleceń cards-first */}
        {loading ? (
          <div style={styles.loading}>{t('pages.kierownik.loadingTasks')}</div>
        ) : (
          <div style={styles.cardsWrap}>
            {filtrowane.length === 0 ? (
              <div style={{ ...styles.tableWrap, textAlign: 'center', color: 'var(--text-muted)', padding: 60 }}>
                <div style={{ ...styles.emptyIcon, display: 'flex', justifyContent: 'center' }}>
                  <MapOutlined sx={{ fontSize: 48, opacity: 0.35, color: 'var(--text-muted)' }} />
                </div>
                <p>{t('pages.kierownik.emptyFiltered')}</p>
              </div>
            ) : (
              <div style={styles.cardsGrid}>
                {filtrowane.map((z) => (
                  <div key={z.id} style={styles.taskCard}>
                    <div style={styles.taskCardTop}>
                      <span style={styles.idBadge}>#{z.id}</span>
                      <span style={{ ...styles.badge, backgroundColor: STATUS_KOLOR[z.status] || '#6B7280', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <TaskStatusIcon status={z.status} size={14} color="#fff" />
                        {t(`taskStatus.${z.status}`, { defaultValue: z.status })}
                      </span>
                    </div>
                    <div style={styles.klientNazwa}>{z.klient_nazwa}</div>
                    {z.klient_telefon && (
                      <div style={{ ...styles.klientTel, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <LocalPhoneOutlined sx={{ fontSize: 14, flexShrink: 0 }} />
                        {z.klient_telefon}
                      </div>
                    )}
                    <div style={styles.taskMeta}>{z.adres}{z.miasto ? `, ${z.miasto}` : ''}</div>
                    <div style={styles.taskRow}>
                      <span style={styles.oddzialBadge}>{z.oddzial_nazwa || '-'}</span>
                      <span style={styles.taskDate}>{z.data_planowana ? z.data_planowana.split('T')[0] : '-'}</span>
                    </div>
                    {z.priorytet && <span style={styles.priorytetBadge(z.priorytet)}>{z.priorytet}</span>}
                    <div style={styles.taskActions}>
                      <select style={styles.select} value={z.ekipa_id || ''} onChange={e => przypisz(z.id, e.target.value)}>
                        <option value="">{t('common.noneShort')}</option>
                        {ekipyDlaOddzialu(z.oddzial_id).map(e => <option key={e.id} value={e.id}>{e.nazwa}</option>)}
                      </select>
                      <select style={styles.select} value={z.status} onChange={e => zmienStatus(z.id, e.target.value)}>
                        <option value="Nowe">{t('taskStatus.Nowe')}</option>
                        <option value="Zaplanowane">{t('taskStatus.Zaplanowane')}</option>
                        <option value="W_Realizacji">{t('taskStatus.W_Realizacji')}</option>
                        <option value="Zakonczone">{t('taskStatus.Zakonczone')}</option>
                        <option value="Anulowane">{t('taskStatus.Anulowane')}</option>
                      </select>
                      <button style={styles.detailBtn} onClick={() => navigate(`/zlecenia/${z.id}`)}>
                        {t('pages.kierownik.detailsBtn')}
                      </button>
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

const styles = {
  container: { display: 'flex', minHeight: '100vh', backgroundColor: 'var(--bg)' },
  main: { flex: 1, padding: '24px', overflowX: 'hidden' },
  headerRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, flexWrap: 'wrap', gap: 12 },
  title: { fontSize: 'clamp(24px, 5vw, 28px)', fontWeight: 'bold', color: 'var(--accent)', margin: 0 },
  sub: { color: 'var(--text-muted)', marginTop: 4, fontSize: 'clamp(12px, 3vw, 14px)' },
  headerRight: { display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' },
  addBtn: { padding: '10px 20px', backgroundColor: 'var(--bg-deep)', color: '#fff', border: 'none', borderRadius: 10, cursor: 'pointer', fontSize: 14, fontWeight: 'bold', transition: 'all 0.2s', '&:hover': { backgroundColor: 'var(--bg-deep)', transform: 'translateY(-1px)' } },
  oddzialyRow: { display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' },
  oddzialCard: { backgroundColor: 'var(--bg-card)', borderRadius: 12, padding: '12px 16px', cursor: 'pointer', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', minWidth: 140, transition: 'all 0.2s', '&:hover': { transform: 'translateY(-2px)', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' } },
  oddzialNazwa: { fontSize: 13, fontWeight: '600', color: 'var(--text)', marginBottom: 6 },
  oddzialStats: { display: 'flex', gap: 8, fontSize: 11, flexWrap: 'wrap' },
  oddzialTotal: { fontSize: 10, color: 'var(--text-muted)', marginTop: 6 },
  filtryRow: { display: 'flex', gap: 12, marginBottom: 20, alignItems: 'center', flexWrap: 'wrap', backgroundColor: 'var(--bg-card)', padding: '12px 16px', borderRadius: 12, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  filtrGroup: { display: 'flex', alignItems: 'center', gap: 8 },
  filtrLabel: { fontSize: 13, fontWeight: '600', color: 'var(--text-sub)' },
  filtrSelect: { padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, cursor: 'pointer', backgroundColor: 'var(--bg-card)' },
  clearBtn: { padding: '6px 12px', backgroundColor: 'rgba(248,113,113,0.1)', color: '#EF5350', border: '1px solid #FFCDD2', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: '500' },
  filtrCount: { marginLeft: 'auto', fontSize: 13, color: 'var(--accent)', fontWeight: '600' },
  tableWrap: { backgroundColor: 'var(--bg-card)', borderRadius: 12, overflow: 'auto', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  cardsWrap: { display: 'flex', flexDirection: 'column', gap: 10 },
  cardsGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 },
  taskCard: {
    background: 'linear-gradient(150deg, var(--bg-card) 0%, var(--bg-card2) 100%)',
    border: '1px solid var(--border2)',
    borderRadius: 14,
    boxShadow: 'var(--shadow-sm)',
    padding: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  taskCardTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  taskMeta: { fontSize: 12, color: 'var(--text-sub)' },
  taskRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  taskDate: { fontSize: 12, color: 'var(--text-sub)', fontWeight: 600 },
  taskActions: { display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8, alignItems: 'center', marginTop: 4 },
  table: { width: '100%', borderCollapse: 'collapse', minWidth: 900 },
  th: { padding: '12px 14px', backgroundColor: 'var(--bg-deep)', color: '#fff', textAlign: 'left', fontSize: 13, fontWeight: '600', position: 'sticky', top: 0 },
  td: { padding: '11px 14px', fontSize: 13, color: 'var(--text-sub)', borderBottom: '1px solid var(--border)', verticalAlign: 'middle' },
  idBadge: { backgroundColor: 'var(--bg-deep)', color: 'var(--accent)', padding: '2px 8px', borderRadius: 6, fontSize: 13, fontWeight: '600' },
  klientNazwa: { fontWeight: '600', color: 'var(--text)' },
  klientTel: { fontSize: 11, color: 'var(--accent)', marginTop: 2 },
  miasto: { fontSize: 11, color: 'var(--text-muted)', marginTop: 2 },
  badge: { padding: '3px 10px', borderRadius: 20, color: '#fff', fontSize: 11, fontWeight: '600', display: 'inline-block' },
  oddzialBadge: { backgroundColor: 'var(--bg-deep)', color: 'var(--accent)', padding: '2px 8px', borderRadius: 6, fontSize: 12 },
  priorytetBadge: (priorytet) => ({
    display: 'inline-block',
    fontSize: 10,
    padding: '1px 6px',
    borderRadius: 4,
    marginTop: 4,
    backgroundColor: priorytet === 'Pilny' ? '#FFEBEE' : priorytet === 'Wysoki' ? '#FFF8E1' : 'rgba(52,211,153,0.1)',
    color: priorytet === 'Pilny' ? '#EF5350' : priorytet === 'Wysoki' ? '#F9A825' : 'var(--accent)'
  }),
  select: { padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, cursor: 'pointer', backgroundColor: 'var(--bg-card)', minWidth: 130 },
  detailBtn: { padding: '5px 12px', backgroundColor: 'var(--bg-deep)', color: 'var(--accent)', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: '600', transition: 'all 0.2s', '&:hover': { backgroundColor: 'var(--bg-deep)', color: '#fff' } },
  loading: { textAlign: 'center', padding: 60, color: 'var(--text-muted)' },
  emptyIcon: { fontSize: 48, marginBottom: 12, opacity: 0.5 }
};
