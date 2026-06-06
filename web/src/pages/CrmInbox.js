import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import PageHeader from '../components/PageHeader';
import StatusMessage from '../components/StatusMessage';
import api from '../api';
import { authHeaders, getStoredToken } from '../utils/storedToken';
import { getApiErrorMessage } from '../utils/apiError';

const CHANNELS = ['', 'whatsapp', 'sms', 'email', 'instagram', 'facebook', 'messenger', 'telegram', 'webchat', 'other'];
const CORE_UNIFIED_CHANNELS = ['whatsapp', 'instagram', 'messenger', 'telegram', 'email', 'sms'];
const DIRECTIONS = ['', 'inbound', 'outbound'];
const STATUSES = ['', 'received', 'queued', 'processing', 'sent', 'delivered', 'read', 'failed'];
const CHANNEL_LABELS = {
  whatsapp: 'WhatsApp',
  sms: 'SMS',
  email: 'E-mail',
  instagram: 'Instagram',
  facebook: 'Facebook',
  messenger: 'Messenger',
  telegram: 'Telegram',
  webchat: 'Webchat',
  other: 'Inne',
};
const OPEN_STATUSES = new Set(['received', 'queued', 'processing', 'failed']);

function getInboxLoadErrorMessage(error) {
  const status = error?.response?.status;
  const path = error?.response?.data?.path || error?.config?.url || '';
  if (status === 404 && String(path).includes('/crm/messages/inbox')) {
    return 'Unified Inbox jest w panelu, ale backend nie ma aktualnej trasy /api/crm/messages/inbox. Zrestartuj backend i odswiez panel.';
  }
  return getApiErrorMessage(error, 'Nie udalo sie pobrac skrzynki CRM');
}

function formatDate(value) {
  if (!value) return '-';
  try {
    return new Date(value).toLocaleString('pl-PL');
  } catch {
    return '-';
  }
}

export default function CrmInbox() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [messages, setMessages] = useState([]);
  const [timelineMessages, setTimelineMessages] = useState([]);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [messageTemplates, setMessageTemplates] = useState([]);
  const [channelSources, setChannelSources] = useState([]);
  const [owners, setOwners] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [replyBody, setReplyBody] = useState('');
  const [replyTemplateId, setReplyTemplateId] = useState('');
  const [replySending, setReplySending] = useState(false);
  const [statusSavingId, setStatusSavingId] = useState(null);
  const [ownerSaving, setOwnerSaving] = useState(false);
  const [filters, setFilters] = useState({ channel: '', direction: '', status: '', q: '' });

  const selected = useMemo(
    () => messages.find((message) => String(message.id) === String(selectedId)) || messages[0] || null,
    [messages, selectedId]
  );
  const inboxStats = useMemo(() => {
    const stats = { inbound: 0, queued: 0, failed: 0, byChannel: {} };
    messages.forEach((message) => {
      const status = String(message.status || '').toLowerCase();
      const direction = String(message.direction || '').toLowerCase();
      const channel = String(message.channel || 'other').toLowerCase();
      if (OPEN_STATUSES.has(status) && direction === 'inbound') stats.inbound += 1;
      if (status === 'failed') stats.failed += 1;
      if (status === 'queued') stats.queued += 1;
      stats.byChannel[channel] = (stats.byChannel[channel] || 0) + 1;
    });
    return stats;
  }, [messages]);
  const activeFiltersCount = useMemo(
    () => Object.values(filters).filter((value) => String(value || '').trim()).length,
    [filters]
  );
  const unifiedInboxSources = useMemo(
    () => channelSources.filter((source) => source?.config?.unified_inbox),
    [channelSources]
  );
  const sourceStats = useMemo(() => {
    const stats = {};
    messages.forEach((message) => {
      const channel = String(message.channel || 'other').toLowerCase();
      const current = stats[channel] || { count: 0, lastAt: null };
      const createdAtMs = new Date(message.created_at || 0).getTime();
      const lastAtMs = current.lastAt ? new Date(current.lastAt).getTime() : 0;
      stats[channel] = {
        count: current.count + 1,
        lastAt: createdAtMs > lastAtMs ? message.created_at : current.lastAt,
      };
    });
    return stats;
  }, [messages]);
  const channelReadiness = useMemo(() => {
    const byChannel = new Map();
    unifiedInboxSources.forEach((source) => {
      const channel = String(source?.config?.channel || 'webchat').toLowerCase();
      const current = byChannel.get(channel) || { channel, active: 0, paused: 0, sources: [] };
      if (source.active) current.active += 1;
      else current.paused += 1;
      current.sources.push(source);
      byChannel.set(channel, current);
    });
    return CORE_UNIFIED_CHANNELS.map((channel) => {
      const row = byChannel.get(channel) || { channel, active: 0, paused: 0, sources: [] };
      const messageCount = sourceStats[channel]?.count || 0;
      return {
        ...row,
        label: CHANNEL_LABELS[channel] || channel,
        ready: row.active > 0,
        messageCount,
        statusLabel: row.active > 0 ? 'Gotowy' : row.paused > 0 ? 'Pauza' : 'Do podpiecia',
        detail: row.active > 0
          ? `${row.active} aktywne zrodlo${row.active > 1 ? 'a' : ''}, rozmowy: ${messageCount}`
          : row.paused > 0
            ? `${row.paused} zrodlo w pauzie - wznow w Integracjach`
            : 'Brak webhooka dla tego kanalu',
      };
    });
  }, [sourceStats, unifiedInboxSources]);
  const channelReadinessSummary = useMemo(() => ({
    ready: channelReadiness.filter((row) => row.ready).length,
    total: channelReadiness.length,
    missing: channelReadiness.filter((row) => !row.ready).length,
  }), [channelReadiness]);

  const loadInbox = async () => {
    try {
      setLoading(true);
      setMsg('');
      const token = getStoredToken();
      const params = Object.fromEntries(Object.entries({ ...filters, limit: 100 }).filter(([, value]) => value !== ''));
      const res = await api.get('/crm/messages/inbox', { headers: authHeaders(token), params });
      const rows = Array.isArray(res.data) ? res.data : [];
      setMessages(rows);
      setSelectedId((current) => (rows.some((row) => String(row.id) === String(current)) ? current : rows[0]?.id || null));
    } catch (e) {
      setMsg(getInboxLoadErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const loadTemplates = async () => {
    try {
      const token = getStoredToken();
      const res = await api.get('/crm/message-templates', { headers: authHeaders(token) });
      setMessageTemplates(Array.isArray(res.data) ? res.data : []);
    } catch {
      setMessageTemplates([]);
    }
  };

  const loadOwners = async () => {
    try {
      const token = getStoredToken();
      const res = await api.get('/uzytkownicy', { headers: authHeaders(token) });
      setOwners(Array.isArray(res.data) ? res.data.filter((user) => Number(user.id) > 0) : []);
    } catch {
      setOwners([]);
    }
  };

  const loadChannelSources = async () => {
    try {
      const token = getStoredToken();
      const res = await api.get('/crm/integrations/apps', { headers: authHeaders(token), params: { include_inactive: true } });
      setChannelSources(Array.isArray(res.data) ? res.data : []);
    } catch {
      setChannelSources([]);
    }
  };

  const loadTimeline = async (leadId) => {
    if (!leadId) {
      setTimelineMessages([]);
      return;
    }
    try {
      setTimelineLoading(true);
      const token = getStoredToken();
      const res = await api.get(`/crm/leads/${leadId}/messages`, { headers: authHeaders(token) });
      setTimelineMessages(Array.isArray(res.data) ? res.data : []);
    } catch {
      setTimelineMessages([]);
    } finally {
      setTimelineLoading(false);
    }
  };

  useEffect(() => {
    loadInbox();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.channel, filters.direction, filters.status]);

  useEffect(() => {
    loadTemplates();
    loadOwners();
    loadChannelSources();
  }, []);

  useEffect(() => {
    loadTimeline(selected?.lead_id);
  }, [selected?.lead_id]);

  const applySearch = (event) => {
    event.preventDefault();
    loadInbox();
  };

  const resetFilters = () => {
    setFilters({ channel: '', direction: '', status: '', q: '' });
  };

  const applyPreset = (patch) => {
    setFilters((prev) => ({ ...prev, ...patch }));
  };

  const refreshInboxWorkspace = async () => {
    await Promise.all([
      loadInbox(),
      loadChannelSources(),
      selected?.lead_id ? loadTimeline(selected.lead_id) : Promise.resolve(),
    ]);
  };

  const sendReply = async (event) => {
    event.preventDefault();
    if (!selected?.lead_id || !replyBody.trim()) return;
    try {
      setReplySending(true);
      setMsg('');
      const token = getStoredToken();
      await api.post(
        `/crm/leads/${selected.lead_id}/messages`,
        {
          channel: selected.channel,
          direction: 'outbound',
          status: 'queued',
          template_id: replyTemplateId ? Number(replyTemplateId) : undefined,
          recipient_handle: selected.sender_handle || selected.recipient_handle || selected.lead_phone || selected.lead_email || null,
          subject: selected.subject || null,
          body: replyBody.trim(),
          metadata: { source: 'crm.inbox.reply', reply_to_message_id: selected.id },
        },
        { headers: authHeaders(token) }
      );
      setReplyBody('');
      setReplyTemplateId('');
      await loadInbox();
      await loadTimeline(selected.lead_id);
      setMsg('Odpowiedz dodana do kolejki wysylki.');
    } catch (e) {
      setMsg(getApiErrorMessage(e, 'Nie udalo sie dodac odpowiedzi do kolejki'));
    } finally {
      setReplySending(false);
    }
  };

  const applyReplyTemplate = (templateId) => {
    setReplyTemplateId(templateId);
    const template = messageTemplates.find((item) => String(item.id) === String(templateId));
    if (template) setReplyBody(template.body || '');
  };

  const updateMessageStatus = async (messageId, status) => {
    if (!messageId) return;
    try {
      setStatusSavingId(messageId);
      setMsg('');
      const token = getStoredToken();
      await api.patch(
        `/crm/messages/${messageId}/status`,
        { status, error: status === 'failed' ? 'Oznaczone recznie w Unified Inbox' : undefined },
        { headers: authHeaders(token) }
      );
      await loadInbox();
      await loadTimeline(selected?.lead_id);
      setMsg(`Status wiadomosci zmieniony na ${status}.`);
    } catch (e) {
      setMsg(getApiErrorMessage(e, 'Nie udalo sie zmienic statusu wiadomosci'));
    } finally {
      setStatusSavingId(null);
    }
  };

  const assignLeadOwner = async (ownerUserId) => {
    if (!selected?.lead_id) return;
    try {
      setOwnerSaving(true);
      setMsg('');
      const token = getStoredToken();
      await api.patch(
        `/crm/leads/${selected.lead_id}`,
        { owner_user_id: ownerUserId ? Number(ownerUserId) : null },
        { headers: authHeaders(token) }
      );
      await loadInbox();
      setMsg('Handlowiec przypisany do rozmowy.');
    } catch (e) {
      setMsg(getApiErrorMessage(e, 'Nie udalo sie przypisac handlowca'));
    } finally {
      setOwnerSaving(false);
    }
  };

  const ownerLabel = (owner) => [owner.imie, owner.nazwisko].filter(Boolean).join(' ') || owner.login || `#${owner.id}`;

  return (
    <div className="app-shell crm-inbox-shell">
      <Sidebar />
      <main className="app-main crm-inbox-main">
        <PageHeader
          title="Unified Inbox"
          subtitle="Wspolna skrzynka rozmow z leadow CRM."
          variant="hero"
        />
        <div className="app-content crm-inbox-content">
          <StatusMessage message={msg} tone={msg ? 'error' : undefined} />

          <section className="ios-inset crm-inbox-filters" style={{ marginBottom: 12, padding: 12 }}>
            <form onSubmit={applySearch} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, alignItems: 'end' }}>
              <label style={{ display: 'grid', gap: 4, fontSize: 12, color: 'var(--text-muted)' }}>
                Kanal
                <select className="ios-field" value={filters.channel} onChange={(e) => setFilters((prev) => ({ ...prev, channel: e.target.value }))}>
                  {CHANNELS.map((channel) => <option key={channel || 'all'} value={channel}>{channel || 'Wszystkie'}</option>)}
                </select>
              </label>
              <label style={{ display: 'grid', gap: 4, fontSize: 12, color: 'var(--text-muted)' }}>
                Kierunek
                <select className="ios-field" value={filters.direction} onChange={(e) => setFilters((prev) => ({ ...prev, direction: e.target.value }))}>
                  {DIRECTIONS.map((direction) => <option key={direction || 'all'} value={direction}>{direction || 'Wszystkie'}</option>)}
                </select>
              </label>
              <label style={{ display: 'grid', gap: 4, fontSize: 12, color: 'var(--text-muted)' }}>
                Status
                <select className="ios-field" value={filters.status} onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value }))}>
                  {STATUSES.map((status) => <option key={status || 'all'} value={status}>{status || 'Wszystkie'}</option>)}
                </select>
              </label>
              <label style={{ display: 'grid', gap: 4, fontSize: 12, color: 'var(--text-muted)' }}>
                Szukaj
                <input className="ios-field" value={filters.q} onChange={(e) => setFilters((prev) => ({ ...prev, q: e.target.value }))} placeholder="Lead, klient, tresc..." />
              </label>
              <button className="ios-btn ios-btn-primary" type="submit" disabled={loading}>{loading ? 'Laduje...' : 'Filtruj'}</button>
            </form>
          </section>

          <section className="ios-inset crm-inbox-summary" style={{ marginBottom: 12, padding: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>
              <button className="ios-inset-row" type="button" onClick={() => applyPreset({ direction: '', status: '' })} style={{ textAlign: 'left', cursor: 'pointer' }}>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Wszystkie</div>
                <strong>{messages.length}</strong>
              </button>
              <button className="ios-inset-row" type="button" onClick={() => applyPreset({ direction: 'inbound', status: 'received' })} style={{ textAlign: 'left', cursor: 'pointer' }}>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Nowe od klientow</div>
                <strong>{inboxStats.inbound}</strong>
              </button>
              <button className="ios-inset-row" type="button" onClick={() => applyPreset({ direction: 'outbound', status: 'queued' })} style={{ textAlign: 'left', cursor: 'pointer' }}>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>W kolejce</div>
                <strong>{inboxStats.queued}</strong>
              </button>
              <button className="ios-inset-row" type="button" onClick={() => applyPreset({ status: 'failed' })} style={{ textAlign: 'left', cursor: 'pointer' }}>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Do poprawy</div>
                <strong>{inboxStats.failed}</strong>
              </button>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10, alignItems: 'center' }}>
              {Object.entries(inboxStats.byChannel).slice(0, 6).map(([channel, count]) => (
                <button key={channel} className="ios-btn" type="button" onClick={() => applyPreset({ channel })} style={{ minHeight: 34 }}>
                  {CHANNEL_LABELS[channel] || channel}: {count}
                </button>
              ))}
              {activeFiltersCount ? <button className="ios-btn" type="button" onClick={resetFilters}>Wyczysc filtry</button> : null}
              <button className="ios-btn" type="button" onClick={loadInbox} disabled={loading}>Odswiez</button>
              <button className="ios-btn ios-btn-primary" type="button" onClick={refreshInboxWorkspace} disabled={loading || timelineLoading}>
                Odswiez wszystko
              </button>
            </div>
          </section>

          <section className="ios-inset crm-inbox-sources" style={{ marginBottom: 12, padding: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
              <div>
                <strong>Zrodla kanalow</strong>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Podpiete webhooki Unified Inbox per oddzial. Gotowe: {channelReadinessSummary.ready}/{channelReadinessSummary.total}.
                </div>
              </div>
              <button className="ios-btn" type="button" onClick={() => navigate('/integracje')}>
                Konfiguruj
              </button>
              <button className="ios-btn" type="button" onClick={refreshInboxWorkspace} disabled={loading || timelineLoading}>
                Odswiez zrodla
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 8, marginBottom: 10 }}>
              {channelReadiness.map((row) => (
                <button
                  key={row.channel}
                  type="button"
                  className="ios-inset-row"
                  onClick={() => (row.ready ? applyPreset({ channel: row.channel }) : navigate('/integracje'))}
                  style={{ textAlign: 'left', cursor: 'pointer', borderColor: row.ready ? 'rgba(15,95,58,0.22)' : 'rgba(245,158,11,0.28)' }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <strong>{row.label}</strong>
                    <span style={{ fontSize: 12, color: row.ready ? 'var(--accent)' : '#92400e' }}>{row.statusLabel}</span>
                  </div>
                  <div style={{ marginTop: 4, fontSize: 12, color: 'var(--text-muted)' }}>
                    {row.detail}
                  </div>
                </button>
              ))}
            </div>
            {unifiedInboxSources.length ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
                {unifiedInboxSources.map((source) => {
                  const channel = String(source.config?.channel || 'webchat').toLowerCase();
                  const label = CHANNEL_LABELS[channel] || channel;
                  return (
                    <button
                      key={source.id}
                      type="button"
                      className="ios-inset-row"
                      onClick={() => applyPreset({ channel })}
                      style={{ textAlign: 'left', cursor: 'pointer' }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                        <strong>{label}</strong>
                        <span style={{ fontSize: 12, color: source.active ? 'var(--accent)' : 'var(--text-muted)' }}>
                          {source.active ? 'Aktywny' : 'Pauza'}
                        </span>
                      </div>
                      <div style={{ marginTop: 4, fontSize: 12, color: 'var(--text-muted)' }}>
                        Oddzial {source.oddzial_id || 'global'} / {source.config?.provider || source.type || 'webhook'}
                      </div>
                      <div style={{ marginTop: 4, fontSize: 12, color: 'var(--text-muted)' }}>
                        Rozmowy w widoku: {sourceStats[channel]?.count || 0}
                      </div>
                      <div style={{ marginTop: 4, fontSize: 12, color: 'var(--text-muted)' }}>
                        Eventy: {Number(source.event_count || 0)} / ostatni {source.last_event_status || 'brak'}
                      </div>
                      <div style={{ marginTop: 4, fontSize: 12, color: 'var(--text-muted)' }}>
                        Ostatnio: {formatDate(source.last_event_at || sourceStats[channel]?.lastAt)}
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="ios-inset-row muted">
                Brak podpietych kanalow Unified Inbox. Dodaj je w Integracjach.
              </div>
            )}
          </section>

          <div className="crm-inbox-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, .85fr) minmax(320px, 1.15fr)', gap: 12 }}>
            <section className="ios-inset crm-inbox-list-panel" style={{ padding: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
                <strong>Rozmowy</strong>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{messages.length}</span>
              </div>
              <div className="ios-inset-list">
                {messages.map((message) => (
                  <button
                    key={message.id}
                    type="button"
                    className="ios-inset-row crm-inbox-message-row"
                    onClick={() => setSelectedId(message.id)}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      border: String(selected?.id) === String(message.id) ? '1px solid var(--accent, #2563eb)' : undefined,
                      cursor: 'pointer',
                      color: 'var(--text)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
                      <strong>{message.lead_title || message.client_name || `Lead #${message.lead_id}`}</strong>
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{message.channel}</span>
                    </div>
                    <div style={{ marginTop: 4, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {message.direction === 'outbound' ? 'Wychodzaca' : 'Przychodzaca'}: {message.body}
                    </div>
                    <div style={{ marginTop: 4, fontSize: 12, color: 'var(--text-muted)' }}>
                      {message.status} / {formatDate(message.created_at)}
                    </div>
                  </button>
                ))}
                {loading ? <div className="ios-inset-row muted">Laduje rozmowy...</div> : null}
                {!loading && messages.length === 0 ? (
                  <div className="ios-inset-row muted">
                    {activeFiltersCount
                      ? 'Brak rozmow dla tych filtrow. Wyczysc filtry albo odswiez skrzynke.'
                      : 'Brak wiadomosci. Nowe rozmowy z WhatsApp, SMS, e-maila i webchatu pojawia sie tutaj po podpieciu kanalow.'}
                  </div>
                ) : null}
              </div>
            </section>

            <section className="ios-inset crm-inbox-detail-panel" style={{ padding: 12 }}>
              {selected ? (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', marginBottom: 10 }}>
                    <div>
                      <div style={{ fontWeight: 700 }}>{selected.lead_title || selected.client_name || `Lead #${selected.lead_id}`}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {selected.channel} / {selected.direction} / {selected.status}
                      </div>
                    </div>
                    <button className="ios-btn" type="button" onClick={() => navigate('/crm/pipeline')}>Pipeline</button>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                    <button className="ios-btn" type="button" disabled={statusSavingId === selected.id} onClick={() => updateMessageStatus(selected.id, 'read')}>
                      Przeczytane
                    </button>
                    <button className="ios-btn" type="button" disabled={statusSavingId === selected.id} onClick={() => updateMessageStatus(selected.id, 'sent')}>
                      Wyslane
                    </button>
                    <button className="ios-btn" type="button" disabled={statusSavingId === selected.id} onClick={() => updateMessageStatus(selected.id, 'queued')}>
                      Ponow
                    </button>
                    <button className="ios-btn" type="button" disabled={statusSavingId === selected.id} onClick={() => updateMessageStatus(selected.id, 'failed')}>
                      Blad
                    </button>
                  </div>
                  <div className="ios-inset-list">
                    <div className="ios-inset-row">
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Kontakt</div>
                      <div>{selected.recipient_handle || selected.sender_handle || selected.lead_phone || selected.lead_email || '-'}</div>
                    </div>
                    <div className="ios-inset-row">
                      <label style={{ display: 'grid', gap: 6, fontSize: 12, color: 'var(--text-muted)' }}>
                        Handlowiec
                        <select
                          className="ios-field"
                          value={selected.owner_user_id || ''}
                          disabled={ownerSaving}
                          onChange={(e) => assignLeadOwner(e.target.value)}
                        >
                          <option value="">Bez ownera</option>
                          {owners.map((owner) => (
                            <option key={owner.id} value={owner.id}>
                              {ownerLabel(owner)}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    {selected.subject ? (
                      <div className="ios-inset-row">
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Temat</div>
                        <div>{selected.subject}</div>
                      </div>
                    ) : null}
                    <div className="ios-inset-row">
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Tresc</div>
                      <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.45 }}>{selected.body}</div>
                    </div>
                    {selected.last_error ? (
                      <div className="ios-inset-row">
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Blad wysylki</div>
                        <div>{selected.last_error}</div>
                      </div>
                    ) : null}
                  </div>
                  <div className="ios-inset crm-inbox-history" style={{ marginTop: 12, padding: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
                      <strong>Historia rozmowy</strong>
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {timelineLoading ? 'Laduje...' : `${timelineMessages.length} wpisow`}
                      </span>
                    </div>
                    <div className="ios-inset-list">
                      {timelineMessages.map((message) => (
                        <div key={message.id} className="ios-inset-row">
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
                            <strong>{message.direction === 'outbound' ? 'Handlowiec' : 'Klient'}</strong>
                            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{message.channel} / {message.status}</span>
                          </div>
                          <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.45 }}>{message.body}</div>
                          <div style={{ marginTop: 4, fontSize: 12, color: 'var(--text-muted)' }}>
                            {formatDate(message.created_at)}
                          </div>
                        </div>
                      ))}
                      {!timelineLoading && timelineMessages.length === 0 ? (
                        <div className="ios-inset-row muted">Brak historii rozmowy.</div>
                      ) : null}
                    </div>
                  </div>
                  <form onSubmit={sendReply} className="ios-inset crm-inbox-reply" style={{ marginTop: 12, padding: 12 }}>
                    <label style={{ display: 'grid', gap: 6, fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
                      Szablon
                      <select className="ios-field" value={replyTemplateId} onChange={(e) => applyReplyTemplate(e.target.value)}>
                        <option value="">Bez szablonu</option>
                        {messageTemplates.map((template) => (
                          <option key={template.id} value={template.id}>
                            {template.name} / {template.channel}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label style={{ display: 'grid', gap: 6, fontSize: 12, color: 'var(--text-muted)' }}>
                      Odpowiedz
                      <textarea
                        className="ios-field"
                        rows={4}
                        value={replyBody}
                        onChange={(e) => setReplyBody(e.target.value)}
                        placeholder="Napisz odpowiedz do klienta..."
                      />
                    </label>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                      <button className="ios-btn ios-btn-primary" type="submit" disabled={replySending || !replyBody.trim()}>
                        {replySending ? 'Dodaje...' : 'Dodaj do kolejki'}
                      </button>
                    </div>
                  </form>
                </>
              ) : (
                <div className="ios-inset-row muted">Wybierz rozmowe z listy.</div>
              )}
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
