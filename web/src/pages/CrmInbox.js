import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import PageHeader from '../components/PageHeader';
import StatusMessage from '../components/StatusMessage';
import api from '../api';
import { authHeaders, getStoredToken } from '../utils/storedToken';
import { getApiErrorMessage } from '../utils/apiError';

const CHANNELS = ['', 'whatsapp', 'sms', 'email', 'instagram', 'facebook', 'messenger', 'telegram', 'webchat', 'other'];
const DIRECTIONS = ['', 'inbound', 'outbound'];
const STATUSES = ['', 'received', 'queued', 'processing', 'sent', 'delivered', 'read', 'failed'];

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
  const [selectedId, setSelectedId] = useState(null);
  const [filters, setFilters] = useState({ channel: '', direction: '', status: '', q: '' });

  const selected = useMemo(
    () => messages.find((message) => String(message.id) === String(selectedId)) || messages[0] || null,
    [messages, selectedId]
  );

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
      setMsg(getApiErrorMessage(e, 'Nie udalo sie pobrac skrzynki CRM'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadInbox();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.channel, filters.direction, filters.status]);

  const applySearch = (event) => {
    event.preventDefault();
    loadInbox();
  };

  return (
    <div className="app-shell">
      <Sidebar />
      <main className="app-main">
        <PageHeader
          title="Unified Inbox"
          subtitle="Wspolna skrzynka rozmow z leadow CRM."
          variant="hero"
        />
        <div className="app-content">
          <StatusMessage message={msg} tone={msg ? 'error' : undefined} />

          <section className="ios-inset" style={{ marginBottom: 12, padding: 12 }}>
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
              <button className="ios-btn ios-btn-primary" type="submit">Filtruj</button>
            </form>
          </section>

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, .85fr) minmax(320px, 1.15fr)', gap: 12 }}>
            <section className="ios-inset" style={{ padding: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
                <strong>Rozmowy</strong>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{messages.length}</span>
              </div>
              <div className="ios-inset-list">
                {messages.map((message) => (
                  <button
                    key={message.id}
                    type="button"
                    className="ios-inset-row"
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
                      {message.status} · {formatDate(message.created_at)}
                    </div>
                  </button>
                ))}
                {!loading && messages.length === 0 ? <div className="ios-inset-row muted">Brak wiadomosci.</div> : null}
              </div>
            </section>

            <section className="ios-inset" style={{ padding: 12 }}>
              {selected ? (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', marginBottom: 10 }}>
                    <div>
                      <div style={{ fontWeight: 700 }}>{selected.lead_title || selected.client_name || `Lead #${selected.lead_id}`}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {selected.channel} · {selected.direction} · {selected.status}
                      </div>
                    </div>
                    <button className="ios-btn" type="button" onClick={() => navigate('/crm/pipeline')}>Pipeline</button>
                  </div>
                  <div className="ios-inset-list">
                    <div className="ios-inset-row">
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Kontakt</div>
                      <div>{selected.recipient_handle || selected.sender_handle || selected.lead_phone || selected.lead_email || '-'}</div>
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
