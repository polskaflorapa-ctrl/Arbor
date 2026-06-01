import { useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Sidebar from '../components/Sidebar';
import api from '../api';
import { getApiErrorMessage } from '../utils/apiError';

export default function OgledzinyDokumentacja() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const filePhotoRef = useRef(null);
  const fileVideoRef = useRef(null);

  const ogledzinyId = searchParams.get('ogledzinyId') || '';
  const wycenaId = searchParams.get('wycenaId') || '';
  const klient = searchParams.get('klient') || '';

  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState('');

  const pickPhoto = () => filePhotoRef.current?.click();

  const onPhoto = (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!wycenaId) {
      setHint(t('inspectionDoc.noQuoteBody'));
      return;
    }
    const r = new FileReader();
    r.onload = () => {
      navigate(
        `/wycena-rysuj?uri=${encodeURIComponent(String(r.result))}&wycenaId=${encodeURIComponent(wycenaId)}`,
      );
    };
    r.readAsDataURL(f);
  };

  const pickVideo = () => fileVideoRef.current?.click();

  const onVideo = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f || !ogledzinyId) return;
    setBusy(true);
    setHint('');
    try {
      const fd = new FormData();
      fd.append('wideo', f, f.name);
      await api.post(`/ogledziny/${ogledzinyId}/media`, fd);
      setHint(t('inspectionDoc.videoSent'));
    } catch (err) {
      setHint(getApiErrorMessage(err, String(err.message || '')));
    } finally {
      setBusy(false);
    }
  };

  const subtitle = klient.trim()
    ? `${t('inspectionDoc.subtitle', { id: ogledzinyId })} · ${klient.trim()}`
    : t('inspectionDoc.subtitle', { id: ogledzinyId });

  const S = {
    wrap: { display: 'flex', minHeight: '100vh', background: 'var(--bg)' },
    main: { flex: 1, padding: '24px 28px 40px', maxWidth: 640 },
    title: { margin: '0 0 8px', fontSize: 22, fontWeight: 800, color: 'var(--text)' },
    sub: { margin: 0, fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.45 },
    back: {
      marginBottom: 16,
      border: 'none',
      background: 'none',
      color: 'var(--accent)',
      cursor: 'pointer',
      fontSize: 14,
      padding: 0,
      textAlign: 'left',
    },
    card: {
      marginTop: 16,
      padding: 18,
      borderRadius: 12,
      border: '1px solid var(--border)',
      background: 'var(--card)',
    },
    cardTitle: { margin: '0 0 8px', fontSize: 15, fontWeight: 700, color: 'var(--text)' },
    cardBody: { margin: '0 0 14px', fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 },
    btn: {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '10px 16px',
      borderRadius: 10,
      border: 'none',
      background: 'var(--accent)',
      color: '#fff',
      fontWeight: 600,
      fontSize: 14,
      cursor: 'pointer',
    },
    btnDisabled: { opacity: 0.55, cursor: 'not-allowed' },
    hint: { marginTop: 10, fontSize: 13, color: 'var(--text-muted)' },
    warn: { marginTop: 10, fontSize: 13, color: 'var(--warning, #b45309)' },
  };

  if (!ogledzinyId) {
    return (
      <div className="inspection-doc-shell" style={S.wrap}>
        <Sidebar />
        <main className="inspection-doc-main" style={S.main}>
          <button type="button" style={S.back} onClick={() => navigate('/ogledziny')}>
            ← {t('inspectionDoc.back')}
          </button>
          <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>
            Brak parametru <code style={{ fontSize: 12 }}>ogledzinyId</code>. Otwórz ten widok z listy oględzin.
          </p>
        </main>
      </div>
    );
  }

  return (
    <div className="inspection-doc-shell" style={S.wrap}>
      <Sidebar />
      <main className="inspection-doc-main" style={S.main}>
        <button type="button" style={S.back} onClick={() => navigate('/ogledziny')}>
          ← {t('inspectionDoc.back')}
        </button>
        <div className="inspection-doc-hero">
          <h1 style={S.title}>{t('inspectionDoc.screenTitle')}</h1>
          <p style={S.sub}>{subtitle}</p>
        </div>

        <input ref={filePhotoRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onPhoto} />
        <input ref={fileVideoRef} type="file" accept="video/*" style={{ display: 'none' }} onChange={onVideo} />

        <div className="inspection-doc-card" style={S.card}>
          <h2 style={S.cardTitle}>{t('inspectionDoc.photoCardTitle')}</h2>
          <p style={S.cardBody}>{t('inspectionDoc.photoCardBody')}</p>
          <button type="button" style={S.btn} onClick={pickPhoto}>
            {t('inspectionDoc.photoBtn')}
          </button>
          {!wycenaId ? <p style={S.warn}>{t('inspectionDoc.noQuoteInline')}</p> : null}
        </div>

        <div className="inspection-doc-card" style={S.card}>
          <h2 style={S.cardTitle}>{t('inspectionDoc.videoCardTitle')}</h2>
          <p style={S.cardBody}>{t('inspectionDoc.videoCardBody')}</p>
          <p style={{ ...S.cardBody, marginBottom: 8 }}>{t('inspectionDoc.videoOfflineHint')}</p>
          <button
            type="button"
            style={{ ...S.btn, ...(busy ? S.btnDisabled : {}) }}
            onClick={pickVideo}
            disabled={busy}
          >
            {busy ? '…' : t('inspectionDoc.videoBtn')}
          </button>
          {hint ? <p style={S.hint}>{hint}</p> : null}
        </div>
      </main>
    </div>
  );
}
