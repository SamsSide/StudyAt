// The always-on-top mini timer window's entry (spec §3.7). It is a separate renderer, so it
// subscribes to main's pushes itself.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MiniTimer } from './mini/MiniTimer';
import { initStudyStore } from './shell/store';
import './styles/tokens.css';

const root = document.getElementById('root');
if (root) {
  document.body.style.background = 'transparent';
  initStudyStore();
  createRoot(root).render(
    <StrictMode>
      <MiniTimer />
    </StrictMode>,
  );
}
