import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../api';
import PageHeader from '../components/PageHeader';
import Sidebar from '../components/Sidebar';
import { getApiErrorMessage } from '../utils/apiError';
import { getStoredToken, authHeaders } from '../utils/storedToken';
import { readStoredUser } from '../utils/readStoredUser';

const OFFER_STATUS_PL = {
  sent: 'Wysłano',
  failed: 'Błąd',
  skipped_no_phone: 'Pominięto — brak telefonu',
  skipped_no_twilio: 'Pominięto — brak Twilio',
  skipped_no_email: 'Pominięto — brak e-mail',
  skipped_no_smtp: 'Pominięto — brak SMTP',
};

function offerStatusLabel(code) {
  const k = String(code || '').trim();
  return OFFER_STATUS_PL[k] || k || '—';
}

function fmtPlDateTime(iso) {
  if (!iso) return '—';
  try {
    return new Date(String(iso)).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return '—';
  }
}

/** Bazowy URL hosta OS (PDF, publiczny link akceptacji) — z Vite `VITE_API_URL=/api` → origin proxowany. */
function osOrigin() {
  const raw = String(process.env.REACT_APP_API_URL || '').trim();
  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    try {
      const u = new URL(raw.replace(/\/api\/?$/i, ''));
      return u.origin;
    } catch {
      /* ignore */
    }
  }
  return typeof window !== 'undefined' ? window.location.origin : '';
}

function quotationItemLabel(it) {
  const parts = [it?.gatunek, it?.wysokosc_pas, it?.typ_pracy].filter(Boolean);
  return parts.length ? `#${it.id} — ${parts.join(' · ')}` : `#${it?.id}`;
}

function absoluteFileUrl(pathMaybe) {
  if (!pathMaybe) return '';
  const p = String(pathMaybe);
  if (p.startsWith('http://') || p.startsWith('https://')) return p;
  const base = osOrigin().replace(/\/+$/, '');
  if (!base) return p;
  return `${base}${p.startsWith('/') ? '' : '/'}${p}`;
}

const S = {
  wrap: { display: 'flex', minHeight: '100vh', background: 'var(--bg)' },
  main: { flex: 1, padding: '20px 24px 40px', maxWidth: 720 },
  back: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
    padding: '6px 0',
    border: 'none',
    background: 'none',
    color: 'var(--accent)',
    cursor: 'pointer',
    fontSize: 14,
  },
  card: {
    background: 'var(--card)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  title: { fontWeight: 700, fontSize: 18, marginBottom: 4 },
  muted: { color: 'var(--text-muted)', fontSize: 14, lineHeight: 1.5 },
  h2: { fontWeight: 600, fontSize: 15, marginBottom: 10 },
  err: { color: 'var(--danger)', fontSize: 13, marginTop: 6, wordBreak: 'break-word' },
  badge: {
    display: 'inline-block',
    padding: '4px 10px',
    borderRadius: 8,
    fontSize: 12,
    fontWeight: 600,
    background: 'var(--accent-soft)',
    color: 'var(--text)',
    marginBottom: 12,
  },
  link: { color: 'var(--accent)', wordBreak: 'break-all' },
};

function canResendClientOfferUi(user) {
  const r = user?.rola;
  return r === 'Kierownik' || r === 'Dyrektor' || r === 'Administrator';
}

export default function WycenaTerenowaDetail() {
  const { t } = useTranslation();
  const { id: idParam } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const sketchSectionRef = useRef(null);
  const sketchScrollKeyDone = useRef('');
  const user = useMemo(() => readStoredUser(), []);
  const id = Number(idParam);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [q, setQ] = useState(null);
  const [items, setItems] = useState([]);
  const [itemsErr, setItemsErr] = useState('');
  const [resendBusy, setResendBusy] = useState(false);
  const [resendMsg, setResendMsg] = useState('');

  const load = useCallback(async () => {
    if (!Number.isFinite(id) || id <= 0) {
      setErr('Nieprawidłowe ID wyceny.');
      setLoading(false);
      return;
    }
    setErr('');
    setLoading(true);
    try {
      const token = getStoredToken();
      if (!token) {
        navigate('/');
        return;
      }
      const h = authHeaders(token);
      const [qRes, itemsRes] = await Promise.all([
        api.get(`/quotations/${id}`, { headers: h }),
        api.get(`/quotations/${id}/items`, { headers: h }).catch(() => ({ data: null })),
      ]);
      setQ(qRes.data);
      setItemsErr('');
      if (itemsRes.data == null) {
        setItems([]);
        setItemsErr(t('fieldQuotesSketch.loadItemsError'));
      } else {
        const arr = itemsRes.data;
        setItems(Array.isArray(arr) ? arr : []);
      }
    } catch (e) {
      setErr(getApiErrorMessage(e));
      setQ(null);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [id, navigate, t]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (searchParams.get('focus') !== 'sketch') {
      sketchScrollKeyDone.current = '';
      return;
    }
    if (loading) return;
    const k = `${id}:sketch`;
    if (sketchScrollKeyDone.current === k) return;
    sketchScrollKeyDone.current = k;
    const idMap = window.requestAnimationFrame(() => {
      sketchSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return () => window.cancelAnimationFrame(idMap);
  }, [loading, searchParams, id]);

  const doResendClientOffer = async () => {
    setResendMsg('');
    setErr('');
    setResendBusy(true);
    try {
      const token = getStoredToken();
      if (!token) {
        navigate('/');
        return;
      }
      const { data } = await api.post(`/quotations/${id}/resend-client-offer`, {}, { headers: authHeaders(token) });
      setQ(data);
      setResendMsg('Wysłano ponownie SMS i e-mail (ten sam link akceptacji).');
    } catch (e) {
      setErr(getApiErrorMessage(e));
    } finally {
      setResendBusy(false);
    }
  };

  const acceptUrl = useMemo(() => {
    if (!q?.client_acceptance_token) return '';
    return `${osOrigin()}/api/public/quotations/${q.client_acceptance_token}`;
  }, [q]);

  const showOfferBlock =
    q &&
    (q.wyslano_klientowi_at ||
      q.offer_sms_status != null ||
      q.offer_email_status != null ||
      q.pdf_url);

  const showResend =
    q &&
    canResendClientOfferUi(user) &&
    q.status === 'Wyslana_Klientowi' &&
    Boolean(q.client_acceptance_token);

  return (
    <div className="field-quote-detail-shell" style={S.wrap}>
      <Sidebar />
      <main className="field-quote-detail-main" style={S.main}>
        <button type="button" style={S.back} onClick={() => navigate(-1)}>
          ← Wróć
        </button>
        <PageHeader title="Wycena terenowa" subtitle="Status oferty i wysyłki do klienta (M1 / F1.11)" />

        {loading ? (
          <p style={S.muted}>Ładowanie…</p>
        ) : err ? (
          <div style={S.err}>{err}</div>
        ) : !q ? (
          <p style={S.muted}>Brak danych.</p>
        ) : (
          <>
            <div className="field-quote-detail-card field-quote-detail-summary" style={S.card}>
              <div style={S.badge}>#{q.id}</div>
              <div style={S.title}>{q.klient_nazwa || '—'}</div>
              <div style={S.muted}>{[q.adres, q.miasto].filter(Boolean).join(', ') || '—'}</div>
              <div style={{ ...S.muted, marginTop: 8 }}>
                Status: <strong>{q.status}</strong>
                {q.priorytet ? (
                  <>
                    {' '}
                    · Priorytet: <strong>{q.priorytet}</strong>
                  </>
                ) : null}
              </div>
              <div style={{ marginTop: 12, fontSize: 13 }}>
                <Link to="/wyceny-terenowe" style={S.link}>
                  ← Lista przypisań i zatwierdzeń
                </Link>
              </div>
            </div>

            <div ref={sketchSectionRef} className="field-quote-detail-card field-quote-detail-sketch" style={S.card}>
              <div style={S.h2}>{t('fieldQuotesSketch.sectionTitle')}</div>
              <div style={{ ...S.muted, marginBottom: 10 }}>{t('fieldQuotesSketch.hint')}</div>
              {itemsErr ? <div style={S.err}>{itemsErr}</div> : null}
              {!itemsErr && items.length === 0 ? (
                <div style={S.muted}>{t('fieldQuotesSketch.noItems')}</div>
              ) : (
                items.map((it, idx) => (
                  <div
                    key={it.id}
                    style={
                      idx > 0
                        ? { marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }
                        : { marginTop: 4 }
                    }
                  >
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{quotationItemLabel(it)}</div>
                    <Link
                      to={`/wycena-rysuj?quotationId=${id}&itemId=${it.id}&photoKind=annotated`}
                      style={{ ...S.link, display: 'inline-block', marginTop: 8, fontWeight: 600 }}
                    >
                      {t('fieldQuotesSketch.openDraw')} →
                    </Link>
                  </div>
                ))
              )}
            </div>

            {showOfferBlock ? (
              <div className="field-quote-detail-card field-quote-detail-offer" style={S.card}>
                <div style={S.h2}>Wysyłka oferty do klienta</div>
                {showResend ? (
                  <div style={{ marginBottom: 14 }}>
                    <button
                      type="button"
                      disabled={resendBusy}
                      onClick={() => void doResendClientOffer()}
                      style={{
                        padding: '10px 14px',
                        borderRadius: 8,
                        border: 'none',
                        background: 'var(--accent)',
                        color: '#fff',
                        cursor: resendBusy ? 'wait' : 'pointer',
                        fontWeight: 600,
                        opacity: resendBusy ? 0.75 : 1,
                      }}
                    >
                      {resendBusy ? 'Wysyłanie…' : 'Ponów SMS i e-mail'}
                    </button>
                    <div style={{ ...S.muted, marginTop: 8, fontSize: 12 }}>
                      Ten sam link akceptacji co wcześniej. Użyj po błędzie Twilio/SMTP lub gdy klient nie dostał wiadomości.
                    </div>
                    {resendMsg ? (
                      <div style={{ marginTop: 8, fontSize: 13, color: 'var(--accent)' }}>{resendMsg}</div>
                    ) : null}
                  </div>
                ) : null}
                {q.wyslano_klientowi_at ? (
                  <div style={S.muted}>Zapis statusu (wysłano do klienta): {fmtPlDateTime(q.wyslano_klientowi_at)}</div>
                ) : null}
                {q.pdf_url ? (
                  <div style={{ marginTop: 10 }}>
                    <span style={S.muted}>PDF: </span>
                    <a href={absoluteFileUrl(q.pdf_url)} target="_blank" rel="noopener noreferrer" style={S.link}>
                      Otwórz PDF oferty
                    </a>
                  </div>
                ) : (
                  <div style={S.muted}>PDF: jeszcze nie wygenerowano</div>
                )}
                <div style={{ ...S.muted, marginTop: 10 }}>
                  SMS: {offerStatusLabel(q.offer_sms_status)}
                  {q.offer_sms_at ? ` · ${fmtPlDateTime(q.offer_sms_at)}` : ''}
                </div>
                {q.offer_sms_error ? <div style={S.err}>{String(q.offer_sms_error).slice(0, 400)}</div> : null}
                <div style={{ ...S.muted, marginTop: 10 }}>
                  E-mail: {offerStatusLabel(q.offer_email_status)}
                  {q.offer_email_at ? ` · ${fmtPlDateTime(q.offer_email_at)}` : ''}
                </div>
                {q.offer_email_error ? <div style={S.err}>{String(q.offer_email_error).slice(0, 400)}</div> : null}
                {acceptUrl ? (
                  <div style={{ marginTop: 14 }}>
                    <div style={S.muted}>Publiczny link akceptacji (dla klienta):</div>
                    <div
                      style={{
                        marginTop: 6,
                        padding: 10,
                        borderRadius: 8,
                        background: 'var(--bg)',
                        border: '1px solid var(--border)',
                        fontSize: 12,
                        wordBreak: 'break-all',
                      }}
                    >
                      {acceptUrl}
                    </div>
                    <button
                      type="button"
                      style={{
                        marginTop: 8,
                        padding: '8px 12px',
                        borderRadius: 8,
                        border: '1px solid var(--border)',
                        background: 'var(--card)',
                        cursor: 'pointer',
                        color: 'var(--text)',
                      }}
                      onClick={() => {
                        navigator.clipboard.writeText(acceptUrl).catch(() => {});
                      }}
                    >
                      Kopiuj link
                    </button>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="field-quote-detail-card field-quote-detail-empty" style={{ ...S.card, ...S.muted }}>
                Oferta nie została jeszcze wysłana do klienta (brak rekordu wysyłki). Po pełnym zatwierdzeniu pojawią się tu
                PDF, SMS/e-mail i link akceptacji.
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
