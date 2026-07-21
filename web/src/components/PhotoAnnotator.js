import { useCallback, useEffect, useRef, useState } from 'react';
import { Save, Trash2, X } from 'lucide-react';
import { Button } from './ui/Button';

const COLORS = ['#c0492f', '#bd701e', '#bd701e', '#7f8c12', '#766440', '#766440', '#FFFFFF', '#000000'];

/**
 * Prosty edytor: zdjęcie + rysowanie po canvasie, eksport do JPEG (base64).
 */
export default function PhotoAnnotator({ file, onClose, onSave }) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const [color, setColor] = useState('#c0492f');
  const [lineWidth, setLineWidth] = useState(5);
  const [ready, setReady] = useState(false);

  const paint = useCallback((x, y, move) => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!move) {
      ctx.beginPath();
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x, y);
    }
  }, [color, lineWidth]);

  useEffect(() => {
    if (!file) return;
    setReady(false);
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const c = canvasRef.current;
      if (!c) return;
      const ctx = c.getContext('2d');
      const maxW = 1000;
      const scale = Math.min(1, maxW / img.width);
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      setReady(true);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      setReady(false);
    };
    img.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const pos = (e) => {
    const c = canvasRef.current;
    const r = c.getBoundingClientRect();
    const ev = e.touches ? e.touches[0] : e;
    const x = ((ev.clientX - r.left) / r.width) * c.width;
    const y = ((ev.clientY - r.top) / r.height) * c.height;
    return { x, y };
  };

  const start = (e) => {
    e.preventDefault();
    drawing.current = true;
    const { x, y } = pos(e);
    paint(x, y, false);
  };

  const move = (e) => {
    if (!drawing.current) return;
    e.preventDefault();
    const { x, y } = pos(e);
    paint(x, y, true);
  };

  const end = (e) => {
    e.preventDefault();
    drawing.current = false;
  };

  const clearDrawing = () => {
    if (!file || !ready) return;
    const c = canvasRef.current;
    const ctx = c.getContext('2d');
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  };

  const handleSave = () => {
    const c = canvasRef.current;
    if (!c) return;
    const dataUrl = c.toDataURL('image/jpeg', 0.82);
    const base64 = dataUrl.split(',')[1];
    onSave({ mime: 'image/jpeg', dataBase64: base64, previewUrl: dataUrl });
  };

  if (!file) return null;

  return (
    <div style={overlay} onMouseDown={onClose}>
      <div style={box} onMouseDown={(e) => e.stopPropagation()}>
        <div style={head}>
          <span style={{ fontWeight: 700, color: 'var(--text)' }}>Adnotacje na zdjęciu</span>
          <Button variant="ghost" size="sm" style={btnX} leftIcon={X} onClick={onClose}>Zamknij</Button>
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 10px' }}>
          Wybierz kolor i zaznacz drzewa / krzewy na zdjęciu. Zapis generuje plik do wysłania z wyceną (wymaga obsługi po stronie API).
        </p>
        <div style={toolbar}>
          {COLORS.map((c) => (
            <Button
              key={c}
              variant="secondary"
              size="sm"
              onClick={() => setColor(c)}
              style={{
                width: 28, height: 28, borderRadius: 6, background: c,
                minHeight: 28,
                padding: 0,
                border: color === c ? '2px solid var(--accent)' : '1px solid var(--border)',
                cursor: 'pointer',
              }}
              title={c}
            />
          ))}
          <label style={{ fontSize: 12, color: 'var(--text-sub)', marginLeft: 8 }}>Grubość</label>
          <input type="range" min={2} max={24} value={lineWidth} onChange={(e) => setLineWidth(Number(e.target.value))} />
          <Button variant="secondary" size="sm" style={btnGhost} leftIcon={Trash2} onClick={clearDrawing}>Wyczyść rysunek</Button>
        </div>
        <div style={{ overflow: 'auto', maxHeight: '55vh', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface-field)' }}>
          <canvas
            ref={canvasRef}
            style={{ display: 'block', maxWidth: '100%', touchAction: 'none', cursor: 'crosshair' }}
            onMouseDown={start}
            onMouseMove={move}
            onMouseUp={end}
            onMouseLeave={end}
            onTouchStart={start}
            onTouchMove={move}
            onTouchEnd={end}
          />
        </div>
        <div style={foot}>
          <Button variant="secondary" size="sm" style={btnGhost} onClick={onClose}>Anuluj</Button>
          <Button size="sm" style={btnPrimary} leftIcon={Save} onClick={handleSave} disabled={!ready}>Zapisz obraz</Button>
        </div>
      </div>
    </div>
  );
}

const overlay = {
  position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(6,16,11,0.72)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
};
const box = {
  background: 'var(--surface-glass)', borderRadius: 8, border: '1px solid var(--glass-border)',
  maxWidth: 960, width: '100%', padding: 20, maxHeight: '92vh', overflow: 'auto',
  boxShadow: 'var(--shadow-md)',
};
const head = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 };
const btnX = { background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 14 };
const toolbar = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 12 };
const btnGhost = {
  padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border)',
  background: 'var(--surface-field)', color: 'var(--text)', cursor: 'pointer', fontSize: 13,
};
const btnPrimary = {
  padding: '8px 18px', borderRadius: 8, border: '1px solid rgba(20,131,79,0.22)',
  background: 'var(--accent-gradient)', color: 'var(--on-accent)', fontWeight: 700, cursor: 'pointer', fontSize: 13,
};
const foot = { display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 };
