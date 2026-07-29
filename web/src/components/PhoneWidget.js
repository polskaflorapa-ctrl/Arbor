import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle, ChevronDown, Clock, ExternalLink, Mic, Phone, PhoneCall, PhoneIncoming, PhoneMissed, Save, Settings, UserRound, X } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import api from '../api';
import { authHeaders, getStoredToken } from '../utils/storedToken';
import { readStoredUser } from '../utils/readStoredUser';
import { getApiErrorMessage } from '../utils/apiError';
import { getReactApiBase } from '../utils/apiBase';

const POLL_MS = 15000;

function normalizePhone(value) {
  const text = String(value || '').trim();
  const plus = text.startsWith('+') ? '+' : '';
  return `${plus}${text.replace(/\D/g, '')}`.slice(0, 16);
}

function formatWhen(value) {
  if (!value) return '';
  return new Date(value).toLocaleString('pl-PL', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
}

function phoneRealtimeUrl() {
  const apiBase = getReactApiBase();
  const absolute = new URL(apiBase, window.location.origin);
  absolute.protocol = absolute.protocol === 'https:' ? 'wss:' : 'ws:';
  absolute.pathname = `${absolute.pathname.replace(/\/api\/?$/, '')}/api/telephony/realtime`;
  absolute.search = '';
  return absolute.toString();
}

function loadExternalScript(id, src) {
  return new Promise((resolve, reject) => {
    const existing = document.getElementById(id);
    if (existing) {
      if (existing.dataset.loaded === 'true') resolve();
      else existing.addEventListener('load', resolve, { once: true });
      return;
    }
    const script = document.createElement('script');
    script.id = id;
    script.src = src;
    script.async = true;
    script.onload = () => { script.dataset.loaded = 'true'; resolve(); };
    script.onerror = () => reject(new Error(`Nie udalo sie zaladowac ${src}`));
    document.head.appendChild(script);
  });
}

export default function PhoneWidget() {
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState('');
  const [calls, setCalls] = useState([]);
  const [dialing, setDialing] = useState(false);
  const [message, setMessage] = useState('');
  const [matchedLead, setMatchedLead] = useState(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [outcome, setOutcome] = useState('contacted');
  const [outcomeNote, setOutcomeNote] = useState('');
  const [followUpAt, setFollowUpAt] = useState('');
  const [savingOutcome, setSavingOutcome] = useState(false);
  const [realtimeStatus, setRealtimeStatus] = useState('connecting');
  const [realtimeCall, setRealtimeCall] = useState(null);
  const [webrtcStatus, setWebrtcStatus] = useState('loading');
  const [showSettings, setShowSettings] = useState(false);
  const [providerForm, setProviderForm] = useState({ api_key: '', api_secret: '', caller_id: '', sip: '' });
  const [savingSettings, setSavingSettings] = useState(false);
  const [extensionUsers, setExtensionUsers] = useState([]);
  const [extensionRows, setExtensionRows] = useState([]);
  const [extensionForm, setExtensionForm] = useState({ user_id: '', sip: '', enabled: true });
  const [extensionLoading, setExtensionLoading] = useState(false);
  const user = useMemo(() => readStoredUser(), []);
  const token = getStoredToken();
  const hidden = !token || ['/', '/login'].includes(location.pathname) || location.pathname.startsWith('/portal-klienta');

  const loadCalls = useCallback(async () => {
    if (!token) return;
    try {
      const params = { limit: 12, offset: 0 };
      if (user?.oddzial_id) params.oddzial_id = user.oddzial_id;
      const res = await api.get('/telephony/calls', { headers: authHeaders(token), params });
      const rows = Array.isArray(res.data) ? res.data : (res.data?.items || []);
      setCalls(rows);
    } catch {
      // Widget must never interrupt work in the main application.
    }
  }, [token, user?.oddzial_id]);

  useEffect(() => {
    if (hidden) return undefined;
    loadCalls();
    const timer = window.setInterval(loadCalls, POLL_MS);
    return () => window.clearInterval(timer);
  }, [hidden, loadCalls]);

  useEffect(() => {
    if (hidden || !token) return undefined;
    if (typeof WebSocket === 'undefined') {
      setRealtimeStatus('offline');
      return undefined;
    }
    let socket;
    let reconnectTimer;
    let stopped = false;
    const connect = () => {
      setRealtimeStatus('connecting');
      socket = new WebSocket(phoneRealtimeUrl(), ['arbor-phone', token]);
      socket.onopen = () => setRealtimeStatus('online');
      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'phone.ringing') {
            setRealtimeCall({ ...data, status: 'ringing', call_type: data.direction || 'inbound' });
            setPhone(normalizePhone(data.phone));
            setOpen(true);
          } else if (data.type === 'phone.answered') {
            setRealtimeCall((current) => ({ ...(current || data), ...data, status: 'answered' }));
          } else if (data.type === 'phone.ended') {
            setRealtimeCall((current) => ({ ...(current || data), ...data, status: 'ended' }));
            setMessage(`Rozmowa zakończona${data.duration_sec ? ` · ${data.duration_sec}s` : ''}. Nagranie zostanie dodane do CRM.`);
            loadCalls();
          } else if (data.type === 'phone.recording_ready') {
            setMessage('Nagranie rozmowy jest gotowe w historii CRM.');
            loadCalls();
          }
        } catch {
          // Ignore malformed provider events without breaking the phone.
        }
      };
      socket.onerror = () => setRealtimeStatus('offline');
      socket.onclose = () => {
        setRealtimeStatus('offline');
        if (!stopped) reconnectTimer = window.setTimeout(connect, 3000);
      };
    };
    connect();
    return () => {
      stopped = true;
      window.clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [hidden, loadCalls, token]);

  useEffect(() => {
    if (hidden || !token) return undefined;
    let cancelled = false;
    const startWebrtc = async () => {
      try {
        setWebrtcStatus('loading');
        const config = await api.get('/telephony/zadarma/webrtc-config', { headers: authHeaders(token) });
        if (cancelled) return;
        await loadExternalScript('zadarma-webrtc-lib', 'https://my.zadarma.com/webphoneWebRTCWidget/v8/js/loader-phone-lib.js?v=17');
        await loadExternalScript('zadarma-webrtc-fn', 'https://my.zadarma.com/webphoneWebRTCWidget/v8/js/loader-phone-fn.js?v=17');
        if (cancelled) return;
        if (typeof window.zadarmaWidgetFn !== 'function') throw new Error('Biblioteka WebRTC Zadarmy nie jest dostepna.');
        window.zadarmaWidgetFn(
          config.data.key,
          config.data.sip,
          'rounded',
          'pl',
          true,
          "{right:'86px',bottom:'18px'}"
        );
        setProviderForm((current) => ({ ...current, sip: config.data.sip || current.sip }));
        setWebrtcStatus('online');
      } catch (error) {
        if (cancelled) return;
        setWebrtcStatus(error.response?.status === 404 ? 'unconfigured' : 'error');
      }
    };
    startWebrtc();
    return () => { cancelled = true; };
  }, [hidden, token]);

  const loadAdminTelephony = useCallback(async () => {
    if (!showSettings || !['Prezes', 'Dyrektor', 'Administrator'].includes(user?.rola)) return;
    setExtensionLoading(true);
    try {
      const [settingsRes, usersRes, extensionsRes] = await Promise.all([
        api.get('/telephony/zadarma/settings', { headers: authHeaders(token) }),
        api.get('/uzytkownicy', { headers: authHeaders(token) }),
        api.get('/telephony/zadarma/extensions', { headers: authHeaders(token) }),
      ]);
      const settings = settingsRes.data || {};
      setProviderForm((current) => ({
        ...current,
        caller_id: settings.caller_id || current.caller_id,
        sip: current.sip || '',
      }));
      setExtensionUsers(Array.isArray(usersRes.data) ? usersRes.data : []);
      setExtensionRows(Array.isArray(extensionsRes.data) ? extensionsRes.data : []);
    } catch (error) {
      setMessage(getApiErrorMessage(error, 'Nie udało się pobrać konfiguracji stanowisk telefonicznych.'));
    } finally {
      setExtensionLoading(false);
    }
  }, [showSettings, token, user?.rola]);

  useEffect(() => {
    loadAdminTelephony();
  }, [loadAdminTelephony]);

  useEffect(() => {
    const onPhone = (event) => {
      const next = normalizePhone(event.detail?.phone);
      if (next) setPhone(next);
      setOpen(true);
    };
    window.addEventListener('arbor:phone', onPhone);
    return () => window.removeEventListener('arbor:phone', onPhone);
  }, []);

  useEffect(() => {
    const interceptPhoneLink = (event) => {
      const anchor = event.target?.closest?.('a[href^="tel:"]');
      if (!anchor) return;
      if (anchor.classList.contains('phone-widget-answer')) return;
      const next = normalizePhone(anchor.getAttribute('href').slice(4));
      if (!next) return;
      event.preventDefault();
      setPhone(next);
      setOpen(true);
    };
    document.addEventListener('click', interceptPhoneLink);
    return () => document.removeEventListener('click', interceptPhoneLink);
  }, []);

  const incoming = useMemo(
    () => (
      realtimeCall?.call_type === 'inbound' && realtimeCall?.status === 'ringing'
        ? realtimeCall
        : calls.find((call) => call.call_type === 'inbound' && ['ringing', 'queued'].includes(String(call.status).toLowerCase()))
    ),
    [calls, realtimeCall]
  );
  const missed = useMemo(
    () => calls.filter((call) => call.call_type === 'inbound' && ['missed', 'no_answer', 'failed'].includes(String(call.status).toLowerCase())).slice(0, 3),
    [calls]
  );
  const lastCall = calls[0];

  useEffect(() => {
    const target = normalizePhone(incoming?.phone || phone);
    if (target.replace(/\D/g, '').length < 9 || !token) {
      setMatchedLead(null);
      return undefined;
    }
    const timer = window.setTimeout(async () => {
      try {
        setLookupLoading(true);
        const params = { q: target };
        if (user?.oddzial_id) params.oddzial_id = user.oddzial_id;
        const res = await api.get('/crm/leads', { headers: authHeaders(token), params });
        const rows = Array.isArray(res.data) ? res.data : [];
        const digits = target.replace(/\D/g, '').slice(-9);
        setMatchedLead(rows.find((lead) => String(lead.phone || '').replace(/\D/g, '').endsWith(digits)) || rows[0] || null);
      } catch {
        setMatchedLead(null);
      } finally {
        setLookupLoading(false);
      }
    }, 350);
    return () => window.clearTimeout(timer);
  }, [incoming?.phone, phone, token, user?.oddzial_id]);

  useEffect(() => {
    if (incoming) setOpen(true);
  }, [incoming]);

  const startCall = async (number = phone) => {
    const target = normalizePhone(number);
    if (target.replace(/\D/g, '').length < 9) {
      setMessage('Podaj poprawny numer telefonu.');
      return;
    }
    setDialing(true);
    setMessage('');
    try {
      const res = await api.post(
        '/telefon/polacz-do-klienta',
        { do: target },
        { headers: authHeaders(token) }
      );
      setPhone(target);
      setMessage(res.data?.provider === 'zadarma'
        ? 'Zadarma dzwoni teraz na Twój telefon. Po odebraniu połączy Cię z klientem.'
        : 'Połączenie zostało uruchomione.');
      await loadCalls();
    } catch (error) {
      setMessage(getApiErrorMessage(error, 'Nie udało się rozpocząć połączenia.'));
    } finally {
      setDialing(false);
    }
  };

  const saveOutcome = async () => {
    if (!matchedLead?.id) {
      setMessage('Najpierw wybierz numer powiązany z leadem CRM.');
      return;
    }
    setSavingOutcome(true);
    setMessage('');
    try {
      const labels = {
        contacted: 'Kontakt skuteczny',
        no_answer: 'Brak odpowiedzi',
        voicemail: 'Poczta głosowa',
        interested: 'Klient zainteresowany',
        not_interested: 'Klient niezainteresowany',
      };
      const text = [`Wynik rozmowy: ${labels[outcome] || outcome}`, outcomeNote.trim()].filter(Boolean).join('\n');
      await api.post(
        `/crm/leads/${matchedLead.id}/activities`,
        { type: 'call', text },
        { headers: authHeaders(token) }
      );
      if (followUpAt) {
        await api.post(
          `/crm/leads/${matchedLead.id}/activities`,
          { type: 'task', text: `Follow-up po rozmowie: ${outcomeNote.trim() || labels[outcome]}`, due_at: new Date(followUpAt).toISOString() },
          { headers: authHeaders(token) }
        );
      }
      setOutcomeNote('');
      setFollowUpAt('');
      setMessage('Wynik rozmowy zapisany w historii CRM.');
    } catch (error) {
      setMessage(getApiErrorMessage(error, 'Nie udało się zapisać wyniku rozmowy.'));
    } finally {
      setSavingOutcome(false);
    }
  };

  const saveProviderConfiguration = async () => {
    if (!user?.id || !providerForm.sip.trim()) {
      setMessage('Podaj numer wewnętrzny SIP przypisany do tego użytkownika.');
      return;
    }
    setSavingSettings(true);
    setMessage('');
    try {
      if (providerForm.api_key.trim() || providerForm.api_secret.trim() || providerForm.caller_id.trim()) {
        await api.put('/telephony/zadarma/settings', {
          api_key: providerForm.api_key.trim() || undefined,
          api_secret: providerForm.api_secret.trim() || undefined,
          caller_id: providerForm.caller_id.trim() || undefined,
        }, { headers: authHeaders(token) });
      }
      await api.put('/telephony/zadarma/extensions', {
        user_id: user.id,
        sip: providerForm.sip.trim(),
        enabled: true,
      }, { headers: authHeaders(token) });
      await api.post('/telephony/zadarma/test', {}, { headers: authHeaders(token) });
      setMessage('Konfiguracja Zadarmy jest poprawna. Odśwież stronę, aby zarejestrować telefon WebRTC.');
      setProviderForm((current) => ({ ...current, api_key: '', api_secret: '' }));
      setWebrtcStatus('loading');
    } catch (error) {
      setMessage(getApiErrorMessage(error, 'Nie udało się zapisać lub zweryfikować konfiguracji Zadarmy.'));
    } finally {
      setSavingSettings(false);
    }
  };

  const saveExtensionAssignment = async () => {
    if (!extensionForm.user_id || !extensionForm.sip.trim()) {
      setMessage('Wybierz pracownika i podaj jego numer wewnętrzny SIP.');
      return;
    }
    setExtensionLoading(true);
    setMessage('');
    try {
      await api.put('/telephony/zadarma/extensions', {
        user_id: Number(extensionForm.user_id),
        sip: extensionForm.sip.trim(),
        enabled: extensionForm.enabled,
      }, { headers: authHeaders(token) });
      setExtensionForm({ user_id: '', sip: '', enabled: true });
      await loadAdminTelephony();
      setMessage('Stanowisko telefoniczne zostało zapisane.');
    } catch (error) {
      setMessage(getApiErrorMessage(error, 'Nie udało się przypisać numeru SIP.'));
    } finally {
      setExtensionLoading(false);
    }
  };

  const editExtension = (row) => {
    setExtensionForm({ user_id: String(row.user_id), sip: row.sip || '', enabled: row.enabled !== false });
  };

  if (hidden) return null;

  return (
    <aside className={`phone-widget ${open ? 'is-open' : ''} ${incoming ? 'has-incoming' : ''}`} aria-label="Telefon">
      {!open ? (
        <button className="phone-widget-launcher" type="button" onClick={() => setOpen(true)} aria-label="Otwórz telefon">
          {incoming ? <PhoneIncoming size={22} /> : <Phone size={22} />}
          {missed.length ? <span>{missed.length}</span> : null}
        </button>
      ) : (
        <div className="phone-widget-panel">
          <header>
            <div className="phone-widget-title">
              <span className={`phone-widget-status-dot is-${realtimeStatus}`} />
              <div><strong>Telefon</strong><small>Zadarma · {realtimeStatus === 'online' ? 'na żywo' : 'tryb awaryjny'} · nagrywanie CRM</small></div>
            </div>
            <div className="phone-widget-head-actions">
              {['Prezes', 'Dyrektor', 'Administrator'].includes(user?.rola) ? (
                <button type="button" onClick={() => setShowSettings((value) => !value)} aria-label="Konfiguracja Zadarmy"><Settings size={17} /></button>
              ) : null}
              <button type="button" onClick={() => setOpen(false)} aria-label="Minimalizuj telefon"><ChevronDown size={18} /></button>
            </div>
          </header>

          {showSettings ? (
            <section className="phone-widget-settings">
              <strong>Konfiguracja produkcyjna Zadarmy</strong>
              <small>Klucze API są szyfrowane na serwerze. Hasło SIP nie jest zapisywane w przeglądarce.</small>
              <input value={providerForm.api_key} onChange={(event) => setProviderForm((form) => ({ ...form, api_key: event.target.value }))} placeholder="Zadarma API key" autoComplete="off" />
              <input value={providerForm.api_secret} onChange={(event) => setProviderForm((form) => ({ ...form, api_secret: event.target.value }))} placeholder="Zadarma API secret" type="password" autoComplete="new-password" />
              <input value={providerForm.caller_id} onChange={(event) => setProviderForm((form) => ({ ...form, caller_id: event.target.value }))} placeholder="Caller ID firmy, np. +48123456789" />
              <input value={providerForm.sip} onChange={(event) => setProviderForm((form) => ({ ...form, sip: event.target.value }))} placeholder="SIP / numer wewnętrzny użytkownika" />
              <button type="button" onClick={saveProviderConfiguration} disabled={savingSettings}>
                <Save size={15} /> {savingSettings ? 'Sprawdzam…' : 'Zapisz i sprawdź połączenie'}
              </button>
              <div className="phone-widget-extension-manager">
                <div>
                  <strong>Stanowiska pracowników</strong>
                  <small>{extensionRows.filter((row) => row.enabled).length}/{extensionUsers.length} aktywnych</small>
                </div>
                <select
                  value={extensionForm.user_id}
                  onChange={(event) => {
                    const existing = extensionRows.find((row) => String(row.user_id) === event.target.value);
                    setExtensionForm({
                      user_id: event.target.value,
                      sip: existing?.sip || '',
                      enabled: existing?.enabled !== false,
                    });
                  }}
                >
                  <option value="">Wybierz pracownika…</option>
                  {extensionUsers.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {[employee.imie, employee.nazwisko].filter(Boolean).join(' ') || employee.login} · oddział {employee.oddzial_id || '—'}
                    </option>
                  ))}
                </select>
                <input
                  value={extensionForm.sip}
                  onChange={(event) => setExtensionForm((form) => ({ ...form, sip: event.target.value }))}
                  placeholder="Numer wewnętrzny / login SIP"
                />
                <label>
                  <input
                    type="checkbox"
                    checked={extensionForm.enabled}
                    onChange={(event) => setExtensionForm((form) => ({ ...form, enabled: event.target.checked }))}
                  />
                  Telefon aktywny
                </label>
                <button type="button" onClick={saveExtensionAssignment} disabled={extensionLoading}>
                  <Save size={15} /> {extensionLoading ? 'Zapisuję…' : 'Przypisz stanowisko'}
                </button>
                <div className="phone-widget-extension-list">
                  {extensionRows.map((row) => (
                    <button key={row.user_id} type="button" onClick={() => editExtension(row)}>
                      <span>
                        <strong>{[row.imie, row.nazwisko].filter(Boolean).join(' ') || row.login}</strong>
                        <small>SIP {row.sip} · oddział {row.oddzial_id || '—'}</small>
                      </span>
                      <em className={row.enabled ? 'is-ready' : 'is-off'}>{row.enabled ? 'aktywny' : 'wyłączony'}</em>
                    </button>
                  ))}
                  {!extensionLoading && extensionRows.length === 0 ? <small>Nie przypisano jeszcze żadnych stanowisk.</small> : null}
                </div>
              </div>
            </section>
          ) : null}

          {webrtcStatus !== 'online' && !showSettings ? (
            <div className="phone-widget-webrtc-warning">
              {webrtcStatus === 'unconfigured'
                ? 'WebRTC nie jest jeszcze skonfigurowany dla tego użytkownika.'
                : webrtcStatus === 'loading' ? 'Rejestruję telefon WebRTC…' : 'Telefon WebRTC jest offline. Callback pozostaje dostępny.'}
            </div>
          ) : null}

          {incoming ? (
            <section className="phone-widget-incoming">
              <PhoneIncoming size={24} />
              <div><small>Połączenie przychodzące</small><strong>{incoming.lead_name || incoming.phone}</strong><span>{incoming.phone}</span></div>
              <a href={`tel:${normalizePhone(incoming.phone)}`} className="phone-widget-answer" aria-label="Odbierz połączenie"><PhoneCall size={18} /></a>
              <button type="button" className="phone-widget-reject" onClick={() => setCalls((rows) => rows.filter((row) => row.id !== incoming.id))} aria-label="Odrzuć połączenie"><X size={18} /></button>
            </section>
          ) : null}

          <section className="phone-widget-dial">
            <label htmlFor="global-phone-number">Numer klienta</label>
            <input
              id="global-phone-number"
              value={phone}
              onChange={(event) => setPhone(normalizePhone(event.target.value))}
              onKeyDown={(event) => { if (event.key === 'Enter') startCall(); }}
              placeholder="+48 500 000 000"
              inputMode="tel"
            />
            <button type="button" onClick={() => startCall()} disabled={dialing}>
              <PhoneCall size={18} /> {dialing ? 'Łączenie…' : 'Zadzwoń'}
            </button>
            <div className="phone-widget-recording"><Mic size={13} /> Rozmowa zostanie automatycznie nagrana i przypięta do CRM.</div>
          </section>

          {(lookupLoading || matchedLead) ? (
            <section className="phone-widget-crm-context">
              <div className="phone-widget-section-title"><UserRound size={14} /> Rozpoznany kontakt</div>
              {lookupLoading ? <div className="phone-widget-lookup">Szukam klienta w CRM…</div> : (
                <>
                  <button
                    type="button"
                    className="phone-widget-lead"
                    onClick={() => navigate(`/crm/pipeline?lead_id=${matchedLead.id}`)}
                  >
                    <span>
                      <strong>{matchedLead.client_name || matchedLead.title}</strong>
                      <small>{matchedLead.title} · {matchedLead.stage} · {matchedLead.owner_name || 'bez opiekuna'}</small>
                    </span>
                    <ExternalLink size={15} />
                  </button>
                  <div className="phone-widget-outcome">
                    <select value={outcome} onChange={(event) => setOutcome(event.target.value)} aria-label="Wynik rozmowy">
                      <option value="contacted">Kontakt skuteczny</option>
                      <option value="no_answer">Brak odpowiedzi</option>
                      <option value="voicemail">Poczta głosowa</option>
                      <option value="interested">Klient zainteresowany</option>
                      <option value="not_interested">Klient niezainteresowany</option>
                    </select>
                    <textarea
                      rows={2}
                      value={outcomeNote}
                      onChange={(event) => setOutcomeNote(event.target.value)}
                      placeholder="Ustalenia z rozmowy…"
                    />
                    <label><Clock size={13} /> Follow-up
                      <input type="datetime-local" value={followUpAt} onChange={(event) => setFollowUpAt(event.target.value)} />
                    </label>
                    <button type="button" onClick={saveOutcome} disabled={savingOutcome}>
                      <CheckCircle size={15} /> {savingOutcome ? 'Zapisuję…' : 'Zapisz wynik'}
                    </button>
                  </div>
                </>
              )}
            </section>
          ) : phone.replace(/\D/g, '').length >= 9 && !lookupLoading ? (
            <div className="phone-widget-no-match">Numer nie jest jeszcze powiązany z leadem CRM.</div>
          ) : null}

          {message ? <div className="phone-widget-message" role="status">{message}</div> : null}

          {missed.length ? (
            <section className="phone-widget-missed">
              <div className="phone-widget-section-title"><PhoneMissed size={14} /> Nieodebrane</div>
              {missed.map((call) => (
                <button key={call.id} type="button" onClick={() => startCall(call.phone)}>
                  <span><strong>{call.lead_name || call.phone}</strong><small>{formatWhen(call.created_at)}</small></span>
                  <PhoneCall size={16} />
                </button>
              ))}
            </section>
          ) : null}

          <footer>
            <span>{lastCall ? `Ostatnie: ${formatWhen(lastCall.created_at)}` : 'Brak ostatnich rozmów'}</span>
            <button type="button" onClick={() => navigate('/telefonia')}>Pełna historia</button>
          </footer>
        </div>
      )}
    </aside>
  );
}
