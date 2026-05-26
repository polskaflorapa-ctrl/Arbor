import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../api';
import Sidebar from '../components/Sidebar';
import PageHeader from '../components/PageHeader';
import StatusMessage from '../components/StatusMessage';
import ModernDataRow from '../components/ModernDataRow';
import { getApiErrorMessage } from '../utils/apiError';
import { getLocalStorageJson } from '../utils/safeJsonLocalStorage';
import { getStoredToken, authHeaders } from '../utils/storedToken';

function currentYm() {
  return new Date().toISOString().slice(0, 7);
}

function extForFormat(fmt) {
  if (fmt === 'symfonia' || fmt === 'comarch') return 'txt';
  return 'csv';
}

function PayrollLineCorrectionRow({ line, reportId, locked, saving, onSave, t, btnPri, inp }) {
  const [hours, setHours] = useState(String(line.hours_total ?? ''));
  const [pay, setPay] = useState(String(line.pay_pln ?? ''));
  const [note, setNote] = useState('');
  useEffect(() => {
    setHours(String(line.hours_total ?? ''));
    setPay(String(line.pay_pln ?? ''));
    setNote('');
  }, [line.id, line.hours_total, line.pay_pln]);

  const userLabel = [line.user_imie, line.user_nazwisko].filter(Boolean).join(' ') || `user #${line.user_id}`;

  const submit = () => {
    const h = parseFloat(String(hours).replace(',', '.'), 10);
    const p = parseFloat(String(pay).replace(',', '.'), 10);
    if (!Number.isFinite(h) || !Number.isFinite(p) || h < 0 || p < 0) {
      return;
    }
    const payload = { hours_total: h, pay_pln: p };
    if (note.trim()) payload.correction_note = note.trim();
    void onSave(reportId, line.id, payload);
  };

  return (
    <ModernDataRow
      idLabel="Payroll Line"
      idValue={`LINE-${line.id}`}
      title={userLabel}
      subtitle={locked ? t('payrollM11.reportApproved') : t('payrollM11.reportPending')}
      tone={locked ? 'success' : 'warning'}
      status={locked ? 'LOCKED' : 'EDITABLE'}
      statusValue={locked ? 'success' : 'warning'}
      statusState={locked ? 'success' : 'warning'}
      metrics={[
        { label: t('payrollM11.thHours'), value: locked ? line.hours_total : <input style={{ ...inp, maxWidth: 100 }} value={hours} onChange={(e) => setHours(e.target.value)} /> },
        { label: t('payrollM11.thPay'), value: locked ? fmtPln(line.pay_pln) : <input style={{ ...inp, maxWidth: 110 }} value={pay} onChange={(e) => setPay(e.target.value)} />, tone: 'success' },
        { label: t('payrollM11.thNote'), value: locked ? '—' : <input style={{ ...inp, maxWidth: 200 }} placeholder={t('payrollM11.lineCorrectionNotePh')} value={note} onChange={(e) => setNote(e.target.value)} />, mono: false },
      ]}
      actions={!locked ? (
        <button type="button" style={btnPri} disabled={saving} onClick={submit}>
          {saving ? '…' : t('payrollM11.lineCorrectionSave')}
        </button>
      ) : null}
    />
  );
}

export default function PayrollM11() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [user, setUser] = useState(() => getLocalStorageJson('user', {}));
  const [month, setMonth] = useState(currentYm);
  const [msg, setMsg] = useState('');
  const [accrual, setAccrual] = useState([]);
  const [loadingAccrual, setLoadingAccrual] = useState(false);
  const [exportStatus, setExportStatus] = useState({
    export_allowed: true,
    pending_count: 0,
    pending_reports: [],
    skip_check_active: false,
  });
  const [dayReports, setDayReports] = useState([]);
  const [loadingReports, setLoadingReports] = useState(false);
  const [onlyPendingReports, setOnlyPendingReports] = useState(true);
  const [savingLineId, setSavingLineId] = useState(null);
  const [correctionLog, setCorrectionLog] = useState([]);
  const [loadingCorrectionLog, setLoadingCorrectionLog] = useState(false);

  const canSee = useMemo(
    () => user && ['Prezes', 'Dyrektor', 'Kierownik'].includes(user.rola),
    [user]
  );

  useEffect(() => {
    const token = getStoredToken();
    if (!token) {
      navigate('/');
      return;
    }
    setUser(getLocalStorageJson('user', {}));
  }, [navigate]);

  const roleReady = user && user.rola;

  const monthParam = `${month}-01`;
  const visibleDayReports = useMemo(
    () => (onlyPendingReports ? dayReports.filter((r) => !r.approved_at) : dayReports),
    [dayReports, onlyPendingReports]
  );

  const loadAccrual = useCallback(async () => {
    const token = getStoredToken();
    if (!token || !canSee) return;
    setLoadingAccrual(true);
    setMsg('');
    try {
      const { data } = await api.get('/payroll/estimator-accrual', {
        headers: authHeaders(token),
        params: { month: monthParam },
      });
      setAccrual(Array.isArray(data) ? data : []);
    } catch (e) {
      setAccrual([]);
      setMsg(getApiErrorMessage(e, t('payrollM11.accrualError')));
    } finally {
      setLoadingAccrual(false);
    }
  }, [canSee, monthParam, t]);

  useEffect(() => {
    if (canSee) loadAccrual();
  }, [canSee, loadAccrual]);

  const loadExportStatus = useCallback(async () => {
    const token = getStoredToken();
    if (!token || !canSee) return;
    try {
      const { data } = await api.get('/payroll/month-close-status', {
        headers: authHeaders(token),
        params: { month: monthParam },
      });
      setExportStatus({
        export_allowed: data.export_allowed !== false,
        pending_count: Number(data.pending_count) || 0,
        pending_reports: Array.isArray(data.pending_reports) ? data.pending_reports : [],
        skip_check_active: !!data.skip_check_active,
      });
    } catch {
      setExportStatus({ export_allowed: true, pending_count: 0, pending_reports: [], skip_check_active: false });
    }
  }, [canSee, monthParam]);

  useEffect(() => {
    if (canSee) void loadExportStatus();
  }, [canSee, loadExportStatus]);

  const loadDayReports = useCallback(async () => {
    const token = getStoredToken();
    if (!token || !canSee) return;
    setLoadingReports(true);
    try {
      const { data } = await api.get('/payroll/team-day-reports', {
        headers: authHeaders(token),
        params: { month: monthParam },
      });
      setDayReports(Array.isArray(data) ? data : []);
    } catch (e) {
      setDayReports([]);
      setMsg(getApiErrorMessage(e, t('payrollM11.dayReportsError')));
    } finally {
      setLoadingReports(false);
    }
  }, [canSee, monthParam, t]);

  useEffect(() => {
    if (canSee) void loadDayReports();
  }, [canSee, loadDayReports]);

  const loadCorrectionLog = useCallback(async () => {
    const token = getStoredToken();
    if (!token || !canSee) return;
    setLoadingCorrectionLog(true);
    try {
      const { data } = await api.get('/payroll/line-correction-log', {
        headers: authHeaders(token),
        params: { month: monthParam },
      });
      setCorrectionLog(Array.isArray(data) ? data : []);
    } catch (e) {
      setCorrectionLog([]);
      setMsg(getApiErrorMessage(e, t('payrollM11.correctionLogError')));
    } finally {
      setLoadingCorrectionLog(false);
    }
  }, [canSee, monthParam, t]);

  useEffect(() => {
    if (canSee) void loadCorrectionLog();
  }, [canSee, loadCorrectionLog]);

  const downloadCorrectionLogCsv = useCallback(() => {
    const token = getStoredToken();
    if (!token) return;
    setMsg('');
    const q = new URLSearchParams({ month });
    api
      .get(`/payroll/line-correction-log.csv?${q}`, { headers: authHeaders(token), responseType: 'blob' })
      .then((res) => {
        const url = window.URL.createObjectURL(res.data);
        const a = document.createElement('a');
        a.href = url;
        a.download = `payroll_line_correction_log_${month}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
      })
      .catch(async (e) => {
        if (e.response?.data instanceof Blob) {
          try {
            const text = await e.response.data.text();
            const j = JSON.parse(text);
            setMsg(j.error || t('payrollM11.correctionLogExportError'));
          } catch {
            setMsg(t('payrollM11.correctionLogExportError'));
          }
          return;
        }
        setMsg(getApiErrorMessage(e, t('payrollM11.correctionLogExportError')));
      });
  }, [month, t]);

  const saveLineCorrection = async (reportId, lineId, payload) => {
    const token = getStoredToken();
    if (!token) return;
    setSavingLineId(lineId);
    setMsg('');
    try {
      await api.patch(`/payroll/team-day-report/${reportId}/lines/${lineId}`, payload, {
        headers: authHeaders(token),
      });
      setMsg(t('payrollM11.lineCorrectionSaved'));
      await loadDayReports();
      await loadCorrectionLog();
      await loadExportStatus();
    } catch (e) {
      setMsg(getApiErrorMessage(e, t('payrollM11.lineCorrectionError')));
    } finally {
      setSavingLineId(null);
    }
  };

  const approveTeamDayReport = async (reportId) => {
    const token = getStoredToken();
    if (!token) return;
    setMsg('');
    try {
      await api.post(`/payroll/team-day-report/${reportId}/approve`, {}, { headers: authHeaders(token) });
      setMsg('Raport dnia został zatwierdzony.');
      await loadDayReports();
      await loadExportStatus();
    } catch (e) {
      setMsg(getApiErrorMessage(e, 'Nie udało się zatwierdzić raportu dnia.'));
    }
  };

  const handleExportBlobError = async (e) => {
    if (e.response?.status === 409) {
      let text = '';
      try {
        const body = e.response.data;
        text = body instanceof Blob ? await body.text() : JSON.stringify(body);
        const j = JSON.parse(text);
        setMsg(j.error || t('payrollM11.exportBlocked'));
      } catch {
        setMsg(t('payrollM11.exportBlocked'));
      }
      void loadExportStatus();
      return;
    }
    setMsg(t('payrollM11.exportError'));
  };

  const downloadExport = (format) => {
    const token = getStoredToken();
    if (!token) return;
    if (!exportStatus.export_allowed && !exportStatus.skip_check_active) {
      setMsg(t('payrollM11.exportBlocked'));
      return;
    }
    setMsg('');
    const q = new URLSearchParams({ month, format });
    api
      .get(`/payroll/export.csv?${q}`, { headers: authHeaders(token), responseType: 'blob' })
      .then((res) => {
        const url = window.URL.createObjectURL(res.data);
        const a = document.createElement('a');
        a.href = url;
        a.download = `payroll_${month}_${format}.${extForFormat(format)}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
      })
      .catch(handleExportBlobError);
  };

  const downloadExportZip = () => {
    const token = getStoredToken();
    if (!token) return;
    if (!exportStatus.export_allowed && !exportStatus.skip_check_active) {
      setMsg(t('payrollM11.exportBlocked'));
      return;
    }
    setMsg('');
    const q = new URLSearchParams({ month });
    api
      .get(`/payroll/export.zip?${q}`, { headers: authHeaders(token), responseType: 'blob' })
      .then((res) => {
        const url = window.URL.createObjectURL(res.data);
        const a = document.createElement('a');
        a.href = url;
        a.download = `payroll_${month}_all.zip`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
      })
      .catch(handleExportBlobError);
  };

  if (roleReady && !canSee) {
    return (
      <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg)' }}>
        <Sidebar />
        <div style={{ flex: 1, padding: '20px 24px 40px' }}>
          <PageHeader title={t('payrollM11.title')} subtitle={t('payrollM11.noAccess')} />
        </div>
      </div>
    );
  }

  if (!canSee) {
    return (
      <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg)' }}>
        <Sidebar />
        <div style={{ flex: 1, padding: '20px 24px 40px' }}>
          <PageHeader title={t('payrollM11.title')} subtitle={t('payrollM11.loading')} />
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg)' }}>
      <Sidebar />
      <div style={{ flex: 1, padding: '20px 24px 40px', overflow: 'auto' }}>
        <PageHeader title={t('payrollM11.title')} subtitle={t('payrollM11.subtitle')} />
        <StatusMessage message={msg} />

        {!exportStatus.export_allowed && !exportStatus.skip_check_active ? (
          <div
            style={{
              ...card,
              marginBottom: 16,
              borderColor: 'var(--warning, #ca8a04)',
              background: 'rgba(202, 138, 4, 0.08)',
            }}
          >
            <p style={{ margin: 0, fontSize: 14, color: 'var(--text)' }}>
              {t('payrollM11.exportPendingBanner', { count: exportStatus.pending_count })}
            </p>
            {Array.isArray(exportStatus.pending_reports) && exportStatus.pending_reports.length > 0 ? (
              <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-muted)' }}>
                {exportStatus.pending_reports.slice(0, 8).map((r) => (
                  <div key={r.id}>
                    {r.report_date} · team #{r.team_id}
                  </div>
                ))}
                {exportStatus.pending_reports.length > 8 ? (
                  <div>… +{exportStatus.pending_reports.length - 8} kolejnych</div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
        {exportStatus.skip_check_active ? (
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: -8, marginBottom: 16 }}>
            {t('payrollM11.exportSkipDev')}
          </p>
        ) : null}

        <div style={card}>
          <h3 style={{ margin: '0 0 12px', fontSize: 16 }}>{t('payrollM11.exportSection')}</h3>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 0, marginBottom: 16 }}>
            {t('payrollM11.exportHint')}
            {t('payrollM11.exportHintEmp')}
          </p>
          <div style={{ ...grid, marginBottom: 16 }}>
            <label style={lab} htmlFor="payroll-month">
              {t('payrollM11.month')}
            </label>
            <input
              id="payroll-month"
              style={inp}
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            <button type="button" style={btnPri} onClick={() => downloadExport('csv')}>
              {t('payrollM11.exportCsv')}
            </button>
            <button type="button" style={btnSec} onClick={() => downloadExport('symfonia')}>
              {t('payrollM11.exportSymfonia')}
            </button>
            <button type="button" style={btnSec} onClick={() => downloadExport('optima')}>
              {t('payrollM11.exportOptima')}
            </button>
            <button type="button" style={btnSec} onClick={() => downloadExport('comarch')}>
              {t('payrollM11.exportComarch')}
            </button>
            <button type="button" style={btnPri} onClick={() => downloadExportZip()}>
              {t('payrollM11.exportZip')}
            </button>
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 12, marginBottom: 0 }}>
            {t('payrollM11.exportZipHint')}
          </p>
        </div>

        <div style={{ ...card, marginTop: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0, fontSize: 16 }}>{t('payrollM11.dayReportsSection')}</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)' }}>
                <input
                  type="checkbox"
                  checked={onlyPendingReports}
                  onChange={(e) => setOnlyPendingReports(e.target.checked)}
                />
                tylko brakujące
              </label>
              <button type="button" style={btnSec} onClick={() => void loadDayReports()} disabled={loadingReports}>
                {t('payrollM11.dayReportsRefresh')}
              </button>
            </div>
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 8, marginBottom: 12 }}>
            {t('payrollM11.dayReportsHint')}
          </p>
          {loadingReports ? (
            <p style={{ color: 'var(--text-muted)', marginBottom: 0 }}>{t('payrollM11.dayReportsLoading')}</p>
          ) : visibleDayReports.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', marginBottom: 0 }}>{t('payrollM11.dayReportsEmpty')}</p>
          ) : (
            visibleDayReports.map((rep) => (
              <div
                key={rep.id}
                style={{
                  border: '1px solid var(--border)',
                  borderRadius: 10,
                  padding: 12,
                  marginBottom: 12,
                  background: 'var(--surface-field)',
                }}
              >
                <div style={{ fontWeight: 700, marginBottom: 8, color: 'var(--accent)' }}>
                  {rep.report_date} · {rep.team_nazwa || `${t('payrollM11.team')} #${rep.team_id}`}
                  {rep.approved_at ? (
                    <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>
                      {t('payrollM11.reportApproved')}
                    </span>
                  ) : (
                    <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 600, color: 'var(--warning, #ca8a04)' }}>
                      {t('payrollM11.reportPending')}
                    </span>
                  )}
                </div>
                {!rep.approved_at ? (
                  <div style={{ marginBottom: 8 }}>
                    <button type="button" style={btnSec} onClick={() => void approveTeamDayReport(rep.id)}>
                      Zatwierdź raport dnia
                    </button>
                  </div>
                ) : null}
                <div className="modern-data-stack">
                  {(rep.lines || []).map((ln) => (
                    <PayrollLineCorrectionRow
                      key={ln.id}
                      line={ln}
                      reportId={rep.id}
                      locked={!!rep.approved_at}
                      saving={savingLineId === ln.id}
                      onSave={saveLineCorrection}
                      t={t}
                      btnPri={btnPri}
                      inp={inp}
                    />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>

        <div style={{ ...card, marginTop: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0, fontSize: 16 }}>{t('payrollM11.correctionLogSection')}</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" style={btnSec} onClick={() => void loadCorrectionLog()} disabled={loadingCorrectionLog}>
                {t('payrollM11.correctionLogRefresh')}
              </button>
              <button type="button" style={btnSec} onClick={downloadCorrectionLogCsv}>
                {t('payrollM11.correctionLogExportCsv')}
              </button>
            </div>
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 8, marginBottom: 12 }}>
            {t('payrollM11.correctionLogHint')}
          </p>
          {loadingCorrectionLog ? (
            <p style={{ color: 'var(--text-muted)', marginBottom: 0 }}>{t('payrollM11.correctionLogLoading')}</p>
          ) : correctionLog.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', marginBottom: 0 }}>{t('payrollM11.correctionLogEmpty')}</p>
          ) : (
            <div className="modern-data-stack">
              {correctionLog.map((c) => (
                <ModernDataRow
                  key={c.id}
                  idLabel="Correction"
                  idValue={`COR-${c.id}`}
                  title={[c.target_imie, c.target_nazwisko].filter(Boolean).join(' ') || (c.target_user_id ? `#${c.target_user_id}` : '—')}
                  subtitle={`${c.report_date} · #${c.team_id}`}
                  tone="warning"
                  status="CORRECTED"
                  statusValue="warning"
                  statusState="warning"
                  metrics={[
                    { label: t('payrollM11.clWhen'), value: formatLogWhen(c.created_at) },
                    { label: t('payrollM11.clEditor'), value: [c.editor_imie, c.editor_nazwisko].filter(Boolean).join(' ') || (c.edited_by ? `#${c.edited_by}` : '—'), mono: false },
                    { label: t('payrollM11.clChange'), value: `${Number(c.prev_hours_total)}h / ${fmtPln(c.prev_pay_pln)} → ${Number(c.new_hours_total)}h / ${fmtPln(c.new_pay_pln)}`, tone: 'success' },
                    { label: t('payrollM11.thNote'), value: c.correction_note || '—', mono: false },
                  ]}
                />
              ))}
            </div>
          )}
        </div>

        <div style={{ ...card, marginTop: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0, fontSize: 16 }}>{t('payrollM11.estimatorSection')}</h3>
            <button type="button" style={btnSec} onClick={loadAccrual} disabled={loadingAccrual}>
              {t('payrollM11.loadAccrual')}
            </button>
          </div>
          {!accrual.length && !loadingAccrual ? (
            <p style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 0 }}>{t('payrollM11.emptyAccrual')}</p>
          ) : (
            <div className="modern-data-stack" style={{ marginTop: 12 }}>
              {accrual.map((row) => (
                <ModernDataRow
                  key={row.id || `${row.wyceniajacy_id}-${row.accrual_month}`}
                  idLabel="Estimator"
                  idValue={`EST-${row.wyceniajacy_id}`}
                  title={[row.imie, row.nazwisko].filter(Boolean).join(' ') || `ID ${row.wyceniajacy_id}`}
                  subtitle={row.accrual_month || month}
                  tone="success"
                  status="ACCRUAL"
                  statusValue="success"
                  statusState="success"
                  metrics={[
                    { label: t('payrollM11.thCommission'), value: fmtPln(row.commission_base), tone: 'success' },
                    { label: t('payrollM11.thExtra'), value: fmtPln(row.extra_work_pln), tone: row.extra_work_pln ? 'info' : undefined },
                  ]}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function fmtPln(n) {
  return new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' }).format(Number(n) || 0);
}

function formatLogWhen(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso).slice(0, 16);
    return d.toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return String(iso).slice(0, 16);
  }
}

const card = {
  background: 'var(--surface-glass)',
  border: '1px solid var(--border)',
  borderRadius: 14,
  padding: 20,
  maxWidth: 900,
};
const grid = { display: 'grid', gridTemplateColumns: '160px 1fr', gap: 12, alignItems: 'center' };
const lab = { fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' };
const inp = {
  padding: '10px 12px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--surface-field)',
  color: 'var(--text)',
  fontSize: 14,
  maxWidth: 220,
};
const btnPri = {
  padding: '10px 18px',
  borderRadius: 10,
  border: 'none',
  background: 'var(--accent)',
  color: '#052E16',
  fontWeight: 700,
  cursor: 'pointer',
};
const btnSec = {
  padding: '10px 18px',
  borderRadius: 10,
  border: '1px solid var(--border)',
  background: 'var(--surface-field)',
  color: 'var(--text)',
  fontWeight: 600,
  cursor: 'pointer',
};
