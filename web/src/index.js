import './utils/safeJsonLocalStorage';
import React from 'react';
import ReactDOM from 'react-dom/client';
import * as Sentry from '@sentry/react';
import { initSentry, getSentryConfig } from './config/sentry';
import './i18n';
import './index.css';
import './styles/canopy-command.css';
import App from './App';
import './animations.css';
import './styles/ui-ux-pro-max-final.css';
import reportWebVitals from './reportWebVitals';
import { BUILD_STAMP } from './buildStamp';

console.info('[arbor-web]', BUILD_STAMP, process.env.NODE_ENV || '');

initSentry();

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    {getSentryConfig().enabled && (
      <Sentry.ErrorBoundary
        fallbackRender={({ error, resetError }) => (
          <div style={{ padding: '20px', textAlign: 'center' }}>
            <h2>Coś poszło nie tak</h2>
            <pre style={{ textAlign: 'left', overflow: 'auto' }}>{error?.message || error}</pre>
            <button onClick={resetError}>Spróbuj ponownie</button>
          </div>
        )}
      >
        <App />
      </Sentry.ErrorBoundary>
    )}
    {!getSentryConfig().enabled && <App />}
  </React.StrictMode>
);

reportWebVitals();
