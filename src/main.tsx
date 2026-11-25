/**
 * @file Application entrypoint performing single-shot storage bootstrap strictly outside
 * `<StrictMode>` before mounting React (`design.md §5.1`).
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './App';
import { runAutoSchedule } from './domain/autoScheduler';
import { loadState } from './persistence/localStorageAdapter';

if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('bench') === '1') {
  (window as unknown as Record<string, unknown>).__STAFF_SCHEDULER_BENCH__ = {
    runAutoSchedule,
  };
}

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
