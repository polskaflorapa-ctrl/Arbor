import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import ModernDataRow from '../components/ModernDataRow';
import { Button } from '../components/ui/Button';
import api from '../api';
import { getStoredToken, authHeaders } from '../utils/storedToken';
import { getRoleDisplayName } from '../utils/roleDisplay';
import { ArrowLeft, Check, Plus, Save, X } from 'lucide-react';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(n, suffix = '') {
  if (n == null) return '—';
  return `${Number(n).toLocaleString('pl-PL')}${suffix}`;
}
function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('pl-PL');
}
function todayYM() {
  return new Date().toISOString().slice(0, 7);
}

const ABSENCE_TYPS = ['Urlop', 'Choroba', 'L4', 'Opieka', 'Nieobecność nieusprawiedliwiona', 'Inne'];

// ─── Add absence modal ────────────────────────────────────────────────────────

function AddAbsenceModal({ onClose, onSaved }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({ user_id: '', typ: 'Urlop', data_od: '', data_do: '', powod: '' });
  const [employees, setEmployees] = useState([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    const token = getStoredToken();
    api.get('/hr/position-cards', { headers: authHeaders(token) })
      .then(r => setEmployees(r.data.cards || []))
      .catch(() => {});
  }, []);

  const save = async () => {
    if (!form.user_id || !form.data_od || !form.data_do) {
      setErr('Wypełnij pracownika, daty od i do.'); return;
    }
    setSaving(true); setErr('');
    try {
      const token = getStoredToken();
      await api.post('/hr/absences', form, { headers: authHeaders(token) });
      onSaved();
    } catch (e) {
      setErr(e.response?.data?.error || e.message);
    } finally { setSaving(false); }
  };

  return (
    <div style={m.overlay}>
      <div style={m.modal}>
        <div style={m.header}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{t('hrPanel.modal.title')}</h3>
          <Button type="button" size="sm" variant="ghost" leftIcon={X} onClick={onClose} style={m.closeBtn} aria-label="Zamknij" />
        </div>
        {err && <div style={m.err}>{err}</div>}
        <div style={m.body}>
          <label style={m.label}>{t('hrPanel.modal.employee')}</label>
          <select value={form.user_id} onChange={e => setForm(f => ({ ...f, user_id: e.target.value }))} style={m.input}>
            <option value="">{t('hrPanel.modal.employeePh')}</option>
            {employees.map(e => <option key={e.id} value={e.id}>{e.employee_name} ({getRoleDisplayName(e.rola)})</option>)}
          </select>

          <label style={m.label}>{t('hrPanel.modal.typ')}</label>
          <select value={form.typ} onChange={e => setForm(f => ({ ...f, typ: e.target.value }))} style={m.input}>
            {ABSENCE_TYPS.map(typ => <option key={typ} value={typ}>{typ}</option>)}
          </select>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={m.label}>{t('hrPanel.modal.dateFrom')}</label>
              <input type="date" value={form.data_od} onChange={e => setForm(f => ({ ...f, data_od: e.target.value }))} style={m.input} />
            </div>
            <div>
              <label style={m.label}>{t('hrPanel.modal.dateTo')}</label>
              <input type="date" value={form.data_do} onChange={e => setForm(f => ({ ...f, data_do: e.target.value }))} style={m.input} />
            </div>
          </div>

          <label style={m.label}>{t('hrPanel.modal.reason')}</label>
          <textarea value={form.powod} onChange={e => setForm(f => ({ ...f, powod: e.target.value }))}
            style={{ ...m.input, height: 70, resize: 'vertical' }} placeholder={t('hrPanel.modal.reasonPh')} />
        </div>
        <div style={m.footer}>
          <Button type="button" variant="outline" onClick={onClose} style={m.cancelBtn}>{t('hrPanel.modal.cancel')}</Button>
          <Button type="button" leftIcon={Save} onClick={save} loading={saving} style={m.saveBtn}>
            {saving ? t('hrPanel.modal.saving') : t('hrPanel.modal.save')}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function HrPanel() {
  const navigate = useNavigate();
  const { t } = useTranslation();

  const [tab, setTab]               = useState('timesheet');
  const [month, setMonth]           = useState(todayYM());
  const [timesheet, setTimesheet]   = useState([]);
  const [absences, setAbsences]     = useState([]);
  const [competency, setCompetency] = useState([]);
  const [headcount, setHeadcount]   = useState([]);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState('');
  const [showAddAbs, setShowAddAbs] = useState(false);

  // Defined inside component so tab labels pick up the current language
  const TABS = [
    { key: 'timesheet',  label: t('hrPanel.tabs.timesheet') },
    { key: 'absences',   label: t('hrPanel.tabs.absences') },
    { key: 'competency', label: t('hrPanel.tabs.competency') },
    { key: 'headcount',  label: t('hrPanel.tabs.headcount') },
  ];

  const load = useCallback(async () => {
    setLoading(true); setError('');
    const token = getStoredToken();
    const h = { headers: authHeaders(token) };
    try {
      if (tab === 'timesheet') {
        const r = await api.get(`/hr/timesheet?month=${month}`, h);
        setTimesheet(r.data.rows || []);
      } else if (tab === 'absences') {
        const r = await api.get(`/hr/absences?month=${month}`, h);
        setAbsences(Array.isArray(r.data) ? r.data : []);
      } else if (tab === 'competency') {
        const r = await api.get('/hr/competency-expiry?days=90', h);
        setCompetency(Array.isArray(r.data) ? r.data : []);
      } else if (tab === 'headcount') {
        const r = await api.get('/hr/headcount', h);
        setHeadcount(Array.isArray(r.data) ? r.data : []);
      }
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally { setLoading(false); }
  }, [tab, month]);

  useEffect(() => { load(); }, [load]);

  const updateAbsenceStatus = async (id, status) => {
    const token = getStoredToken();
    try {
      await api.put(`/hr/absences/${id}`, { status }, { headers: authHeaders(token) });
      load();
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    }
  };

  // Headcount aggregated by branch
  const hcByBranch = headcount.reduce((acc, row) => {
    const key = row.oddzial_nazwa || 'Centrala';
    if (!acc[key]) acc[key] = { total: 0, roles: {} };
    acc[key].total += row.count;
    acc[key].roles[row.rola] = (acc[key].roles[row.rola] || 0) + row.count;
    return acc;
  }, {});

  return (
    <div className="hr-panel-shell" style={s.shell}>
      <Sidebar />
      <main className="hr-panel-main" style={s.main}>
        {/* Header */}
        <div className="hr-panel-topbar" style={s.topbar}>
          <div>
            <h1 style={s.title}>{t('hrPanel.title')}</h1>
            <p style={s.sub}>{t('hrPanel.subtitle')}</p>
          </div>
          <div className="hr-panel-actions" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {(tab === 'timesheet' || tab === 'absences') && (
              <input type="month" value={month} onChange={e => setMonth(e.target.value)}
                style={s.monthInput} />
            )}
            {tab === 'absences' && (
              <Button type="button" leftIcon={Plus} onClick={() => setShowAddAbs(true)} style={s.addBtn}>
                {t('hrPanel.addAbsence')}
              </Button>
            )}
            <Button type="button" variant="outline" leftIcon={ArrowLeft} onClick={() => navigate('/kierownik')} style={s.backBtn}>
              Powrot
            </Button>
          </div>
        </div>

        {error && <div style={s.errorBox}>{error}</div>}

        {/* Tabs */}
        <div className="hr-panel-tabs" style={s.tabs}>
          {TABS.map(tabItem => (
            <Button key={tabItem.key} type="button" variant={tab === tabItem.key ? 'primary' : 'outline'} onClick={() => setTab(tabItem.key)}
              style={{ ...s.tab, ...(tab === tabItem.key ? s.tabActive : {}) }}>
              {tabItem.label}
            </Button>
          ))}
        </div>

        {loading && <div style={s.loading}>Ladowanie...</div>}

        {/* ── TIMESHEET TAB ── */}
        {tab === 'timesheet' && !loading && (
          <div className="hr-panel-card" style={s.card}>
            <div style={s.cardTitle}>{t('hrPanel.timesheet.title')} — {month}</div>
            {timesheet.length === 0 ? (
              <div className="modern-data-empty">{t('hrPanel.timesheet.noData')} {month}</div>
            ) : (
              <div className="modern-data-stack">
                {timesheet.map(row => (
                  <ModernDataRow
                    key={row.user_id}
                    idLabel="Employee ID"
                    idValue={`USR-${row.user_id}`}
                    title={row.employee_name}
                    subtitle={`${getRoleDisplayName(row.rola)} · ${row.oddzial_nazwa || 'brak oddziału'}`}
                    tone={Number(row.hours_pending) > 0 ? 'warning' : 'success'}
                    status={Number(row.hours_pending) > 0 ? 'PENDING HOURS' : 'CONFIRMED'}
                    statusValue={Number(row.hours_pending) > 0 ? 'warning' : 'success'}
                    statusState={Number(row.hours_pending) > 0 ? 'warning' : 'success'}
                    metrics={[
                      { label: 'Godz. potwierdzone', value: fmt(row.hours_confirmed, ' h'), tone: 'success' },
                      { label: 'Godz. oczekujące', value: fmt(row.hours_pending, ' h'), tone: Number(row.hours_pending) > 0 ? 'warning' : undefined },
                      { label: 'Dni', value: fmt(row.days_worked) },
                      { label: 'Zlecenia', value: fmt(row.tasks_covered) },
                    ]}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── ABSENCES TAB ── */}
        {tab === 'absences' && !loading && (
          <div className="hr-panel-card" style={s.card}>
            <div style={s.cardTitle}>{t('hrPanel.absences.title')} — {month}</div>
            {absences.length === 0 ? (
              <div className="modern-data-empty">{t('hrPanel.absences.noData')} {month}</div>
            ) : (
              <div className="modern-data-stack">
                {absences.map(row => (
                  <ModernDataRow
                    key={row.id}
                    idLabel="Absence ID"
                    idValue={`ABS-${row.id}`}
                    title={row.employee_name}
                    subtitle={row.powod || 'Brak powodu'}
                    tone={row.status === 'Zatwierdzona' ? 'success' : row.status === 'Odrzucona' ? 'danger' : 'warning'}
                    status={row.status}
                    statusValue={row.status}
                    statusState={row.status === 'Zatwierdzona' ? 'success' : row.status === 'Odrzucona' ? 'danger' : 'warning'}
                    metrics={[
                      { label: 'Typ', value: row.typ, mono: false },
                      { label: 'Od', value: fmtDate(row.data_od) },
                      { label: 'Do', value: fmtDate(row.data_do) },
                    ]}
                    actions={
                      row.status === 'Oczekuje' ? (
                        <>
                          <Button type="button" size="sm" leftIcon={Check} style={s.approveBtn} onClick={() => updateAbsenceStatus(row.id, 'Zatwierdzona')}>OK</Button>
                          <Button type="button" size="sm" variant="danger" leftIcon={X} style={s.rejectBtn} onClick={() => updateAbsenceStatus(row.id, 'Odrzucona')}>X</Button>
                        </>
                      ) : null
                    }
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── COMPETENCY TAB ── */}
        {tab === 'competency' && !loading && (
          <div className="hr-panel-card" style={s.card}>
            <div style={s.cardTitle}>{t('hrPanel.competency.title')}</div>
            {competency.length === 0 ? (
              <div style={s.empty}>
                <p>{t('hrPanel.competency.noData')}</p>
              </div>
            ) : (
              <div className="modern-data-stack">
                {competency.map(row => (
                  <ModernDataRow
                    key={row.id}
                    idLabel="Competency ID"
                    idValue={`COMP-${row.id}`}
                    title={row.employee_name}
                    subtitle={`${getRoleDisplayName(row.rola)} · ${row.oddzial_nazwa || 'brak oddziału'}`}
                    tone={row.expired ? 'danger' : row.days_left <= 14 ? 'warning' : 'success'}
                    status={row.expired ? 'Wygasłe' : `${row.days_left}d`}
                    statusValue={row.expired ? 'danger' : row.days_left <= 14 ? 'warning' : 'success'}
                    statusState={row.expired ? 'danger' : row.days_left <= 14 ? 'warning' : 'success'}
                    metrics={[
                      { label: 'Kompetencja', value: row.competency_name, mono: false },
                      { label: 'Typ', value: row.typ, mono: false },
                      { label: 'Nr dokumentu', value: row.nr_dokumentu || 'brak' },
                      { label: 'Ważność', value: fmtDate(row.data_waznosci), tone: row.expired ? 'danger' : row.days_left <= 14 ? 'warning' : 'success' },
                    ]}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── HEADCOUNT TAB ── */}
        {tab === 'headcount' && !loading && (
          <div className="hr-panel-card hr-panel-headcount" style={s.card}>
            <div style={s.cardTitle}>{t('hrPanel.headcount.title')}</div>
            {Object.entries(hcByBranch).map(([branch, data]) => (
              <div className="hr-panel-branch" key={branch} style={s.hcBranch}>
                <div style={s.hcBranchHeader}>
                  <span style={{ fontWeight: 700 }}>{branch}</span>
                  <span style={s.hcTotal}>{data.total} os.</span>
                </div>
                <div style={s.hcRoles}>
                  {Object.entries(data.roles).sort((a, b) => b[1] - a[1]).map(([role, cnt]) => (
                    <div key={role} style={s.hcRole}>
                      <span style={s.hcRoleName}>{role}</span>
                      <span style={s.hcRoleCnt}>{cnt}</span>
                      <div style={s.hcBar}>
                        <div style={{ ...s.hcBarFill, width: `${(cnt / data.total) * 100}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {Object.keys(hcByBranch).length === 0 && (
              <div style={s.empty}><p>Brak danych o zatrudnieniu.</p></div>
            )}
          </div>
        )}
      </main>

      {showAddAbs && (
        <AddAbsenceModal
          onClose={() => setShowAddAbs(false)}
          onSaved={() => { setShowAddAbs(false); load(); }}
        />
      )}
    </div>
  );
}

const s = {
  shell:      { display: 'flex', minHeight: '100vh', background: 'var(--bg)' },
  main:       { flex: 1, padding: '20px 24px 40px', overflowX: 'hidden', minWidth: 0 },
  topbar:     { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 },
  title:      { fontSize: 22, fontWeight: 800, color: 'var(--text)', margin: 0 },
  sub:        { fontSize: 13, color: 'var(--text-sub)', marginTop: 4 },
  monthInput: { padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-field)', color: 'var(--text)', fontSize: 14 },
  addBtn:     { padding: '9px 16px', borderRadius: 8, border: '1px solid rgba(20,131,79,0.22)', background: 'var(--accent-gradient)', color: 'var(--on-accent)', cursor: 'pointer', fontSize: 14, fontWeight: 700 },
  backBtn:    { padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-field)', color: 'var(--text)', cursor: 'pointer', fontSize: 13 },
  errorBox:   { padding: '12px 16px', borderRadius: 8, background: '#fee2e2', color: '#dc2626', marginBottom: 16, fontSize: 14 },
  tabs:       { display: 'flex', gap: 4, marginBottom: 20, flexWrap: 'wrap' },
  tab:        { padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-field)', color: 'var(--text-sub)', cursor: 'pointer', fontSize: 14, fontWeight: 500 },
  tabActive:  { background: 'var(--bg)', border: '1px solid var(--accent)', color: 'var(--accent)', fontWeight: 700 },
  card:       { background: 'var(--surface-glass)', borderRadius: 8, border: '1px solid var(--glass-border)', padding: '16px 18px', boxShadow: 'var(--shadow-md)' },
  cardTitle:  { fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 14 },
  loading:    { textAlign: 'center', padding: 40, color: 'var(--text-sub)' },
  empty:      { textAlign: 'center', padding: '40px 20px', color: 'var(--text-sub)' },
  table:      { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th:         { padding: '8px 10px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--text-sub)', textTransform: 'uppercase', borderBottom: '1px solid var(--border)' },
  tr:         { borderBottom: '1px solid var(--border-light, var(--border))' },
  td:         { padding: '10px 10px', color: 'var(--text)', verticalAlign: 'middle' },
  tdNum:      { padding: '10px 10px', color: 'var(--text)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' },
  approveBtn: { padding: '4px 10px', borderRadius: 6, border: 'none', background: '#dcfce7', color: '#16a34a', cursor: 'pointer', fontWeight: 700, fontSize: 13 },
  rejectBtn:  { padding: '4px 10px', borderRadius: 6, border: 'none', background: '#fee2e2', color: '#dc2626', cursor: 'pointer', fontWeight: 700, fontSize: 13 },
  hcBranch:   { marginBottom: 20 },
  hcBranchHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, padding: '6px 0', borderBottom: '1px solid var(--border)' },
  hcTotal:    { fontSize: 13, fontWeight: 700, color: 'var(--accent)' },
  hcRoles:    { display: 'flex', flexDirection: 'column', gap: 6 },
  hcRole:     { display: 'flex', alignItems: 'center', gap: 10 },
  hcRoleName: { minWidth: 180, fontSize: 13, color: 'var(--text)' },
  hcRoleCnt:  { minWidth: 28, textAlign: 'right', fontSize: 13, fontWeight: 700, color: 'var(--text)' },
  hcBar:      { flex: 1, height: 8, background: 'var(--border)', borderRadius: 4, overflow: 'hidden' },
  hcBarFill:  { height: '100%', background: 'var(--accent)', borderRadius: 4, transition: 'width 0.3s ease' },
};

const m = {
  overlay:   { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  modal:     { background: 'var(--surface-glass)', border: '1px solid var(--glass-border)', borderRadius: 8, width: '100%', maxWidth: 440, boxShadow: 'var(--shadow-md)', overflow: 'hidden' },
  header:    { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid var(--border)' },
  closeBtn:  { background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: 'var(--text-sub)' },
  err:       { margin: '12px 20px 0', padding: '10px 14px', borderRadius: 8, background: '#fee2e2', color: '#dc2626', fontSize: 13 },
  body:      { padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 },
  label:     { fontSize: 12, fontWeight: 600, color: 'var(--text-sub)', marginBottom: 4, display: 'block' },
  input:     { width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-field)', color: 'var(--text)', fontSize: 14, boxSizing: 'border-box' },
  footer:    { display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '14px 20px', borderTop: '1px solid var(--border)' },
  cancelBtn: { padding: '9px 18px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-field)', color: 'var(--text)', cursor: 'pointer', fontSize: 14 },
  saveBtn:   { padding: '9px 18px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontSize: 14, fontWeight: 700 },
};
