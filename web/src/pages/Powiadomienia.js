import { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../api';
import Sidebar from '../components/Sidebar';
import StatusMessage from '../components/StatusMessage';
import PageHeader from '../components/PageHeader';
import NotificationsNoneOutlined from '@mui/icons-material/NotificationsNoneOutlined';
import DoneAllOutlined from '@mui/icons-material/DoneAllOutlined';
import { errorMessage, successMessage } from '../utils/statusMessage';
import useTimedMessage from '../hooks/useTimedMessage';
import { getLocalStorageJson } from '../utils/safeJsonLocalStorage';
import { getStoredToken, authHeaders } from '../utils/storedToken';


const TYP_META = [
  { value: 'skonczylem_wczesniej', labelKey: 'pages.powiadomienia.reqDoneEarlyLabel', descKey: 'pages.powiadomienia.reqDoneEarlyDesc', color: 'var(--accent)', bg: 'rgba(52,211,153,0.1)' },
  { value: 'potrzebuje_czasu', labelKey: 'pages.powiadomienia.reqNeedTimeLabel', descKey: 'pages.powiadomienia.reqNeedTimeDesc', color: '#F9A825', bg: '#FFF8E1' },
  { value: 'problem', labelKey: 'pages.powiadomienia.reqProblemLabel', descKey: 'pages.powiadomienia.reqProblemDesc', color: '#EF5350', bg: '#FFEBEE' },
  { value: 'pytanie', labelKey: 'pages.powiadomienia.reqQuestionLabel', descKey: 'pages.powiadomienia.reqQuestionDesc', color: '#2196F3', bg: '#E3F2FD' },
  { value: 'info', labelKey: 'pages.powiadomienia.reqInfoLabel', descKey: 'pages.powiadomienia.reqInfoDesc', color: 'var(--text-muted)', bg: 'var(--border)' },
];

export default function Powiadomienia() {
  const { t, i18n } = useTranslation();
  const [zlecenia, setZlecenia] = useState([]);
  const [kierownicy, setKierownicy] = useState([]);
  const [powiadomienia, setPowiadomienia] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [sending, setSending] = useState(false);
  const { message: msg, showMessage: showMsg } = useTimedMessage();
  const [unreadCount, setUnreadCount] = useState(0);
  const [form, setForm] = useState({
    to_user_id: '',
    task_id: '',
    typ: 'skonczylem_wczesniej',
    tresc: ''
  });
  const navigate = useNavigate();

  const loadData = useCallback(async () => {
    try {
      const token = getStoredToken();
      const h = authHeaders(token);
      const [zRes, uRes, nRes] = await Promise.all([
        api.get(`/tasks/moje`, { headers: h }),
        api.get(`/uzytkownicy`, { headers: h }),
        api.get(`/notifications`, { headers: h }),
      ]);
      setZlecenia(zRes.data);
      setKierownicy(uRes.data.filter(u => u.rola === 'Kierownik' || u.rola === 'Dyrektor' || u.rola === 'Administrator'));
      const notifications = nRes.data.notifications || nRes.data || [];
      setPowiadomienia(notifications);
      setUnreadCount(nRes.data.unread_count || notifications.filter(n => n.status === 'Nowe').length);
    } catch (err) {
      console.log('Błąd ładowania:', err);
      showMsg(errorMessage(t('common.loadDataError')));
    } finally {
      setLoading(false);
    }
  }, [showMsg, t]);

  useEffect(() => {
    if (!getStoredToken()) { navigate('/'); return; }
    const u = getLocalStorageJson('user');
    if (!u) { navigate('/'); return; }
    loadData();
  }, [navigate, loadData]);

  const wyslij = async (e) => {
    e.preventDefault();
    if (!form.to_user_id) {
      showMsg(errorMessage(t('common.selectRecipient')));
      return;
    }
    setSending(true);
    try {
      const token = getStoredToken();
      await api.post(`/notifications`, { ...form, tresc: form.tresc.trim() }, {
        headers: authHeaders(token)
      });
      showMsg(successMessage(t('common.sentSuccess')));
      setShowForm(false);
      setForm({ to_user_id: '', task_id: '', typ: 'skonczylem_wczesniej', tresc: '' });
      loadData();
    } catch (err) {
      showMsg(errorMessage(t('common.sendError')));
    } finally {
      setSending(false);
    }
  };

  const odczytaj = async (id) => {
    try {
      const token = getStoredToken();
      await api.put(`/notifications/${id}/odczytaj`, {}, {
        headers: authHeaders(token)
      });
      loadData();
    } catch (err) {
      console.log(err);
    }
  };

  const odczytajWszystkie = async () => {
    try {
      const token = getStoredToken();
      await api.put(`/notifications/odczytaj-wszystkie`, {}, {
        headers: authHeaders(token)
      });
      showMsg(successMessage(t('pages.powiadomienia.markAllSuccess')));
      loadData();
    } catch (err) {
      showMsg(errorMessage(t('pages.powiadomienia.markAllError')));
    }
  };

  const usunPowiadomienie = async (id) => {
    if (!window.confirm(t('pages.powiadomienia.confirmDelete'))) return;
    try {
      const token = getStoredToken();
      await api.delete(`/notifications/${id}`, {
        headers: authHeaders(token)
      });
      showMsg(successMessage(t('pages.powiadomienia.deleteSuccess')));
      loadData();
    } catch (err) {
      showMsg(errorMessage('Błąd usuwania'));
    }
  };

  const fmtTime = (d) => {
    if (!d) return '';
    const date = new Date(d);
    const now = new Date();
    const diff = Math.floor((now - date) / 60000);
    const loc = i18n.language === 'uk' ? 'uk-UA' : i18n.language === 'ru' ? 'ru-RU' : 'pl-PL';
    if (diff < 1) return t('time.justNow');
    if (diff < 60) return t('time.minutesAgo', { count: diff });
    if (diff < 1440) return t('time.hoursAgo', { count: Math.floor(diff / 60) });
    return date.toLocaleDateString(loc);
  };

  const typChoices = useMemo(() => TYP_META.map((row) => ({
    ...row,
    label: t(row.labelKey),
    desc: t(row.descKey),
  })), [t]);

  const getTypInfo = (typ) => {
    return typChoices.find((x) => x.value === typ) || {
      label: t(`notifType.${typ}`, { defaultValue: typ }),
      color: 'var(--text-muted)',
      bg: 'var(--border)',
    };
  };
  const isNotificationValid = Boolean(form.to_user_id);

  return (
    <div style={styles.container}>
      <Sidebar />
      <div style={styles.main}>
        {/* Nagłówek */}
        <PageHeader
          variant="plain"
          title={t('pages.powiadomienia.title')}
          subtitle={t('pages.powiadomienia.subtitle')}
          icon={<NotificationsNoneOutlined style={{ fontSize: 26 }} />}
          actions={
            <>
              <StatusMessage message={msg} />
              {unreadCount > 0 && (
                <button type="button" style={styles.readAllBtn} onClick={odczytajWszystkie}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <DoneAllOutlined style={{ fontSize: 18 }} aria-hidden />
                    {t('pages.powiadomienia.markAllRead')}
                  </span>
                </button>
              )}
              <button type="button" style={styles.addBtn} onClick={() => setShowForm(!showForm)}>
                {showForm ? t('common.cancel') : `+ ${t('pages.powiadomienia.newRequest')}`}
              </button>
            </>
          }
        />

        {/* Formularz nowego zgłoszenia */}
        {showForm && (
          <div style={styles.formBox}>
            <h3 style={styles.formTitle}>{t('pages.powiadomienia.formTitle')}</h3>
            <form onSubmit={wyslij}>
              <div style={styles.grid}>
                <div style={styles.field}>
                  <label style={styles.label}>{t('pages.powiadomienia.typeLabel')}</label>
                  <div style={styles.typyGrid}>
                    {typChoices.map((typRow) => (
                      <div
                        key={typRow.value}
                        style={{
                          ...styles.typCard,
                          borderColor: form.typ === typRow.value ? typRow.color : 'var(--border)',
                          backgroundColor: form.typ === typRow.value ? typRow.bg : 'var(--bg-card)'
                        }}
                        onClick={() => setForm({...form, typ: typRow.value})}
                      >
                        <div style={{fontWeight: 'bold', fontSize: 14}}>{typRow.label}</div>
                        <div style={{fontSize: 11, color: 'var(--text-muted)', marginTop: 2}}>{typRow.desc}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div style={styles.field}>
                  <label style={styles.label}>{t('pages.powiadomienia.taskOptional')}</label>
                  <select style={styles.input} value={form.task_id} onChange={e => setForm({...form, task_id: e.target.value})}>
                    <option value="">{t('common.noneShort')}</option>
                    {zlecenia.map(z => (
                      <option key={z.id} value={z.id}>#{z.id} {z.klient_nazwa} - {z.adres}</option>
                    ))}
                  </select>
                  <div style={styles.hint}>{t('pages.powiadomienia.taskHint')}</div>
                </div>

                <div style={styles.field}>
                  <label style={styles.label}>{t('pages.powiadomienia.sendTo')}</label>
                  <select style={styles.input} value={form.to_user_id} onChange={e => setForm({...form, to_user_id: e.target.value})} required>
                    <option value="">{t('pages.powiadomienia.recipientPlaceholder')}</option>
                    {kierownicy.map(k => (
                      <option key={k.id} value={k.id}>{k.imie} {k.nazwisko} ({k.rola})</option>
                    ))}
                  </select>
                </div>
              </div>

              <div style={styles.field}>
                <label style={styles.label}>{t('pages.powiadomienia.messageOptional')}</label>
                <textarea style={{...styles.input, height: 80, resize: 'vertical'}}
                  value={form.tresc}
                  onChange={e => setForm({...form, tresc: e.target.value})}
                  placeholder={t('pages.powiadomienia.messagePlaceholder')} />
              </div>

              <div style={styles.btnRow}>
                <button type="button" style={styles.cancelBtn} onClick={() => setShowForm(false)}>{t('common.cancel')}</button>
                <button type="submit" style={styles.submitBtn} disabled={sending || !isNotificationValid}>
                  {sending ? t('common.sending') : t('pages.powiadomienia.submit')}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Lista powiadomień */}
        <div style={styles.card}>
          <div style={styles.cardHeader}>
            <div style={styles.cardTitle}>
              {t('pages.powiadomienia.historyTitle', { count: powiadomienia.length })}
              {unreadCount > 0 && <span style={styles.unreadBadge}>{t('pages.powiadomienia.newBadge', { count: unreadCount })}</span>}
            </div>
          </div>

          {loading ? (
            <div style={styles.loading}>{t('pages.powiadomienia.loading')}</div>
          ) : powiadomienia.length === 0 ? (
            <div style={styles.empty}>
              <div style={styles.emptyIcon}>🔔</div>
              <p>{t('pages.powiadomienia.emptyTitle')}</p>
              <p style={styles.emptySub}>{t('pages.powiadomienia.emptyHint')}</p>
            </div>
          ) : (
            <div>
              {powiadomienia.map(n => {
                const typInfo = getTypInfo(n.typ);
                return (
                  <div
                    key={n.id}
                    style={{
                      ...styles.notifItem,
                      backgroundColor: n.status === 'Nowe' ? 'var(--bg)' : 'var(--bg-card)',
                      borderLeft: `4px solid ${typInfo.color}`
                    }}
                  >
                    <div
                      style={{
                        ...styles.notifIcon,
                        fontSize: 11,
                        fontWeight: 800,
                        color: typInfo.color,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderRadius: 10,
                        backgroundColor: typInfo.bg,
                      }}
                      aria-hidden
                    >
                      {String(typInfo.label || '?').slice(0, 1).toUpperCase()}
                    </div>
                    <div style={styles.notifContent}>
                      <div style={styles.notifHeader}>
                        <span style={styles.notifOd}>
                          {n.od_kogo ? `${t('sidebar.fromPrefix')} ${n.od_kogo}` : t('pages.powiadomienia.fromSystem')}
                        </span>
                        <span style={{...styles.notifStatus, color: n.status === 'Nowe' ? '#F9A825' : '#4CAF50'}}>
                          {n.status === 'Nowe' ? t('pages.powiadomienia.statusNew') : t('pages.powiadomienia.statusRead')}
                        </span>
                      </div>
                      <div style={{...styles.notifTyp, color: typInfo.color}}>
                        {typInfo.label}
                      </div>
                      {n.tresc && <div style={styles.notifTresc}>"{n.tresc}"</div>}
                      {n.klient_nazwa && (
                        <div
                          style={styles.notifTask}
                          onClick={() => navigate(`/zlecenia/${n.task_id}`)}
                        >
                          {t('pages.powiadomienia.taskLine', { client: n.klient_nazwa, address: n.adres })}
                        </div>
                      )}
                      <div style={styles.notifFooter}>
                        <span style={styles.notifTime}>{fmtTime(n.data_utworzenia)}</span>
                        <div style={styles.notifActions}>
                          {n.status === 'Nowe' && (
                            <button style={styles.readBtn} onClick={() => odczytaj(n.id)}>{t('pages.powiadomienia.markRead')}</button>
                          )}
                          <button style={styles.deleteBtn} onClick={() => usunPowiadomienie(n.id)}>{t('pages.powiadomienia.delete')}</button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
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
  readAllBtn: { padding: '8px 16px', backgroundColor: 'var(--bg-deep)', color: 'var(--accent)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: '500', transition: 'all 0.2s', '&:hover': { backgroundColor: 'var(--border2)' } },
  addBtn: { padding: '10px 20px', backgroundColor: 'var(--bg-deep)', color: '#fff', border: 'none', borderRadius: 10, cursor: 'pointer', fontSize: 14, fontWeight: 'bold', transition: 'all 0.2s', '&:hover': { backgroundColor: 'var(--bg-deep)', transform: 'translateY(-1px)' } },
  formBox: { backgroundColor: 'var(--bg-card)', borderRadius: 16, padding: 24, marginBottom: 20, boxShadow: '0 1px 4px rgba(0,0,0,0.08)' },
  formTitle: { fontSize: 18, fontWeight: 'bold', color: 'var(--accent)', marginBottom: 20, paddingBottom: 12, borderBottom: '1px solid var(--border)' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 20, marginBottom: 16 },
  field: { display: 'flex', flexDirection: 'column', gap: 8 },
  label: { fontSize: 13, fontWeight: '600', color: 'var(--text-sub)' },
  input: { padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', fontSize: 14, outline: 'none', width: '100%', boxSizing: 'border-box', transition: 'all 0.2s', '&:focus': { borderColor: 'var(--accent)', boxShadow: '0 0 0 2px rgba(46,125,50,0.1)' } },
  hint: { fontSize: 11, color: 'var(--text-muted)', marginTop: 4 },
  typyGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 },
  typCard: {
    padding: '10px 14px',
    borderRadius: 10,
    borderWidth: 2,
    borderStyle: 'solid',
    borderColor: 'var(--border)',
    cursor: 'pointer',
    transition: 'all 0.2s',
    '&:hover': { transform: 'translateX(4px)' },
  },
  btnRow: { display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 16 },
  cancelBtn: { padding: '10px 20px', backgroundColor: 'var(--bg-card)', border: 'none', borderRadius: 10, cursor: 'pointer', fontSize: 14, transition: 'all 0.2s', '&:hover': { backgroundColor: '#D1D5DB' } },
  submitBtn: { padding: '10px 24px', backgroundColor: 'var(--bg-deep)', color: '#fff', border: 'none', borderRadius: 10, cursor: 'pointer', fontSize: 14, fontWeight: 'bold', transition: 'all 0.2s', '&:hover': { backgroundColor: 'var(--bg-deep)', transform: 'translateY(-1px)' } },
  card: { backgroundColor: 'var(--bg-card)', borderRadius: 16, padding: 20, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  cardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 },
  cardTitle: { fontSize: 16, fontWeight: 'bold', color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 8 },
  unreadBadge: { backgroundColor: '#F9A825', color: '#fff', padding: '2px 10px', borderRadius: 20, fontSize: 11, fontWeight: '600' },
  loading: { textAlign: 'center', padding: 40, color: 'var(--text-muted)' },
  empty: { textAlign: 'center', padding: 60, color: 'var(--text-muted)' },
  emptyIcon: { fontSize: 48, marginBottom: 12, opacity: 0.5 },
  emptySub: { fontSize: 12, marginTop: 4, opacity: 0.7 },
  notifItem: { display: 'flex', gap: 12, padding: '16px', borderRadius: 12, marginBottom: 12, border: '1px solid var(--border)', transition: 'all 0.2s', '&:hover': { transform: 'translateX(4px)', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' } },
  notifIcon: { fontSize: 28, flexShrink: 0 },
  notifContent: { flex: 1 },
  notifHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, flexWrap: 'wrap', gap: 6 },
  notifOd: { fontSize: 13, fontWeight: '600', color: 'var(--text)' },
  notifStatus: { fontSize: 11, fontWeight: '600' },
  notifTyp: { fontSize: 13, fontWeight: '600', marginBottom: 6 },
  notifTresc: { fontSize: 13, color: 'var(--text-muted)', marginBottom: 8, fontStyle: 'italic', backgroundColor: 'var(--bg-card)', padding: '8px 12px', borderRadius: 8 },
  notifTask: { fontSize: 12, color: 'var(--accent)', cursor: 'pointer', marginBottom: 8, display: 'inline-block', backgroundColor: 'var(--bg-deep)', padding: '4px 10px', borderRadius: 6, '&:hover': { textDecoration: 'underline' } },
  notifFooter: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, flexWrap: 'wrap', gap: 8 },
  notifTime: { fontSize: 11, color: 'var(--text-muted)' },
  notifActions: { display: 'flex', gap: 8 },
  readBtn: { padding: '4px 10px', backgroundColor: 'var(--bg-deep)', color: 'var(--accent)', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: '500', transition: 'all 0.2s', '&:hover': { backgroundColor: 'var(--border2)' } },
  deleteBtn: { padding: '4px 10px', backgroundColor: 'rgba(248,113,113,0.1)', color: '#EF5350', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: '500', transition: 'all 0.2s', '&:hover': { backgroundColor: '#FFCDD2' } }
};
