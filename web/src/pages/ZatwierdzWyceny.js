import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../api';
import Sidebar from '../components/Sidebar';
import StatusMessage from '../components/StatusMessage';
import { getApiErrorMessage } from '../utils/apiError';
import { readStoredUser } from '../utils/readStoredUser';
import { getStoredToken, authHeaders } from '../utils/storedToken';
import { errorMessage, successMessage, warningMessage } from '../utils/statusMessage';

const APPROVE_ROLES = ['Kierownik', 'Administrator', 'Dyrektor', 'Specjalista'];
const TABS = ['oczekuje', 'rezerwacja_wstepna', 'do_specjalisty', 'zatwierdzono', 'odrzucono'];

function fmtPln(v) {
  if (v == null || v === '') return '—';
  return new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' }).format(Number(v));
}

function teamMatchesBranch(team, branchId) {
  if (!branchId) return true;
  const bid = String(branchId);
  return (
    String(team.oddzial_id || '') === bid ||
    String(team.dostepny_w_oddziale_id || '') === bid ||
    String(team.delegowany_do_oddzial_id || '') === bid
  );
}

export default function ZatwierdzWyceny() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [wyceny, setWyceny] = useState([]);
  const [ekipy, setEkipy] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('oczekuje');
  const [msg, setMsg] = useState('');

  const [approving, setApproving] = useState(null);
  const [approveEkipy, setApproveEkipy] = useState(null);
  const [approveForm, setApproveForm] = useState({
    ekipa_id: '',
    data: '',
    godzina: '',
    wartosc: '',
    uwagi: '',
  });
  const [rejecting, setRejecting] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [saving, setSaving] = useState(false);

  const user = readStoredUser();
  const allowed = user && APPROVE_ROLES.includes(user.rola);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setMsg('');
    try {
      const token = getStoredToken();
      if (!token) {
        navigate('/');
        return;
      }
      const h = authHeaders(token);
      const [wRes, eRes] = await Promise.all([api.get('/wyceny', { headers: h }), api.get('/ekipy', { headers: h })]);
      const wData = wRes.data;
      setWyceny(Array.isArray(wData) ? wData : wData.wyceny || []);
      setEkipy(Array.isArray(eRes.data) ? eRes.data : eRes.data?.ekipy || []);
    } catch (e) {
      setMsg(errorMessage(getApiErrorMessage(e, t('approve.serverError'))));
      setWyceny([]);
    } finally {
      setLoading(false);
    }
  }, [navigate, t]);

  useEffect(() => {
    if (!getStoredToken()) {
      navigate('/');
      return;
    }
    if (!allowed) {
      setMsg(warningMessage(t('approve.accessDeniedBody')));
      setLoading(false);
      return;
    }
    loadAll();
  }, [allowed, loadAll, navigate, t]);

  const filtered = wyceny.filter((w) => w.status_akceptacji === tab);
  const approveTeamOptions = Array.isArray(approveEkipy)
    ? approveEkipy
    : ekipy.filter((e) => teamMatchesBranch(e, approving?.oddzial_id));

  const openApprove = async (w) => {
    setApproveForm({
      ekipa_id: String(w.proponowana_ekipa_id || w.ekipa_id || ''),
      data: (w.proponowana_data || w.data_wykonania || '').slice(0, 10),
      godzina: (w.proponowana_godzina || w.godzina_rozpoczecia || '08:00').slice(0, 5),
      wartosc:
        w.wartosc_planowana != null
          ? String(w.wartosc_planowana)
          : w.wartosc_szacowana != null
            ? String(w.wartosc_szacowana)
            : '',
      uwagi: '',
    });
    setApproving(w);
    setApproveEkipy(null);
    if (!w.oddzial_id) return;
    try {
      const token = getStoredToken();
      const day = (w.proponowana_data || w.data_wykonania || '').slice(0, 10) || new Date().toISOString().slice(0, 10);
      const res = await api.get(`/oddzialy/${w.oddzial_id}/zasoby`, {
        headers: authHeaders(token),
        params: { date: day },
      });
      setApproveEkipy(Array.isArray(res.data?.ekipy) ? res.data.ekipy : []);
    } catch (err) {
      console.error(err);
      setApproveEkipy(ekipy.filter((e) => teamMatchesBranch(e, w.oddzial_id)));
    }
  };

  const handleApprove = async () => {
    if (!approveForm.ekipa_id) {
      setMsg(warningMessage(t('approve.pickTeam')));
      return;
    }
    setSaving(true);
    try {
      const token = getStoredToken();
      if (!token) {
        navigate('/');
        return;
      }
      const body = {
        ekipa_id: approveForm.ekipa_id,
        data_wykonania: approveForm.data,
        godzina_rozpoczecia: approveForm.godzina,
        wartosc_planowana: approveForm.wartosc ? parseFloat(approveForm.wartosc) : undefined,
        uwagi: approveForm.uwagi,
      };
      await api.post(`/wyceny/${approving.id}/zatwierdz`, body, { headers: authHeaders(token) });
      setApproving(null);
      setMsg(successMessage(`${t('approve.approvedTitle')} — ${t('approve.approvedBody')}`));
      loadAll();
    } catch (e) {
      setMsg(errorMessage(getApiErrorMessage(e, t('approve.approveFail'))));
    } finally {
      setSaving(false);
    }
  };

  const handleReject = async () => {
    setSaving(true);
    try {
      const token = getStoredToken();
      if (!token) {
        navigate('/');
        return;
      }
      await api.post(`/wyceny/${rejecting.id}/odrzuc`, { powod: rejectReason }, { headers: authHeaders(token) });
      setRejecting(null);
      setRejectReason('');
      setMsg(successMessage(`${t('approve.rejectedTitle')} — ${t('approve.rejectedBody')}`));
      loadAll();
    } catch (e) {
      setMsg(errorMessage(getApiErrorMessage(e, t('approve.rejectFail'))));
    } finally {
      setSaving(false);
    }
  };

  const tabLabel = (k) => {
    if (k === 'oczekuje') return t('approve.tab.pending');
    if (k === 'rezerwacja_wstepna') return t('approve.tab.reservation');
    if (k === 'do_specjalisty') return t('approve.tab.specialist');
    if (k === 'zatwierdzono') return t('approve.tab.approved');
    return t('approve.tab.rejected');
  };

  const emptyLabel = (k) => {
    if (k === 'oczekuje') return t('approve.empty.pending');
    if (k === 'rezerwacja_wstepna') return t('approve.empty.reservation');
    if (k === 'do_specjalisty') return t('approve.empty.specialist');
    if (k === 'zatwierdzono') return t('approve.empty.approved');
    return t('approve.empty.rejected');
  };

  const S = {
    root: {},
    header: {
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      padding: '16px 20px',
      borderBottom: '1px solid var(--glass-border)',
      background: 'var(--surface-glass)',
    },
    backBtn: {
      width: 40,
      height: 40,
      borderRadius: 8,
      border: '1px solid var(--border)',
      background: 'var(--surface-field)',
      cursor: 'pointer',
      color: 'var(--text)',
    },
    title: { fontSize: 18, fontWeight: 800, color: 'var(--text)' },
    tabs: {
      display: 'flex',
      gap: 6,
      flexWrap: 'wrap',
      padding: '12px 16px',
      borderBottom: '1px solid var(--border2)',
      background: 'var(--surface-field)',
    },
    tab: {
      padding: '8px 12px',
      borderRadius: 8,
      border: '1px solid var(--border)',
      background: 'var(--surface-field)',
      color: 'var(--text-sub)',
      cursor: 'pointer',
      fontSize: 13,
      fontWeight: 600,
    },
    tabOn: {
      background: 'var(--accent-gradient)',
      color: 'var(--on-accent)',
      borderColor: 'var(--accent)',
    },
    main: { padding: 16, maxWidth: 720, margin: '0 auto', width: '100%', boxSizing: 'border-box' },
    card: {
      padding: 14,
      borderRadius: 8,
      border: '1px solid var(--glass-border)',
      background: 'var(--surface-glass)',
      boxShadow: 'var(--shadow-md)',
      marginBottom: 12,
    },
    row: { display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' },
    klient: { fontWeight: 700, fontSize: 15, color: 'var(--text)' },
    sub: { fontSize: 12, color: 'var(--text-muted)', marginTop: 6 },
    actions: { display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 },
    btnDanger: {
      padding: '8px 14px',
      borderRadius: 8,
      border: '1px solid rgba(239,68,68,0.5)',
      background: 'transparent',
      color: '#F87171',
      cursor: 'pointer',
      fontWeight: 600,
      fontSize: 13,
    },
    btnOk: {
      padding: '8px 14px',
      borderRadius: 8,
      border: '1px solid rgba(20,131,79,0.22)',
      background: 'var(--accent-gradient)',
      color: 'var(--on-accent)',
      cursor: 'pointer',
      fontWeight: 700,
      fontSize: 13,
    },
    overlay: {
      position: 'fixed',
      inset: 0,
      background: 'rgba(6,16,11,0.68)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
      padding: 16,
    },
    modal: {
      background: 'var(--surface-glass)',
      borderRadius: 8,
      padding: 22,
      maxWidth: 440,
      width: '100%',
      border: '1px solid var(--glass-border)',
      boxShadow: 'var(--shadow-md)',
      maxHeight: '90vh',
      overflowY: 'auto',
    },
    modalTitle: { fontSize: 18, fontWeight: 800, marginBottom: 14 },
    field: { marginBottom: 12 },
    lbl: { fontSize: 12, fontWeight: 600, color: 'var(--text-sub)', marginBottom: 4 },
    inp: {
      width: '100%',
      padding: '10px 12px',
      borderRadius: 8,
      border: '1px solid var(--border)',
      background: 'var(--surface-field)',
      color: 'var(--text)',
      fontSize: 14,
      boxSizing: 'border-box',
    },
    modalRow: { display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 },
    btnGhost: {
      padding: '10px 16px',
      borderRadius: 8,
      border: '1px solid var(--border)',
      background: 'var(--surface-field)',
      color: 'var(--text-sub)',
      cursor: 'pointer',
    },
    empty: { color: 'var(--text-muted)', padding: 24, textAlign: 'center' },
  };

  if (!allowed && !loading) {
    return (
      <div className="app-shell">
        <Sidebar />
        <main className="app-main" style={{ padding: 24 }}>
          <StatusMessage message={msg} tone="warning" />
          <button type="button" style={S.btnGhost} onClick={() => navigate('/dashboard')}>
            {t('common.back')}
          </button>
        </main>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <Sidebar />
      <main className="app-main" style={S.root}>
        <div style={S.header}>
          <button type="button" style={S.backBtn} onClick={() => navigate(-1)}>
            ←
          </button>
          <div style={S.title}>{t('approve.pageTitle')}</div>
        </div>
        <StatusMessage message={msg} style={{ margin: '12px 16px 0' }} />

        <div style={S.tabs}>
          {TABS.map((k) => (
            <button
              key={k}
              type="button"
              style={{ ...S.tab, ...(tab === k ? S.tabOn : {}) }}
              onClick={() => setTab(k)}
            >
              {tabLabel(k)}
            </button>
          ))}
        </div>

        <div style={S.main}>
          {loading ? (
            <div style={S.empty}>{t('common.loading')}</div>
          ) : filtered.length === 0 ? (
            <div style={S.empty}>{emptyLabel(tab)}</div>
          ) : (
            filtered.map((w) => (
              <div key={w.id} style={S.card}>
                <div style={S.row}>
                  <div>
                    <div style={S.klient}>{w.klient_nazwa || t('approve.card.unknownAddress')}</div>
                    <div style={S.sub}>
                      {w.adres || '—'}
                      {w.miasto ? ` · ${w.miasto}` : ''}
                    </div>
                    <div style={{ ...S.sub, marginTop: 8 }}>
                      <strong>{t('approve.info.estValue')}:</strong> {fmtPln(w.wartosc_planowana ?? w.wartosc_szacowana)}
                      {' · '}
                      <strong>{t('approve.label.doneDate')}:</strong>{' '}
                      {(w.data_wykonania || '').slice(0, 10) || '—'}
                    </div>
                  </div>
                </div>
                {['oczekuje', 'rezerwacja_wstepna', 'do_specjalisty'].includes(tab) && (
                  <div style={S.actions}>
                    <button type="button" style={S.btnDanger} onClick={() => setRejecting(w)}>
                      {t('approve.btn.reject')}
                    </button>
                    <button type="button" style={S.btnOk} onClick={() => openApprove(w)}>
                      {t('approve.btn.approveShort')}
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {approving && (
          <div style={S.overlay} onMouseDown={() => !saving && setApproving(null)} role="presentation">
            <div style={S.modal} onMouseDown={(e) => e.stopPropagation()} role="dialog">
              <div style={S.modalTitle}>{t('approve.modalApproveTitle')}</div>
              <div style={S.field}>
                <div style={S.lbl}>{t('approve.label.team')} {t('approve.teamRequired')}</div>
                <select
                  style={S.inp}
                  value={approveForm.ekipa_id}
                  onChange={(e) => setApproveForm((f) => ({ ...f, ekipa_id: e.target.value }))}
                >
                  <option value="">—</option>
                  {approveTeamOptions.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.nazwa || `Ekipa #${e.id}`}{e.delegowany ? ' (delegacja)' : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div style={S.field}>
                  <div style={S.lbl}>{t('approve.label.doneDate')}</div>
                  <input
                    style={S.inp}
                    type="date"
                    value={approveForm.data}
                    onChange={(e) => setApproveForm((f) => ({ ...f, data: e.target.value }))}
                  />
                </div>
                <div style={S.field}>
                  <div style={S.lbl}>{t('approve.label.hour')}</div>
                  <input
                    style={S.inp}
                    type="time"
                    value={approveForm.godzina}
                    onChange={(e) => setApproveForm((f) => ({ ...f, godzina: e.target.value }))}
                  />
                </div>
              </div>
              <div style={S.field}>
                <div style={S.lbl}>{t('approve.label.orderValue')}</div>
                <input
                  style={S.inp}
                  type="number"
                  step="0.01"
                  value={approveForm.wartosc}
                  onChange={(e) => setApproveForm((f) => ({ ...f, wartosc: e.target.value }))}
                />
              </div>
              <div style={S.field}>
                <div style={S.lbl}>{t('approve.label.managerNotes')}</div>
                <textarea
                  style={{ ...S.inp, minHeight: 72, resize: 'vertical' }}
                  value={approveForm.uwagi}
                  onChange={(e) => setApproveForm((f) => ({ ...f, uwagi: e.target.value }))}
                  placeholder={t('approve.placeholder.notes')}
                />
              </div>
              <div style={S.modalRow}>
                <button type="button" style={S.btnGhost} disabled={saving} onClick={() => setApproving(null)}>
                  {t('common.cancel')}
                </button>
                <button type="button" style={S.btnOk} disabled={saving} onClick={handleApprove}>
                  {saving ? t('common.saving') : t('approve.btn.approveCreate')}
                </button>
              </div>
            </div>
          </div>
        )}

        {rejecting && (
          <div style={S.overlay} onMouseDown={() => !saving && setRejecting(null)} role="presentation">
            <div style={S.modal} onMouseDown={(e) => e.stopPropagation()} role="dialog">
              <div style={S.modalTitle}>{t('approve.rejectModalTitle')}</div>
              <div style={S.field}>
                <div style={S.lbl}>{t('approve.rejectReasonLabel')}</div>
                <textarea
                  style={{ ...S.inp, minHeight: 88, resize: 'vertical' }}
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder={t('approve.rejectPlaceholder')}
                />
              </div>
              <div style={S.modalRow}>
                <button type="button" style={S.btnGhost} disabled={saving} onClick={() => setRejecting(null)}>
                  {t('common.cancel')}
                </button>
                <button type="button" style={{ ...S.btnDanger, padding: '10px 16px' }} disabled={saving} onClick={handleReject}>
                  {saving ? t('common.saving') : t('approve.rejectConfirm')}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
