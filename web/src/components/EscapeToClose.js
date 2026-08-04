import { useEffect } from 'react';

/**
 * Zamykanie okien modalnych klawiszem Escape.
 *
 * W aplikacji jest 11 ekranow z modalami, a tylko dwa obslugiwaly Escape —
 * reszte dalo sie zamknac wylacznie mysza, trafiajac w maly krzyzyk. Kazdy
 * modal trzyma wlasny stan pod inna nazwa (`showForm`, `selected`,
 * `showKlientKommoPayload`...), wiec zamiast wpinac hooka w kazdy z osobna
 * (i zgadywac nazwy), dzialamy na tym, co widac w DOM: po Escape klikamy
 * przycisk zamkniecia w NAJWYZEJ polozonym widocznym oknie.
 *
 * Gdy okno nie ma takiego przycisku, nie robimy nic — zaden modal nie zostanie
 * zamkniety "na sile", a formularz z niezapisanymi danymi nie zniknie
 * przypadkiem.
 */

const ETYKIETA_ZAMKNIECIA = /(zamknij|zamknac|close|anuluj|cancel)/i;
const ZNAK_ZAMKNIECIA = /^[×✕✖❌ xX]$/;

function widoczny(el) {
  if (!el.getClientRects().length) return false;
  const cs = getComputedStyle(el);
  return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.1;
}

/** Nakladki: pozycjonowane na sztywno, przykrywajace znaczna czesc ekranu. */
function znajdzNakladki() {
  const kandydaci = [];
  document.querySelectorAll('body *').forEach((el) => {
    const cs = getComputedStyle(el);
    if (cs.position !== 'fixed') return;
    if (!widoczny(el)) return;
    const box = el.getBoundingClientRect();
    if (box.width < window.innerWidth * 0.5 || box.height < window.innerHeight * 0.4) return;
    kandydaci.push({ el, z: Number(cs.zIndex) || 0 });
  });
  return kandydaci.sort((a, b) => a.z - b.z).map((k) => k.el);
}

function znajdzPrzyciskZamkniecia(zakres) {
  const przyciski = [...zakres.querySelectorAll('button, [role="button"]')].filter(widoczny);
  return przyciski.find((b) => {
    const etykieta = b.getAttribute('aria-label') || b.getAttribute('title') || '';
    if (ETYKIETA_ZAMKNIECIA.test(etykieta)) return true;
    const tekst = (b.textContent || '').trim();
    return ZNAK_ZAMKNIECIA.test(tekst) || ETYKIETA_ZAMKNIECIA.test(tekst);
  }) || null;
}

export default function EscapeToClose() {
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;

      // Pola tekstowe maja wlasna obsluge Escape (czyszczenie, podpowiedzi).
      const cel = e.target;
      if (cel && /^(INPUT|TEXTAREA|SELECT)$/.test(cel.tagName) && cel.type !== 'checkbox') return;

      const nakladki = znajdzNakladki();
      if (!nakladki.length) return;

      const najwyzsza = nakladki[nakladki.length - 1];
      const przycisk = znajdzPrzyciskZamkniecia(najwyzsza);
      if (!przycisk) return;

      przycisk.click();
      e.preventDefault();
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  return null;
}
