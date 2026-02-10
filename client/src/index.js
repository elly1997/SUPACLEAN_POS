import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';

// Ignore errors from browser extensions (e.g. MetaMask) so they don't break the app UI
function isFromExtension(errOrEvent) {
  if (errOrEvent.filename && String(errOrEvent.filename).indexOf('chrome-extension://') === 0) return true;
  const stack = errOrEvent.error?.stack || errOrEvent.reason?.stack || (errOrEvent instanceof Error && errOrEvent.stack);
  return !!(stack && String(stack).indexOf('chrome-extension://') !== -1);
}
window.addEventListener('error', (event) => {
  if (isFromExtension(event)) {
    event.preventDefault();
    event.stopPropagation();
    return true;
  }
}, true);
window.addEventListener('unhandledrejection', (event) => {
  if (isFromExtension(event)) {
    event.preventDefault();
    event.stopPropagation();
  }
}, true);

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Register service worker for offline app shell (PWA)
if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${process.env.PUBLIC_URL || ''}/service-worker.js`).catch(() => {});
  });
}
