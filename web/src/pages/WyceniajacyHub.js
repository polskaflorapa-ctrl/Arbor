import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Phone, Plus, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import BrandLogo from '../components/BrandLogo';
import api from '../api';
import { getApiErrorMessage } from '../utils/apiError';
import { localDateKey } from '../utils/localDateKey';
import { readStoredUser } from '../utils/readStoredUser';
import { getStoredToken, authHeaders } from '../utils/storedToken';
import '../styles/estimator-office-template.css';

const CLOSED_STATUSES = new Set(['zakonczone', 'zakończone', 'anulowane']);

const DEFAULT_LINES = Object.freeze([
  { name: 'Wycinka topoli (zagrożenie)', qty: 3, price: 650, unit: 'szt' },
  { name: 'Frezowanie pni', qty: 3, price: 140, unit: 'szt' },
  { name: 'Wywóz i utylizacja', qty: 8, price: 90, unit: 'm³' },
]);

const PRESET_LINES = Object.freeze([
  { label: 'Dojazd', name: 'Dojazd ekipy + sprzęt', qty: 1, price: 250, unit: 'usł' },
  { label: 'Podnośnik', name: 'Praca podnośnika koszowego', qty: 4, price: 180, unit: 'rbg' },
  { label: 'Rębak', name: 'Rozdrabnianie gałęzi (rębak)', qty: 1, price: 400, unit: 'usł' },
]);

const PRIORITY_META = Object.freeze({
  PILNY: { className: 'is-urgent', label: 'PILNY' },
  WYSOKI: { className: 'is-high', label: 'WYSOKI' },
  NORMALNY: { className: 'is-normal', label: 'NORMALNY' },
});

function normalize(value) {
  return String(value || '').trim();
}

function normalizedStatus(item) {
  return normalize(item?.status).toLocaleLowerCase('pl-PL');
}

function isClosed(item) {
  return CLOSED_STATUSES.has(normalizedStatus(item));
}

function itemDate(item) {
  const value = item?.data_planowana || item?.created_at;
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isToday(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return localDateKey(date) === localDateKey();
}

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

function clientName(item) {
  return normalize(item?.klient_firma) || normalize(item?.klient_nazwa) || `Oględziny #${item?.id || '—'}`;
}

function serviceName(item) {
  const note = normalize(item?.wycena_opis) || normalize(item?.notatki);
  return normalize(item?.typ_uslugi) || note.split(/\r?\n/)[0] || 'Wycena prac terenowych';
}

function addressLabel(item) {
  return [normalize(item?.adres), normalize(item?.miasto)].filter(Boolean).join(', ') || 'Adres do uzupełnienia';
}

function telHref(value) {
  const phone = normalize(value).replace(/[^+\d]/g, '');
  return phone ? `tel:${phone}` : '';
}

function queueTime(item) {
  const date = itemDate(item);
  if (!date) return 'bez terminu';
  if (isToday(date)) {
    return date.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
  }
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (localDateKey(date) === localDateKey(yesterday)) return 'wczoraj';
  return date.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit' });
}

function channelLabel(item) {
  return normalize(item?.kanal) || normalize(item?.channel) || normalize(item?.zrodlo) || 'Oględziny';
}

function priorityMeta(item) {
  const raw = normalize(item?.priorytet || item?.priority).toLocaleUpperCase('pl-PL');
  if (raw.includes('PILN') || raw.includes('KRYTY')) return PRIORITY_META.PILNY;
  if (raw.includes('WYSOK')) return PRIORITY_META.WYSOKI;
  const date = itemDate(item);
  if (!isClosed(item) && date && localDateKey(date) < localDateKey()) return PRIORITY_META.PILNY;
  if (!isClosed(item) && date && isToday(date)) return PRIORITY_META.WYSOKI;
  return PRIORITY_META.NORMALNY;
}

function numeric(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

function money(value) {
  return `${Math.round(numeric(value)).toLocaleString('pl-PL')} zł`;
}

function compactValue(value) {
  const amount = numeric(value);
  if (amount >= 1000) {
    const compact = Math.round(amount / 100) / 10;
    return `${String(compact).replace('.', ',')}k`;
  }
  return String(Math.round(amount));
}

function quoteNumber(item) {
  const id = item?.wycena_id || item?.id;
  return id ? `WY-${String(id).padStart(4, '0')}` : 'WY—';
}

function buildDraft(item) {
  const estimated = numeric(item?.wartosc_szacowana);
  let source = DEFAULT_LINES;
  if (estimated > 0) {
    const primary = Math.max(0, Math.round(estimated * 0.65));
    const travel = Math.max(0, Math.round(estimated * 0.15));
    source = [
      { name: serviceName(item), qty: 1, price: primary, unit: 'usł' },
      { name: 'Dojazd ekipy + sprzęt', qty: 1, price: travel, unit: 'usł' },
      { name: 'Wywóz i utylizacja', qty: 1, price: Math.max(0, estimated - primary - travel), unit: 'usł' },
    ];
  }
  const seed = String(item?.id || 'draft');
  return {
    lines: source.map((line, index) => ({ ...line, id: `${seed}-${index + 1}` })),
    nextId: source.length + 1,
    note: normalize(item?.notatki_wyniki) || normalize(item?.notatki),
    discount: false,
  };
}

function initials(user) {
  const parts = [user?.imie, user?.nazwisko].map(normalize).filter(Boolean);
  if (!parts.length && user?.login) parts.push(normalize(user.login));
  return parts.map((part) => part[0]).join('').slice(0, 2).toLocaleUpperCase('pl-PL') || 'PF';
}

function QueueSidebar({ activeId, items, onPick, onOpen, onProfile, user }) {
  return (
    <aside className="estimator-office-queue" aria-label="Kolejka zapytań do wyceny">
      <div className="estimator-office-brand">
        <BrandLogo
          background="dark"
          withDescriptor
          className="estimator-office-brand-picture"
          imageClassName="estimator-office-brand-logo"
          alt="Polska Flora"
        />
      </div>

      <div className="estimator-office-queue-content">
        <div className="estimator-office-section-heading">
          <span>Do wyceny</span>
          <span className="estimator-office-count" aria-label={`${items.length} zapytań`}>{items.length}</span>
        </div>
        <div className="estimator-office-queue-list">
          {items.map((item) => {
            const priority = priorityMeta(item);
            const active = String(activeId) === String(item.id);
            return (
              <button
                className={`estimator-office-queue-item${active ? ' is-active' : ''}`}
                key={item.id}
                type="button"
                onClick={() => onPick(item)}
                onDoubleClick={() => onOpen(item)}
                aria-current={active ? 'true' : undefined}
              >
                <span className="estimator-office-queue-title-row">
                  <strong>{clientName(item)}</strong>
                  <span className={`estimator-office-priority ${priority.className}`}>{priority.label}</span>
                </span>
                <span className="estimator-office-queue-service">{serviceName(item)}</span>
                <span className="estimator-office-queue-meta">
                  <span>{channelLabel(item)}</span><span aria-hidden="true">·</span><span>{queueTime(item)}</span>
                </span>
              </button>
            );
          })}
          {!items.length ? (
            <div className="estimator-office-queue-empty">Brak otwartych zapytań w Twojej kolejce.</div>
          ) : null}
        </div>
      </div>

      <button className="estimator-office-user" type="button" onClick={onProfile}>
        <span className="estimator-office-avatar">{initials(user)}</span>
        <span className="estimator-office-user-copy">
          <strong>{[user?.imie, user?.nazwisko].map(normalize).filter(Boolean).join(' ') || user?.login || 'Specjalista'}</strong>
          <small>Specjalista ds. wycen</small>
        </span>
      </button>
    </aside>
  );
}

function QuoteEditor({ active, draft, onDraftChange, onSend }) {
  const lines = draft.lines;
  const net = lines.reduce((sum, line) => sum + numeric(line.qty) * numeric(line.price), 0);
  const discount = draft.discount ? net * 0.1 : 0;
  const afterDiscount = net - discount;
  const vat = afterDiscount * 0.23;
  const gross = afterDiscount + vat;
  const phone = telHref(active?.klient_telefon || active?.telefon);

  const updateLine = (id, key, value) => {
    onDraftChange((current) => ({
      ...current,
      lines: current.lines.map((line) => line.id === id
        ? { ...line, [key]: key === 'name' || key === 'unit' ? value : numeric(value) }
        : line),
    }));
  };

  const removeLine = (id) => {
    onDraftChange((current) => ({ ...current, lines: current.lines.filter((line) => line.id !== id) }));
  };

  const addLine = (preset) => {
    onDraftChange((current) => ({
      ...current,
      lines: current.lines.concat({
        id: `${active.id}-${current.nextId}`,
        name: preset?.name || 'Nowa pozycja',
        qty: preset?.qty ?? 1,
        price: preset?.price ?? 0,
        unit: preset?.unit || 'szt',
      }),
      nextId: current.nextId + 1,
    }));
  };

  return (
    <main className="pf-estimator-canvas">
      <header className="estimator-office-header">
        <div>
          <div className="estimator-office-eyebrow">Wycena · {quoteNumber(active)}</div>
          <h1>{clientName(active)}</h1>
          <p>{serviceName(active)} · {addressLabel(active)}</p>
        </div>
        {phone ? (
          <a className="estimator-office-call" href={phone}><Phone aria-hidden="true" size={15} />Zadzwoń</a>
        ) : (
          <button className="estimator-office-call" type="button" disabled title="Brak numeru telefonu">
            <Phone aria-hidden="true" size={15} />Brak telefonu
          </button>
        )}
      </header>

      <section className="estimator-office-editor" aria-label="Pozycje kosztorysu">
        <div className="estimator-office-editor-head" aria-hidden="true">
          <span>Pozycja</span><span>Ilość</span><span>Cena</span><span>Jedn.</span><span>Wartość</span><span />
        </div>
        <div className="estimator-office-editor-lines">
          {lines.map((line, index) => (
            <div className="estimator-office-editor-row" key={line.id}>
              <label>
                <span className="estimator-office-sr-only">Pozycja {index + 1}</span>
                <input value={line.name} onChange={(event) => updateLine(line.id, 'name', event.target.value)} />
              </label>
              <label>
                <span className="estimator-office-sr-only">Ilość</span>
                <input inputMode="decimal" value={line.qty} onChange={(event) => updateLine(line.id, 'qty', event.target.value)} />
              </label>
              <label>
                <span className="estimator-office-sr-only">Cena</span>
                <input inputMode="decimal" value={line.price} onChange={(event) => updateLine(line.id, 'price', event.target.value)} />
              </label>
              <label>
                <span className="estimator-office-sr-only">Jednostka</span>
                <select value={line.unit} onChange={(event) => updateLine(line.id, 'unit', event.target.value)}>
                  <option value="szt">szt</option>
                  <option value="m²">m²</option>
                  <option value="m³">m³</option>
                  <option value="rbg">rbg</option>
                  <option value="usł">usługa</option>
                </select>
              </label>
              <strong className="estimator-office-line-total">{money(numeric(line.qty) * numeric(line.price))}</strong>
              <button className="estimator-office-remove" type="button" onClick={() => removeLine(line.id)} aria-label={`Usuń pozycję ${line.name}`}>
                <Trash2 aria-hidden="true" size={15} />
              </button>
            </div>
          ))}
        </div>
        <div className="estimator-office-presets">
          <button className="estimator-office-add" type="button" onClick={() => addLine()}>
            <Plus aria-hidden="true" size={15} />Dodaj pozycję
          </button>
          {PRESET_LINES.map((preset) => (
            <button className="estimator-office-preset" type="button" key={preset.label} onClick={() => addLine(preset)}>
              + {preset.label}
            </button>
          ))}
        </div>
      </section>

      <div className="estimator-office-summary-grid">
        <section className="estimator-office-note">
          <h2>Notatka do wyceny</h2>
          <textarea
            value={draft.note}
            onChange={(event) => onDraftChange((current) => ({ ...current, note: event.target.value }))}
            placeholder="Warunki, dojazd, uwagi techniczne…"
          />
        </section>
        <section className="estimator-office-totals" aria-label="Podsumowanie wyceny">
          <div><span>Wartość netto</span><strong>{money(net)}</strong></div>
          <div><span>Rabat {draft.discount ? '10' : '0'}%</span><span>−{money(discount)}</span></div>
          <div className="estimator-office-vat"><span>VAT 23%</span><span>{money(vat)}</span></div>
          <div className="estimator-office-grand-total"><strong>Do zapłaty</strong><strong>{money(gross)}</strong></div>
          <div className="estimator-office-total-actions">
            <button type="button" onClick={() => onDraftChange((current) => ({ ...current, discount: !current.discount }))}>
              {draft.discount ? 'Usuń rabat 10%' : 'Dodaj rabat 10%'}
            </button>
            <button className="is-primary" type="button" onClick={onSend}>Wyślij wycenę</button>
          </div>
        </section>
      </div>
    </main>
  );
}

function DaySidebar({ items, onNavigate }) {
  const completed = items.filter(isClosed);
  const accepted = items.filter((item) => /zaakcept/i.test(normalize(item.wycena_status)));
  const open = items.filter((item) => !isClosed(item));
  const totalValue = items.reduce((sum, item) => sum + numeric(item.wartosc_szacowana), 0);
  const sent = completed.filter((item) => item.wycena_id || item.wycena_status).slice(0, 4);
  const stats = [
    { label: 'wysłanych', value: completed.length, className: 'is-sent', route: '/wyceny-terenowe' },
    { label: 'zaakcept.', value: accepted.length, className: 'is-won', route: '/zatwierdz-wyceny' },
    { label: 'w kolejce', value: open.length, className: 'is-pending', route: '/ogledziny' },
    { label: 'wartość', value: compactValue(totalValue), className: 'is-value', route: '/wynagrodzenie-wyceniajacych' },
  ];

  return (
    <aside className="estimator-office-day" aria-label="Mój dzień i wysłane wyceny">
      <section>
        <h2>Mój dzień</h2>
        <div className="estimator-office-stats">
          {stats.map((stat) => (
            <button className={stat.className} type="button" key={stat.label} onClick={() => onNavigate(stat.route)}>
              <strong>{stat.value}</strong><span>{stat.label}</span>
            </button>
          ))}
        </div>
      </section>
      <section className="estimator-office-sent">
        <h2>Wysłane wyceny</h2>
        <div className="estimator-office-sent-list">
          {sent.map((item) => {
            const status = normalize(item.wycena_status) || 'Wysłana';
            const tone = /zaakcept/i.test(status) ? 'is-accepted' : /odrzu/i.test(status) ? 'is-rejected' : /negoc/i.test(status) ? 'is-negotiation' : 'is-sent';
            const route = item.wycena_id ? `/wyceny-terenowe/${item.wycena_id}` : '/wyceny-terenowe';
            return (
              <button className="estimator-office-sent-item" type="button" key={item.id} onClick={() => onNavigate(route)}>
                <span className="estimator-office-sent-top"><strong>{clientName(item)}</strong><span className={tone}>{status}</span></span>
                <span className="estimator-office-sent-bottom"><span>{quoteNumber(item)} · {queueTime(item)}</span><strong>{money(item.wartosc_szacowana)}</strong></span>
              </button>
            );
          })}
          {!sent.length ? <p className="estimator-office-sent-empty">Brak wysłanych wycen w bieżącej kolejce.</p> : null}
        </div>
      </section>
    </aside>
  );
}

export default function WyceniajacyHub() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [sessionUser, setSessionUser] = useState(null);
  const [runtimeError, setRuntimeError] = useState('');
  const [activeId, setActiveId] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [toast, setToast] = useState('');
  const toastTimer = useRef(null);

  const load = useCallback(async () => {
    setRuntimeError('');
    setLoading(true);
    try {
      const token = getStoredToken();
      if (!token) {
        navigate('/');
        return;
      }
      const user = readStoredUser();
      setSessionUser(user);
      const response = await api.get('/ogledziny', { headers: authHeaders(token) });
      const raw = response.data;
      const source = Array.isArray(raw) ? raw : (raw?.items ?? []);
      setItems(hubFilterItems(source, user));
    } catch (error) {
      setItems([]);
      setRuntimeError(getApiErrorMessage(error, t('hub.loadError')));
    } finally {
      setLoading(false);
    }
  }, [navigate, t]);

  useEffect(() => {
    if (!getStoredToken()) navigate('/');
    else void load();
  }, [navigate, load]);

  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const queueItems = useMemo(() => items.filter((item) => !isClosed(item)), [items]);
  const active = useMemo(
    () => queueItems.find((item) => String(item.id) === String(activeId)) || queueItems[0] || null,
    [activeId, queueItems],
  );

  useEffect(() => {
    if (active && String(active.id) !== String(activeId)) setActiveId(active.id);
    if (!active && activeId != null) setActiveId(null);
  }, [active, activeId]);

  const activeKey = active ? String(active.id) : '';
  const activeDraft = active ? (drafts[activeKey] || buildDraft(active)) : null;

  const flash = useCallback((message) => {
    clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = setTimeout(() => setToast(''), 2400);
  }, []);

  const updateDraft = useCallback((updater) => {
    if (!active) return;
    const key = String(active.id);
    setDrafts((current) => {
      const previous = current[key] || buildDraft(active);
      return { ...current, [key]: updater(previous) };
    });
  }, [active]);

  const selectItem = useCallback((item) => {
    setActiveId(item.id);
    flash(`Wczytano zapytanie: ${clientName(item)}`);
  }, [flash]);

  const openInspection = useCallback((item) => {
    navigate(`/ogledziny?inspection=${encodeURIComponent(item.id)}`);
  }, [navigate]);

  const sendQuote = useCallback(() => {
    if (!active) return;
    if (active.wycena_id) navigate(`/wyceny-terenowe/${active.wycena_id}`);
    else navigate(`/wyceny-terenowe?id=${encodeURIComponent(active.id)}`);
  }, [active, navigate]);

  return (
    <div className="pf-estimator-workbench">
      <QueueSidebar
        activeId={active?.id}
        items={queueItems}
        onPick={selectItem}
        onOpen={openInspection}
        onProfile={() => navigate('/profil')}
        user={sessionUser}
      />

      {loading ? (
        <main className="pf-estimator-canvas estimator-office-state" aria-live="polite">
          <div className="estimator-office-spinner" aria-hidden="true" />
          <h1>Ładowanie gabinetu wycen…</h1>
        </main>
      ) : active && activeDraft ? (
        <QuoteEditor active={active} draft={activeDraft} onDraftChange={updateDraft} onSend={sendQuote} />
      ) : (
        <main className="pf-estimator-canvas estimator-office-state">
          <h1>{runtimeError ? 'Nie udało się pobrać kolejki' : 'Kolejka jest pusta'}</h1>
          <p>{runtimeError || 'Nie masz teraz otwartych oględzin wymagających przygotowania wyceny.'}</p>
          <button type="button" onClick={runtimeError ? load : () => navigate('/ogledziny')}>
            {runtimeError ? 'Spróbuj ponownie' : 'Otwórz oględziny'}
          </button>
        </main>
      )}

      <DaySidebar items={items} onNavigate={navigate} />

      <div className={`estimator-office-toast${toast ? ' is-visible' : ''}`} role="status" aria-live="polite">
        <span><Check aria-hidden="true" size={13} /></span>{toast}
      </div>
    </div>
  );
}
