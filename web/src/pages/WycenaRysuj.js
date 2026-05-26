import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../api';
import Sidebar from '../components/Sidebar';
import StatusMessage from '../components/StatusMessage';
import { getApiErrorMessage } from '../utils/apiError';
import { getStoredToken, authHeaders } from '../utils/storedToken';
import { errorMessage, successMessage, warningMessage } from '../utils/statusMessage';

const COLORS = ['#E53935', '#FB8C00', '#FDD835', '#43A047', '#1E88E5', '#8E24AA', '#FFFFFF', '#000000'];

function dataUrlToBlob(dataUrl) {
  const [head, b64] = dataUrl.split(',');
  const mime = head.match(/data:([^;]+)/)?.[1] || 'image/jpeg';
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

export default function WycenaRysuj() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const canvasRef = useRef(null);
  const baseImgRef = useRef(null);
  const drawing = useRef(false);
  const fileRef = useRef(null);

  const uriParam = searchParams.get('uri') || '';
  const wycenaId = searchParams.get('wycenaId') || '';
  const quotationId = searchParams.get('quotationId') || '';
  const itemId = searchParams.get('itemId') || '';
  const taskId = searchParams.get('taskId') || '';
  const photoKind = searchParams.get('photoKind') || '';

  const decodedUri = uriParam ? decodeURIComponent(uriParam) : '';

  const [color, setColor] = useState('#E53935');
  const [lineWidth, setLineWidth] = useState(5);
  const [ready, setReady] = useState(false);
  const [eraser, setEraser] = useState(false);
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);
  const [loadErr, setLoadErr] = useState(false);

  const paint = useCallback(
    (x, y, move) => {
      const c = canvasRef.current;
      if (!c) return;
      const ctx = c.getContext('2d');
      ctx.globalCompositeOperation = eraser ? 'destination-out' : 'source-over';
      ctx.strokeStyle = eraser ? 'rgba(0,0,0,1)' : color;
      ctx.lineWidth = eraser ? lineWidth * 2 : lineWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (!move) {
        ctx.beginPath();
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x, y);
      }
    },
    [color, lineWidth, eraser],
  );

  const drawImageOnCanvas = useCallback((img) => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    const maxW = 1200;
    const scale = Math.min(1, maxW / img.width);
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    baseImgRef.current = img;
    setReady(true);
    setLoadErr(false);
  }, []);

  useEffect(() => {
    if (!decodedUri) {
      setReady(false);
      return;
    }
    setReady(false);
    setLoadErr(false);
    const img = new Image();
    if (decodedUri.startsWith('http://') || decodedUri.startsWith('https://')) {
      img.crossOrigin = 'anonymous';
    }
    img.onload = () => drawImageOnCanvas(img);
    img.onerror = () => setLoadErr(true);
    img.src = decodedUri;
  }, [decodedUri, drawImageOnCanvas]);

  const loadLocalFile = (file) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      drawImageOnCanvas(img);
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      setLoadErr(true);
    };
    img.src = url;
  };

  const pos = (e) => {
    const c = canvasRef.current;
    if (!c) return { x: 0, y: 0 };
    const r = c.getBoundingClientRect();
    const ev = e.touches ? e.touches[0] : e;
    const x = ((ev.clientX - r.left) / r.width) * c.width;
    const y = ((ev.clientY - r.top) / r.height) * c.height;
    return { x, y };
  };

  const start = (e) => {
    if (!ready) return;
    e.preventDefault();
    drawing.current = true;
    const { x, y } = pos(e);
    paint(x, y, false);
  };

  const move = (e) => {
    if (!drawing.current || !ready) return;
    e.preventDefault();
    const { x, y } = pos(e);
    paint(x, y, true);
  };

  const end = (e) => {
    e.preventDefault();
    drawing.current = false;
  };

  const clearDrawing = () => {
    const c = canvasRef.current;
    const img = baseImgRef.current;
    if (!c || !img || !ready) return;
    const ctx = c.getContext('2d');
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
  };

  const save = async () => {
    const c = canvasRef.current;
    if (!c || !ready) return;
    setSaving(true);
    setMsg('');
    try {
      const token = getStoredToken();
      if (!token) {
        navigate('/');
        return;
      }
      let blob;
      try {
        blob = await new Promise((resolve, reject) => {
          c.toBlob((b) => (b ? resolve(b) : reject(new Error('blob'))), 'image/jpeg', 0.88);
        });
      } catch {
        blob = dataUrlToBlob(c.toDataURL('image/jpeg', 0.88));
      }

      const qTeren = quotationId && itemId;
      if (qTeren) {
        const fd = new FormData();
        fd.append('zdjecie', blob, `rysunek_${Date.now()}.jpg`);
        fd.append('photo_kind', photoKind === 'general' ? 'general' : 'annotated');
        await api.post(`/quotations/${quotationId}/items/${itemId}/zdjecia`, fd, {
          headers: authHeaders(token),
        });
      } else if (taskId) {
        const fd = new FormData();
        fd.append('zdjecie', blob, `rysunek_${Date.now()}.jpg`);
        fd.append('typ', photoKind || 'Szkic');
        fd.append('opis', 'Szkic z oględzin terenowych z adnotacjami.');
        fd.append('tagi', 'wycena, szkic, adnotacje');
        await api.post(`/tasks/${taskId}/zdjecia`, fd, { headers: authHeaders(token) });
      } else if (wycenaId) {
        const fd = new FormData();
        fd.append('zdjecie', blob, `rysunek_${Date.now()}.jpg`);
        await api.post(`/wyceny/${wycenaId}/zdjecia`, fd, { headers: authHeaders(token) });
      } else {
        setMsg(warningMessage(t('draw.alert.localBody')));
        setSaving(false);
        return;
      }
      setMsg(successMessage(t('draw.alert.addedBody')));
      setTimeout(() => navigate(-1), 600);
    } catch (e) {
      setMsg(errorMessage(getApiErrorMessage(e, t('draw.alert.serverFail'))));
    } finally {
      setSaving(false);
    }
  };

  const hasTarget = Boolean(taskId || wycenaId || (quotationId && itemId));

  return (
    <div className="app-shell">
      <Sidebar />
      <main className="app-main" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '12px 16px',
            borderBottom: '1px solid var(--border)',
            flexWrap: 'wrap',
          }}
        >
          <button
            type="button"
            onClick={() => navigate(-1)}
            style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              border: '1px solid var(--border)',
              background: 'var(--surface-field)',
              cursor: 'pointer',
            }}
          >
            ←
          </button>
          <div style={{ fontWeight: 800, fontSize: 17 }}>{t('draw.pageTitle')}</div>
          {!decodedUri && (
            <label style={{ marginLeft: 'auto', fontSize: 13, cursor: 'pointer' }}>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={(e) => loadLocalFile(e.target.files?.[0])}
              />
              <span style={{ textDecoration: 'underline', color: 'var(--accent)' }}>{t('draw.pickImage')}</span>
            </label>
          )}
        </div>
        <StatusMessage message={msg} style={{ margin: '8px 16px 0' }} />

        <div style={{ padding: 16, maxWidth: 900, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
          {!hasTarget && (
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>{t('draw.noTargetHint')}</p>
          )}
          {loadErr && (
            <p style={{ color: '#F87171', marginBottom: 12 }}>{t('draw.loadError')}</p>
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12, alignItems: 'center' }}>
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => {
                  setEraser(false);
                  setColor(c);
                }}
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  background: c,
                  border: color === c && !eraser ? '2px solid var(--accent)' : '1px solid var(--border)',
                  cursor: 'pointer',
                }}
                title={c}
              />
            ))}
            <select
              value={lineWidth}
              onChange={(e) => setLineWidth(Number(e.target.value))}
              style={{ padding: '6px 8px', borderRadius: 8, border: '1px solid var(--border)' }}
            >
              {[3, 5, 8, 12, 18].map((w) => (
                <option key={w} value={w}>
                  {w}px
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setEraser((e) => !e)}
              style={{
                padding: '6px 12px',
                borderRadius: 8,
                border: '1px solid var(--border)',
                background: eraser ? 'var(--accent)' : 'var(--surface-field)',
                color: eraser ? 'var(--on-accent)' : 'var(--text)',
                cursor: 'pointer',
              }}
            >
              {t('draw.eraser')}
            </button>
            <button
              type="button"
              onClick={clearDrawing}
              style={{
                padding: '6px 12px',
                borderRadius: 8,
                border: '1px solid var(--border)',
                background: 'var(--surface-field)',
                cursor: 'pointer',
              }}
            >
              {t('draw.btn.clear')}
            </button>
            <button
              type="button"
              disabled={!ready || saving || !hasTarget}
              onClick={save}
              style={{
                padding: '8px 16px',
                borderRadius: 10,
                border: '1px solid var(--border)',
                background: 'var(--accent)',
                color: 'var(--on-accent)',
                fontWeight: 700,
                cursor: ready && hasTarget ? 'pointer' : 'not-allowed',
                opacity: ready && hasTarget ? 1 : 0.5,
              }}
            >
              {saving ? t('common.saving') : t('draw.btn.save')}
            </button>
          </div>

          <div style={{ overflow: 'auto', border: '1px solid var(--border)', borderRadius: 12, background: '#111' }}>
            <canvas
              ref={canvasRef}
              style={{ display: 'block', width: '100%', height: 'auto', maxHeight: '70vh', touchAction: 'none' }}
              onMouseDown={start}
              onMouseMove={move}
              onMouseUp={end}
              onMouseLeave={end}
              onTouchStart={start}
              onTouchMove={move}
              onTouchEnd={end}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
