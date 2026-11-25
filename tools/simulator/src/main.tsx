import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { SimulatorApp } from './ui/SimulatorApp';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SimulatorApp />
  </StrictMode>,
);
