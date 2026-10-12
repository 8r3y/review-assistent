import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../common/base.css';
import { OverlayApp } from './OverlayApp';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <OverlayApp />
  </StrictMode>,
);
