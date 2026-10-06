import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import ErrorBoundary from './components/ErrorBoundary.tsx';
import 'katex/dist/katex.min.css';
import './index.css';

console.log('[System Init] Mounting React application...');

// Global unhandled error logger to surface errors safely without unhandled crashes
if (typeof window !== 'undefined') {
  window.addEventListener('error', (event) => {
    console.warn('[Global Window Error Handled]:', event.error || event.message);
  });
  window.addEventListener('unhandledrejection', (event) => {
    console.warn('[Global Unhandled Rejection Handled]:', event.reason);
    if (typeof event.preventDefault === 'function') {
      event.preventDefault();
    }
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);

