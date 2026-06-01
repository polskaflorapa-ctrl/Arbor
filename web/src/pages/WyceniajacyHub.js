import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Sidebar from '../components/Sidebar';
import api from '../api';
import { getApiErrorMessage } from '../utils/apiError';
import { readStoredUser } from '../utils/readStoredUser';
import { getStoredToken, authHeaders } from '../utils/storedToken';

const isToday = (dateLike) => {
  if (!dateLike) return false;
  return String(dateLike).split('T')[0] === new Date().toISOString().split('T')[0];
};

function hubFilterItems(items, user) {
  if (!user) return [];
  const userId = user.id != null ? String(user.id) : '';
  const userOddzialId = user.oddzial_id != null ? String(user.oddzial_id) : '';
  return items.filter((item) => {
    const sameOddzial =
      !userOddzialId || item.oddzial_id == null || String(item.oddzial_id) === userOddzialId;
    const assignedToUser =
      item.wyceniajacy_id == null || !userId || String(item.wyceniajacy_id) === userId;
    return sameOddzial && assignedToUser;
  });
}

export default function WyceniajacyHub() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [sessionUser, setSessionUser] = useState(null);
  const [runtimeError, setRuntimeError] = useState('');

  const load = useCallback(async () => {
    setRuntimeError('');
    try {
      const token = getStoredToken();
      if (!token) {
        navigate('/');
        return;
      }
      const u = readStoredUser();
      setSessionUser(u);
      const res = await api.get('/ogledziny', { headers: authHeaders(token) });
      const raw = res.data;
      const source = Array.isArray(raw) ? raw : (raw?.items ?? []);
      setItems(hubFilterItems(source, u));
    } catch (e) {
      setItems([]);
      setRuntimeError(getApiErrorMessage(e, t('hub.loadError')));
    } finally {
      setLoading(false);
    }
  }, [navigate, t]);

  useEffect(() => {
    if (!getStoredToken()) navigate('/');
    else void load();
  }, [navigate, load]);

  const today = useMemo(() => items.filter((item) => isToday(item.data_planowana)), [items]);
  const todayDone = useMemo(() => today.filter((item) => item.status === 'Zakonczone'), [today]);
  const todayPlanned = today.length;
  const todayLeft = Math.max(0, todayPlanned - todayDone.length);

  const todayTargetHint = useMemo(() => {
    if (todayPlanned < 6) return t('hub.targetBelow');
    if (todayPlanned > 15) return t('hub.targetAbove');
    return t('hub.targetOk');
  }, [todayPlanned, t]);

  const S = {
    wrap: { display: 'flex', minHeight: '100vh', background: 'var(--bg)' },
    main: { flex: 1, padding: '24px 28px 40px', maxWidth: 720 },
    hero: {
      padding: '20px 0 8px',
      borderBottom: '1px solid var(--border)',
      marginBottom: 16,
    },
    title: { margin: 0, fontSize: 22, fontWeight: 800, color: 'var(--text)' },
    sub: { margin: '8px 0 0', fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.45 },
    platinum: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      marginBottom: 12,
      padding: '10px 12px',
      borderRadius: 10,
      border: '1px solid color-mix(in srgb, var(--accent) 45%, transparent)',
      background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
      fontSize: 11,
      fontWeight: 800,
      letterSpacing: 1.05,
      textTransform: 'uppercase',
      color: 'var(--accent)',
    },
    error: {
      marginBottom: 12,
      padding: '10px 12px',
      borderRadius: 10,
      border: '1px solid color-mix(in srgb, var(--warning, #b45309) 40%, transparent)',
      background: 'color-mix(in srgb, var(--warning, #b45309) 14%, transparent)',
      color: 'var(--warning, #b45309)',
      fontSize: 13,
      fontWeight: 600,
    },
    kpiRow: { display: 'flex', gap: 10, marginBottom: 12 },
    kpiCard: {
      flex: 1,
      padding: 14,
      borderRadius: 12,
      border: '1px solid var(--border)',
      background: 'var(--card)',
      textAlign: 'center',
    },
    kpiNum: { fontSize: 22, fontWeight: 900, color: 'var(--accent)', letterSpacing: 0.02 },
    kpiLabel: { fontSize: 11, color: 'var(--text-muted)', marginTop: 6, fontWeight: 600 },
    hintBox: {
      padding: '10px 12px',
      borderRadius: 10,
      marginBottom: 16,
      border: '1px solid color-mix(in srgb, var(--accent) 25%, transparent)',
      background: 'var(--accent-surface, color-mix(in srgb, var(--accent) 8%, transparent))',
      fontSize: 13,
      color: 'var(--info, var(--accent))',
      fontWeight: 700,
      lineHeight: 1.4,
    },
    section: {
      marginBottom: 16,
      padding: 16,
      borderRadius: 12,
      border: '1px solid var(--border)',
      background: 'var(--card)',
    },
    secTitle: { margin: '0 0 12px', fontSize: 15, fontWeight: 800, color: 'var(--text)' },
    grid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(148px, 1fr))',
      gap: 10,
    },
    tile: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
      minHeight: 88,
      padding: '14px 10px',
      borderRadius: 12,
      border: '1px solid color-mix(in srgb, var(--accent) 28%, transparent)',
      background: 'var(--surface-field)',
      cursor: 'pointer',
      fontFamily: 'inherit',
      fontSize: 12,
      fontWeight: 800,
      color: 'var(--text)',
      textAlign: 'center',
      lineHeight: 1.35,
      transition: 'background 0.15s ease, border-color 0.15s ease',
    },
    flowTxt: {
      margin: '0 0 8px',
      fontSize: 13,
      color: 'var(--text-muted)',
      lineHeight: 1.5,
      paddingRight: 4,
    },
  };

  const quickActions = useMemo(() => {
    const rola = sessionUser?.rola;
    const payRoles = ['Dyrektor', 'Administrator', 'Kierownik', 'Wyceniający'];
    const quotesRoles = ['Dyrektor', 'Administrator', 'Kierownik', 'Wyceniający', 'Specjalista'];
    const list = [];
    list.push({
      key: 'inspection',
      label: t('hub.action.inspectionList'),
      onClick: () => navigate('/ogledziny'),
    });
    list.push({
      key: 'cal',
      label: t('hub.action.quoteCalendar'),
      onClick: () => navigate('/wycena-kalendarz'),
    });
    list.push({
      key: 'newq',
      label: t('hub.action.newQuote'),
      onClick: () => navigate('/wycena-kalendarz'),
    });
    list.push({
      key: 'field',
      label: t('hub.action.fieldQuotes'),
      onClick: () => navigate('/wyceny-terenowe'),
      show: quotesRoles.includes(rola),
    });
    list.push({
      key: 'pay',
      label: t('hub.action.estimatorPay'),
      onClick: () => navigate('/wynagrodzenie-wyceniajacych'),
      show: payRoles.includes(rola),
    });
    list.push({
      key: 'approve',
      label: t('hub.action.approveQuotes'),
      onClick: () => navigate('/zatwierdz-wyceny'),
      show: ['Kierownik', 'Administrator', 'Dyrektor', 'Specjalista'].includes(rola),
    });
    return list.filter((x) => x.show !== false);
  }, [sessionUser?.rola, t, navigate]);

  if (loading) {
    return (
      <div className="estimator-hub-shell" style={S.wrap}>
        <Sidebar />
        <main className="estimator-hub-main" style={{ ...S.main, color: 'var(--text-muted)' }}>{t('hub.loading')}</main>
      </div>
    );
  }

  return (
    <div className="estimator-hub-shell" style={S.wrap}>
      <Sidebar />
      <main className="estimator-hub-main" style={S.main}>
        <div className="estimator-hub-hero" style={S.hero}>
          <h1 style={S.title}>{t('hub.title')}</h1>
          <p style={S.sub}>{t('hub.subtitle')}</p>
        </div>

        <div className="estimator-hub-platinum" style={S.platinum}>{t('hub.platinumBar')}</div>

        {runtimeError ? <div className="estimator-hub-error" style={S.error}>{runtimeError}</div> : null}

        <div className="estimator-hub-kpis" style={S.kpiRow}>
          <div className="estimator-hub-kpi-card" style={S.kpiCard}>
            <div style={S.kpiNum}>{todayPlanned}</div>
            <div style={S.kpiLabel}>{t('hub.kpi.today')}</div>
          </div>
          <div className="estimator-hub-kpi-card" style={S.kpiCard}>
            <div style={S.kpiNum}>{todayLeft}</div>
            <div style={S.kpiLabel}>{t('hub.kpi.left')}</div>
          </div>
          <div className="estimator-hub-kpi-card" style={S.kpiCard}>
            <div style={S.kpiNum}>{todayDone.length}</div>
            <div style={S.kpiLabel}>{t('hub.kpi.done')}</div>
          </div>
        </div>

        <div className="estimator-hub-hint" style={S.hintBox}>
          {todayTargetHint}
          {sessionUser?.oddzial_nazwa ? ` · ${sessionUser.oddzial_nazwa}` : ''}
        </div>

        <div className="estimator-hub-section estimator-hub-actions" style={S.section}>
          <h2 style={S.secTitle}>{t('hub.quickActions')}</h2>
          <div className="estimator-hub-grid" style={S.grid}>
            {quickActions.map((a) => (
              <button className="estimator-hub-tile" key={a.key} type="button" style={S.tile} onClick={a.onClick}>
                {a.label}
              </button>
            ))}
          </div>
        </div>

        <div className="estimator-hub-section estimator-hub-workflow" style={S.section}>
          <h2 style={S.secTitle}>{t('hub.workflowTitle')}</h2>
          <p style={S.flowTxt}>{t('hub.flow1')}</p>
          <p style={S.flowTxt}>{t('hub.flow2')}</p>
          <p style={S.flowTxt}>{t('hub.flow3')}</p>
          <p style={{ ...S.flowTxt, marginBottom: 0 }}>{t('hub.flow4')}</p>
        </div>
      </main>
    </div>
  );
}
