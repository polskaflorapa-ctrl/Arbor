import './utils/safeJsonLocalStorage';
import React from 'react';
import ReactDOM from 'react-dom/client';
import './i18n';
import './index.css';
import App from './App';
import './animations.css';
import reportWebVitals from './reportWebVitals';
import { BUILD_STAMP } from './buildStamp';

console.info('[arbor-web]', BUILD_STAMP, process.env.NODE_ENV || '');

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

reportWebVitals();
