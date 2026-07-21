import { useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Camera, Video } from 'lucide-react';
import CommandSidebar from '../components/CommandSidebar';
import { Button } from '../components/ui/Button';
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
    main: { flex: 1, padding: '24px 28px 40px', maxWidth: 1080 },
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
      borderRadius: 8,
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
      borderRadius: 8,
      border: 'none',
      background: 'var(--accent)',
      color: '#fff',
      fontWeight: 600,
      fontSize: 14,
      cursor: 'pointer',
    },
    btnDisabled: { opacity: 0.55, cursor: 'not-allowed' },
    hint: { marginTop: 10, fontSize: 13, color: 'var(--text-muted)' },
    warn: { marginTop: 10, fontSize: 13, color: 'var(--warning, #995510)' },
  };

  if (!ogledzinyId) {
    return (
      <div className="inspection-doc-shell" style={S.wrap}>
        <CommandSidebar active="orders" />
        <main className="command-content-main inspection-doc-main" style={S.main}>
          <Button variant="ghost" size="sm" style={S.back} leftIcon={ArrowLeft} onClick={() => navigate('/ogledziny')}>
            {t('inspectionDoc.back')}
          </Button>
          <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>
            Brak parametru <code style={{ fontSize: 12 }}>ogledzinyId</code>. Otwórz ten widok z listy oględzin.
          </p>
        </main>
      </div>
    );
  }

  return (
    <div className="inspection-doc-shell" style={S.wrap}>
      <CommandSidebar active="orders" />
      <main className="command-content-main inspection-doc-main" style={S.main}>
        <Button variant="ghost" size="sm" style={S.back} leftIcon={ArrowLeft} onClick={() => navigate('/ogledziny')}>
          {t('inspectionDoc.back')}
        </Button>
        <div className="inspection-doc-hero">
          <div>
            <span>Dokumentacja terenowa</span>
            <h1 style={S.title}>{t('inspectionDoc.screenTitle')}</h1>
            <p style={S.sub}>{subtitle}</p>
          </div>
          <div className="inspection-doc-hero-meta">
            <strong>#{ogledzinyId}</strong>
            <small>{wycenaId ? `Wycena #${wycenaId}` : 'Brak wyceny'}</small>
          </div>
        </div>

        <input ref={filePhotoRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onPhoto} />
        <input ref={fileVideoRef} type="file" accept="video/*" style={{ display: 'none' }} onChange={onVideo} />

        <section className="inspection-doc-command-strip" aria-label="Stan dokumentacji">
          <div className="inspection-doc-command-lead">
            <span>Inspekcja</span>
            <strong>{klient.trim() || 'Klient'}</strong>
            <small>foto, szkic i wideo z terenu</small>
          </div>
          <div className={`inspection-doc-command-card ${wycenaId ? 'is-good' : 'is-warning'}`}>
            <span>Rysunek</span>
            <strong>{wycenaId ? 'Gotowy' : 'Blokada'}</strong>
            <small>{wycenaId ? `wycena #${wycenaId}` : 'brak wyceny do szkicu'}</small>
          </div>
          <div className={`inspection-doc-command-card ${ogledzinyId ? 'is-good' : 'is-danger'}`}>
            <span>Wideo</span>
            <strong>{ogledzinyId ? 'Upload' : 'Brak ID'}</strong>
            <small>material do historii oględzin</small>
          </div>
        </section>

        <div className="inspection-doc-grid">
          <div className="inspection-doc-card" style={S.card}>
            <div className="inspection-doc-card-icon"><Camera size={22} /></div>
            <h2 style={S.cardTitle}>{t('inspectionDoc.photoCardTitle')}</h2>
            <p style={S.cardBody}>{t('inspectionDoc.photoCardBody')}</p>
            <Button style={S.btn} leftIcon={Camera} onClick={pickPhoto}>
              {t('inspectionDoc.photoBtn')}
            </Button>
            {!wycenaId ? <p style={S.warn}>{t('inspectionDoc.noQuoteInline')}</p> : null}
          </div>

          <div className="inspection-doc-card" style={S.card}>
            <div className="inspection-doc-card-icon is-blue"><Video size={22} /></div>
            <h2 style={S.cardTitle}>{t('inspectionDoc.videoCardTitle')}</h2>
            <p style={S.cardBody}>{t('inspectionDoc.videoCardBody')}</p>
            <p style={{ ...S.cardBody, marginBottom: 8 }}>{t('inspectionDoc.videoOfflineHint')}</p>
            <Button
              style={{ ...S.btn, ...(busy ? S.btnDisabled : {}) }}
              onClick={pickVideo}
              loading={busy}
              leftIcon={Video}
            >
              {t('inspectionDoc.videoBtn')}
            </Button>
            {hint ? <p style={S.hint}>{hint}</p> : null}
          </div>
        </div>
      </main>
    </div>
  );
}
