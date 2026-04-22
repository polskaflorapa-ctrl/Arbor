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

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();

