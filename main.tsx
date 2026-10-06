import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './src/App.tsx';
import ErrorBoundary from './src/components/ErrorBoundary.tsx';
import 'katex/dist/katex.min.css';
import './src/index.css';

console.log('[System Init] Mounting React application from root entrypoint...');

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

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  );
}
