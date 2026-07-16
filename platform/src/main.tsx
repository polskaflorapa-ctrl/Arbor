import { StrictMode, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/prototype-host.css';

type PrototypeKey = 'desktop' | 'mobile' | 'estimator' | 'portal' | 'start';

const prototypes: Record<PrototypeKey, { label: string; src: string }> = {
  desktop: { label: 'Arbor OS', src: '/prototypes/arbor-os.html' },
  mobile: { label: 'Mobile', src: '/prototypes/arbor-mobile.html' },
  estimator: { label: 'Gabinet wyceniającego', src: '/prototypes/gabinet-wyceniajacego.html' },
  portal: { label: 'Portal klienta', src: '/prototypes/portal-klienta.html' },
  start: { label: 'Start', src: '/prototypes/start.html' },
};

function App() {
  const [active, setActiveState] = useState<PrototypeKey>(() => keyFromLocation());
  // PROD: zawsze origin przeglądarki (nginx proxuje /api) — VITE_ARBOR_API_URL nie może
  // zapiec adresu deweloperskiego do bundla (build z lokalnym .env wysypałby zdalnych userów).
  const apiUrl = import.meta.env.PROD
    ? window.location.origin
    : (import.meta.env.VITE_ARBOR_API_URL ?? 'http://127.0.0.1:8790');
  const showSwitcher = new URLSearchParams(window.location.search).get('switcher') === '1';
  const src = useMemo(() => {
    const separator = prototypes[active].src.includes('?') ? '&' : '?';
    const login = active === 'mobile' ? 'brygadzista' : active === 'estimator' ? 'wycena' : active === 'portal' ? 'kierownik' : 'kierownik';
    const params = new URLSearchParams({ api: apiUrl, login });
    const portalToken = new URLSearchParams(window.location.search).get('token') || new URLSearchParams(window.location.search).get('portalToken');
    if (active === 'portal' && portalToken) params.set('token', portalToken);
    return `${prototypes[active].src}${separator}${params.toString()}`;
  }, [active, apiUrl]);

  useEffect(() => {
    const onHash = () => setActiveState(keyFromLocation());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const setActive = (key: PrototypeKey) => {
    window.location.hash = key === 'desktop' ? '' : key;
    setActiveState(key);
  };

  return (
    <div className="prototype-host">
      {showSwitcher && (
        <div className="prototype-switcher" aria-label="Przełącz prototyp">
          {(Object.keys(prototypes) as PrototypeKey[]).map((key) => (
            <button
              className={key === active ? 'active' : ''}
              key={key}
              onClick={() => setActive(key)}
              type="button"
            >
              {prototypes[key].label}
            </button>
          ))}
        </div>
      )}
      <iframe
        title={prototypes[active].label}
        src={src}
        className="prototype-frame"
      />
    </div>
  );
}

function keyFromLocation(): PrototypeKey {
  const pathKey = window.location.pathname.replace(/\/+$/, '').replace(/^\//, '') as PrototypeKey;
  if (pathKey in prototypes) return pathKey;
  const params = new URLSearchParams(window.location.search);
  if (params.has('portalToken')) return 'portal';
  const value = window.location.hash.replace(/^#\/?/, '') as PrototypeKey;
  return value in prototypes ? value : 'desktop';
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
