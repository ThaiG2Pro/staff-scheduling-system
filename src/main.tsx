/**
 * @file Application entrypoint performing single-shot storage bootstrap strictly outside
 * `<StrictMode>` before mounting React (`design.md §5.1`).
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './App';
import { loadState } from './persistence/localStorageAdapter';

const bootstrapState = loadState();
const rootEl = document.getElementById('root');

if (!rootEl) {
  throw new Error('Root mount element #root was not found.');
}

createRoot(rootEl).render(
  <StrictMode>
    <App bootstrapState={bootstrapState} />
  </StrictMode>,
);
