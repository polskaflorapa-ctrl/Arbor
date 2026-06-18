import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import PageHeader from '../components/PageHeader';
import StatusMessage from '../components/StatusMessage';
import api from '../api';
import { authHeaders, getStoredToken } from '../utils/storedToken';
import { getApiErrorMessage } from '../utils/apiError';

function formatDate(value) {
  if (!value) return '-';
  try {
    return new Date(value).toLocaleString('pl-PL');
  } catch {
    return '-';
  }
}

function formatMoney(value) {
  return `${Number(value || 0).toLocaleString('pl-PL')} PLN`;
}

function trimText(value, max = 140) {
  const text = String(value || '').trim();
  if (text.length <= max) return text || '-';
  return `${text.slice(0, max - 1)}...`;
}

const EMPTY_TODAY = {
  kpis: {},
  unassigned_leads: [],
  overdue_followups: [],
  inbound_messages: [],
  failed_messages: [],
  stale_leads: [],
};

export default function CrmToday() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [data, setData] = useState(EMPTY_TODAY);
  const [owners, setOwners] = useState([]);
  const [actionBusy, setActionBusy] = useState('');

  const loadToday = async () => {
    try {
      setLoading(true);
      setMsg('');
      const headers = authHeaders(getStoredToken());
      const [todayRes, usersRes] = await Promise.all([
        api.get('/crm/today', { headers }),
        api.get('/users', { headers }).catch(() => ({ data: [] })),
      ]);
      const userRows = Array.isArray(usersRes.data) ? usersRes.data : usersRes.data?.items || [];
      setOwners(userRows.filter((row) => row.aktywny !== false));
      setData({ ...EMPTY_TODAY, ...(todayRes.data || {}) });
    } catch (e) {
      setMsg(getApiErrorMessage(e, 'Nie udalo sie pobrac dzisiejszej pracy CRM.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadToday();
  }, []);

  const runAction = async (key, success, fn) => {
    try {
      setActionBusy(key);
      setMsg('');
      await fn();
      setMsg(success);
      await loadToday();
    } catch (e) {
      setMsg(getApiErrorMessage(e, 'Akcja CRM nie powiodla sie.'));
    } finally {
      setActionBusy('');
    }
  };

  const assignLeadOwner = (leadId, ownerId) => {
    runAction(`assign-${leadId}`, 'Owner przypisany.', () => (
      api.patch(`/crm/leads/${leadId}`, { owner_user_id: ownerId || null }, { headers: authHeaders(getStoredToken()) })
    ));
  };

  const completeFollowup = (item) => {
    runAction(`followup-${item.id}`, 'Follow-up oznaczony jako zrobiony.', () => (
      api.patch(`/crm/leads/${item.lead_id}/activities/${item.id}`, { completed: true }, { headers: authHeaders(getStoredToken()) })
    ));
  };

  const retryMessage = (item) => {
    runAction(`retry-${item.id}`, 'Wiadomosc wrocila do kolejki wysylki.', () => (
      api.patch(`/crm/messages/${item.id}/status`, { status: 'queued' }, { headers: authHeaders(getStoredToken()) })
    ));
  };

  const kpis = useMemo(() => {
    const source = data.kpis || {};
    return [
      { key: 'new_inbound', label: 'Nowe wiadomosci', value: source.new_inbound || 0, tone: 'danger', target: '/crm/inbox' },
      { key: 'overdue_followups', label: 'Follow-up po terminie', value: source.overdue_followups || 0, tone: 'warning', target: '/crm/pipeline' },
      { key: 'unassigned_leads', label: 'Leady bez ownera', value: source.unassigned_leads || 0, tone: 'warning', target: '/crm/pipeline' },
      { key: 'failed_messages', label: 'Bledy wysylki', value: source.failed_messages || 0, tone: 'danger', target: '/crm/dashboard' },
      { key: 'stale_no_response', label: 'Brak odpowiedzi 24h', value: source.stale_no_response || 0, tone: 'neutral', target: '/crm/pipeline' },
    ];
  }, [data.kpis]);

  const urgentCount = kpis.reduce((sum, item) => sum + Number(item.value || 0), 0);

  return (
    <div className="app-shell crm-today-shell">
      <Sidebar />
      <main className="app-main crm-today-main">
        <PageHeader
          title="Dzisiaj w CRM"
          subtitle={urgentCount ? `${urgentCount} spraw wymaga uwagi.` : 'Nie ma pilnych spraw w CRM.'}
          variant="hero"
          showBack={false}
        />
        <div className="app-content crm-today-content">
          <StatusMessage message={msg} tone={msg ? 'error' : undefined} />

          <section className="ios-inset" style={{ marginBottom: 12, padding: 12 }}>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontWeight: 800 }}>Operacyjna kolejka dnia</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>
                  Ostatnia aktualizacja: {formatDate(data.generated_at)}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="ios-btn" type="button" onClick={loadToday} disabled={loading}>
                  {loading ? 'Odswiezam...' : 'Odswiez'}
                </button>
                <button className="ios-btn ios-btn-primary" type="button" onClick={() => navigate('/crm/pipeline')}>
                  Pipeline
                </button>
              </div>
            </div>
          </section>

          <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10, marginBottom: 12 }}>
            {kpis.map((item) => (
              <button
                key={item.key}
                type="button"
                className="ios-inset"
                onClick={() => navigate(item.target)}
                style={{
                  padding: 12,
                  textAlign: 'left',
                  cursor: 'pointer',
                  color: 'var(--text)',
                  borderColor: item.value && item.tone === 'danger'
                    ? 'rgba(239,68,68,0.45)'
                    : item.value && item.tone === 'warning'
                      ? 'rgba(245,158,11,0.45)'
                      : undefined,
                }}
              >
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>{item.label}</div>
                <div style={{ fontSize: 26, fontWeight: 800 }}>{item.value}</div>
              </button>
            ))}
          </section>

          <div className="crm-today-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 1fr) minmax(280px, 1fr)', gap: 12 }}>
            <TodayPanel
              title="Nowe wiadomosci od klientow"
              empty="Brak nowych rozmow."
              items={data.inbound_messages}
              render={(item) => (
                <MessageRow
                  key={item.id}
                  item={item}
                  actionLabel="Otworz inbox"
                  onAction={() => navigate('/crm/inbox')}
                />
              )}
            />
            <TodayPanel
              title="Follow-up po terminie"
              empty="Brak przeterminowanych follow-upow."
              items={data.overdue_followups}
              render={(item) => (
                <div key={item.id} className="ios-inset-row" style={{ display: 'grid', gap: 6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                    <strong>{item.lead?.title || `Lead #${item.lead_id}`}</strong>
                    <span style={{ fontSize: 12, color: 'var(--danger, #dc2626)' }}>{formatDate(item.due_at)}</span>
                  </div>
                  <div style={{ fontSize: 13, lineHeight: 1.45 }}>{trimText(item.text)}</div>
                  <LeadMeta lead={item.lead} />
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button className="ios-btn ios-btn-primary" type="button" onClick={() => completeFollowup(item)} disabled={actionBusy === `followup-${item.id}`}>
                      {actionBusy === `followup-${item.id}` ? 'Zapisuje...' : 'Zrobione'}
                    </button>
                    <button className="ios-btn" type="button" onClick={() => navigate('/crm/pipeline')}>Pipeline</button>
                  </div>
                </div>
              )}
            />
            <TodayPanel
              title="Leady bez ownera"
              empty="Wszystkie leady maja ownera."
              items={data.unassigned_leads}
              render={(lead) => (
                <LeadRow
                  key={lead.id}
                  lead={lead}
                  owners={owners}
                  actionBusy={actionBusy}
                  onAssign={assignLeadOwner}
                  onOpen={() => navigate('/crm/pipeline')}
                />
              )}
            />
            <TodayPanel
              title="Brak odpowiedzi 24h"
              empty="Brak starych rozmow bez odpowiedzi."
              items={data.stale_leads}
              render={(lead) => (
                <LeadRow
                  key={lead.id}
                  lead={lead}
                  owners={owners}
                  actionBusy={actionBusy}
                  onAssign={assignLeadOwner}
                  onOpen={() => navigate('/crm/pipeline')}
                />
              )}
            />
            <section className="ios-inset" style={{ padding: 12, gridColumn: '1 / -1' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
                <strong>Bledy wysylki</strong>
                <button className="ios-btn" type="button" onClick={() => navigate('/crm/dashboard')}>Kolejka</button>
              </div>
              <div className="ios-inset-list">
                {(data.failed_messages || []).map((item) => (
                  <MessageRow
                    key={item.id}
                    item={item}
                    actionLabel={actionBusy === `retry-${item.id}` ? 'Kolejkuje...' : 'Ponow wysylke'}
                    onAction={() => retryMessage(item)}
                    disabled={actionBusy === `retry-${item.id}`}
                  />
                ))}
                {!loading && (!data.failed_messages || data.failed_messages.length === 0) ? (
                  <div className="ios-inset-row muted">Brak bledow wysylki.</div>
                ) : null}
              </div>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}

function TodayPanel({ title, empty, items, render }) {
  return (
    <section className="ios-inset" style={{ padding: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
        <strong>{title}</strong>
        <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{items?.length || 0}</span>
      </div>
      <div className="ios-inset-list">
        {(items || []).map(render)}
        {(!items || items.length === 0) ? <div className="ios-inset-row muted">{empty}</div> : null}
      </div>
    </section>
  );
}

function LeadMeta({ lead }) {
  return (
    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
      {[lead?.client_name, lead?.owner_name || 'Bez ownera', lead?.source, formatMoney(lead?.value)].filter(Boolean).join(' / ')}
    </div>
  );
}

function LeadRow({ lead, owners = [], actionBusy = '', onAssign, onOpen }) {
  return (
    <div className="ios-inset-row" style={{ display: 'grid', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
        <strong>{lead.title || `Lead #${lead.id}`}</strong>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{lead.stage || 'Lead'}</span>
      </div>
      <LeadMeta lead={lead} />
      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
        {[lead.phone, lead.email].filter(Boolean).join(' / ') || 'Brak kontaktu'}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {onAssign ? (
          <select
            className="ios-input"
            aria-label={`Owner dla ${lead.title || lead.id}`}
            value={lead.owner_user_id || ''}
            onChange={(event) => onAssign(lead.id, event.target.value)}
            disabled={actionBusy === `assign-${lead.id}`}
            style={{ minWidth: 180, flex: '1 1 180px' }}
          >
            <option value="">Bez ownera</option>
            {owners.map((owner) => (
              <option key={owner.id} value={owner.id}>
                {[owner.imie, owner.nazwisko].filter(Boolean).join(' ') || owner.login}
              </option>
            ))}
          </select>
        ) : null}
        <button className="ios-btn" type="button" onClick={onOpen}>Pipeline</button>
      </div>
    </div>
  );
}

function MessageRow({ item, actionLabel, onAction, disabled = false }) {
  return (
    <div className="ios-inset-row" style={{ display: 'grid', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
        <strong>{item.lead_title || item.client_name || `Lead #${item.lead_id}`}</strong>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{item.channel} / {item.status}</span>
      </div>
      <div style={{ fontSize: 13, lineHeight: 1.45 }}>{trimText(item.subject ? `${item.subject}: ${item.body}` : item.body)}</div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
        {[item.owner_name || 'Bez ownera', formatDate(item.created_at), item.last_error].filter(Boolean).join(' / ')}
      </div>
      <button className="ios-btn" type="button" onClick={onAction} disabled={disabled}>{actionLabel}</button>
    </div>
  );
}
