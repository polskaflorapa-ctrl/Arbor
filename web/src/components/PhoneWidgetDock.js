import { useEffect } from 'react';

/**
 * Dokowanie zewnetrznego softphone'a Zadarma.
 *
 * Widget jest wstrzykiwany do <body> przez skrypt Zadarmy, wiec Reactowe
 * pozycjonowanie go nie obejmuje. Potrafil wyladowac w lewym gornym rogu i
 * zaslonic logo oraz boczny pasek (konfiguracja `{right,bottom}` przekazana do
 * `zadarmaWidgetFn` bywa ignorowana). Ten komponent nic nie renderuje — czeka az
 * widget pojawi sie w DOM, po czym:
 *   1. ustawia mu pozycje (zapamietana albo domyslna, z dala od asystenta AI),
 *   2. dokleja uchwyt, ktorym mozna go przeciagnac po calej powierzchni okna.
 */

const KLUCZ = 'pf-phone-widget-pos';
const SELEKTORY = [
  '[id*="zdrm"]', '[class*="zdrm"]',
  '[id*="zadarma"]', '[class*="zadarma"]',
  '[id*="webphone"]', '[class*="webphone"]',
].join(',');

const DOMYSLNA = () => ({
  left: 18,
  top: Math.max(18, window.innerHeight - 260),
});

function wczytajPozycje() {
  try {
    const zapis = window.localStorage.getItem(KLUCZ);
    if (!zapis) return null;
    const p = JSON.parse(zapis);
    return (typeof p?.left === 'number' && typeof p?.top === 'number') ? p : null;
  } catch {
    return null;
  }
}

function wGranicach(left, top, el) {
  const box = el.getBoundingClientRect();
  const w = box.width || 240;
  const h = box.height || 200;
  return {
    left: Math.min(Math.max(8, left), Math.max(8, window.innerWidth - w - 8)),
    top: Math.min(Math.max(8, top), Math.max(8, window.innerHeight - h - 8)),
  };
}

function ustawPozycje(el, poz) {
  el.style.setProperty('position', 'fixed', 'important');
  el.style.setProperty('left', `${poz.left}px`, 'important');
  el.style.setProperty('top', `${poz.top}px`, 'important');
  el.style.setProperty('right', 'auto', 'important');
  el.style.setProperty('bottom', 'auto', 'important');
  // Ponizej asystenta AI (9000), ale nad trescia modulow.
  el.style.setProperty('z-index', '8800', 'important');
}

function dodajUchwyt(el) {
  if (el.querySelector('[data-pf-phone-handle]')) return;

  const uchwyt = document.createElement('div');
  uchwyt.setAttribute('data-pf-phone-handle', '1');
  uchwyt.title = 'Przeciagnij, aby przeniesc telefon';
  uchwyt.setAttribute('aria-label', 'Przeciagnij, aby przeniesc telefon');
  Object.assign(uchwyt.style, {
    position: 'absolute',
    top: '-14px',
    left: '0',
    right: '0',
    height: '18px',
    borderRadius: '10px 10px 0 0',
    background: 'linear-gradient(135deg, #3b2a18, #2a1d0f)',
    border: '1px solid rgba(160, 175, 20, 0.35)',
    borderBottom: 'none',
    cursor: 'grab',
    touchAction: 'none',
    zIndex: '1',
  });

  // Trzy kreski — czytelny sygnal "to mozna chwycic".
  const chwyt = document.createElement('div');
  Object.assign(chwyt.style, {
    width: '34px', height: '3px', margin: '7px auto 0',
    borderRadius: '999px', background: 'rgba(239, 233, 218, 0.7)',
  });
  uchwyt.appendChild(chwyt);

  let start = null;
  uchwyt.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const box = el.getBoundingClientRect();
    start = { dx: e.clientX - box.left, dy: e.clientY - box.top };
    uchwyt.style.cursor = 'grabbing';
    try { uchwyt.setPointerCapture?.(e.pointerId); } catch { /* nieistotne */ }
    e.preventDefault();
  });
  uchwyt.addEventListener('pointermove', (e) => {
    if (!start) return;
    ustawPozycje(el, wGranicach(e.clientX - start.dx, e.clientY - start.dy, el));
  });
  const koniec = (e) => {
    if (!start) return;
    start = null;
    uchwyt.style.cursor = 'grab';
    try { uchwyt.releasePointerCapture?.(e.pointerId); } catch { /* nieistotne */ }
    try {
      const box = el.getBoundingClientRect();
      window.localStorage.setItem(KLUCZ, JSON.stringify({ left: box.left, top: box.top }));
    } catch {
      /* brak miejsca w localStorage — pozycja zadziala do przeladowania */
    }
  };
  uchwyt.addEventListener('pointerup', koniec);
  uchwyt.addEventListener('pointercancel', koniec);

  if (getComputedStyle(el).position === 'static') el.style.position = 'fixed';
  el.appendChild(uchwyt);
}

function zadokuj(el) {
  if (!el || el.dataset.pfDocked === '1') return;
  // Pomijamy elementy zerowe/ukryte — skrypt Zadarmy tworzy tez pomocnicze wezly.
  const box = el.getBoundingClientRect();
  if (box.width < 40 || box.height < 40) return;
  el.dataset.pfDocked = '1';
  ustawPozycje(el, wGranicach(...Object.values(wczytajPozycje() || DOMYSLNA()), el));
  dodajUchwyt(el);
}

export default function PhoneWidgetDock() {
  useEffect(() => {
    const szukaj = () => {
      document.body.querySelectorAll(SELEKTORY).forEach((el) => {
        // Interesuje nas kontener najwyzszego poziomu, nie jego wnetrze.
        if (el.closest('[data-pf-docked="1"]')) return;
        if (el.parentElement && el.parentElement !== document.body) return;
        zadokuj(el);
      });
    };

    szukaj();
    const obserwator = new MutationObserver(szukaj);
    obserwator.observe(document.body, { childList: true, subtree: false });

    const onResize = () => {
      document.body.querySelectorAll('[data-pf-docked="1"]').forEach((el) => {
        const box = el.getBoundingClientRect();
        ustawPozycje(el, wGranicach(box.left, box.top, el));
      });
    };
    window.addEventListener('resize', onResize);

    return () => {
      obserwator.disconnect();
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return null;
}
