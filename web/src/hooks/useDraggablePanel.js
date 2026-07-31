import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Przeciaganie plywajacego panelu po CALEJ powierzchni okna.
 *
 * Panele (asystent AI, softphone) byly przypiete na sztywno do rogow i potrafily
 * zaslaniac interfejs — logo, boczny pasek albo siebie nawzajem. Ten hook pozwala
 * chwycic panel i postawic go w dowolnym miejscu; pozycja przezywa przeladowanie.
 *
 * Zwraca:
 *  - `style`      — nadpisanie pozycji (dopoki uzytkownik nie przesunie, puste,
 *                   wiec komponent zachowuje swoje domyslne `bottom`/`right`),
 *  - `handleProps` — do rozlozenia na uchwycie (naglowek panelu / sam przycisk),
 *  - `reset`      — powrot do pozycji domyslnej.
 *
 * @param {string} storageKey klucz w localStorage
 * @param {{width?: number, height?: number}} [rozmiar] przyblizony rozmiar panelu,
 *        uzywany tylko do utrzymania go w granicach okna
 */
export default function useDraggablePanel(storageKey, rozmiar = {}) {
  const { width = 380, height = 520 } = rozmiar;
  const [pozycja, setPozycja] = useState(null);
  const przeciaganie = useRef(null);
  const przesunieto = useRef(false);

  // Odtworzenie zapisanej pozycji
  useEffect(() => {
    try {
      const zapis = window.localStorage.getItem(storageKey);
      if (!zapis) return;
      const p = JSON.parse(zapis);
      if (typeof p?.left === 'number' && typeof p?.top === 'number') setPozycja(p);
    } catch {
      /* uszkodzony wpis ignorujemy — panel wroci na pozycje domyslna */
    }
  }, [storageKey]);

  const wGranicach = useCallback((left, top) => ({
    left: Math.min(Math.max(8, left), Math.max(8, window.innerWidth - width - 8)),
    top: Math.min(Math.max(8, top), Math.max(8, window.innerHeight - height - 8)),
  }), [width, height]);

  // Po zmianie rozmiaru okna panel nie moze zostac poza ekranem
  useEffect(() => {
    if (!pozycja) return undefined;
    const onResize = () => setPozycja((p) => (p ? wGranicach(p.left, p.top) : p));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [pozycja, wGranicach]);

  const onPointerDown = useCallback((e) => {
    // Tylko lewy przycisk; nie przechwytujemy klikniec w kontrolki wewnatrz uchwytu
    if (e.button !== 0) return;
    const panel = e.currentTarget.closest('[data-draggable-panel]') || e.currentTarget;
    const box = panel.getBoundingClientRect();
    przeciaganie.current = { dx: e.clientX - box.left, dy: e.clientY - box.top };
    przesunieto.current = false;
    // Przechwycenie wskaznika bywa niedostepne (np. syntetyczne zdarzenia,
    // starsze przegladarki) — przeciaganie ma dzialac takze bez niego.
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* nieistotne */ }
  }, []);

  const onPointerMove = useCallback((e) => {
    const d = przeciaganie.current;
    if (!d) return;
    przesunieto.current = true;
    setPozycja(wGranicach(e.clientX - d.dx, e.clientY - d.dy));
  }, [wGranicach]);

  const onPointerUp = useCallback((e) => {
    if (!przeciaganie.current) return;
    przeciaganie.current = null;
    try { e.currentTarget.releasePointerCapture?.(e.pointerId); } catch { /* nieistotne */ }
    setPozycja((p) => {
      if (p) {
        try { window.localStorage.setItem(storageKey, JSON.stringify(p)); } catch { /* brak miejsca */ }
      }
      return p;
    });
  }, [storageKey]);

  const reset = useCallback(() => {
    setPozycja(null);
    try { window.localStorage.removeItem(storageKey); } catch { /* nic */ }
  }, [storageKey]);

  // Dopoki panel nie zostal przesuniety, nie ruszamy jego wlasnego pozycjonowania.
  const style = pozycja
    ? { left: pozycja.left, top: pozycja.top, right: 'auto', bottom: 'auto' }
    : {};

  return {
    style,
    przesuniety: !!pozycja,
    reset,
    /** czy ostatni gest byl przeciagnieciem (do odrozniania od kliknięcia) */
    czyPrzeciagnieto: () => przesunieto.current,
    handleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
      style: { cursor: 'grab', touchAction: 'none' },
      title: 'Przeciagnij, aby przeniesc panel',
    },
  };
}
