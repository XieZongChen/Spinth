import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from '@spinth/react';
import { registerAppServiceWorker } from './pwa/serviceWorker';
import '@fontsource-variable/nunito';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);

// SW 注册仅生产（specs/pwa D2/D6）：dev 不注册，HMR / React refresh 不受影响
if (import.meta.env.PROD) registerAppServiceWorker();
