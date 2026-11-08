import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Placeholder: Task 11 builds the mini timer view.
const root = document.getElementById('root');
if (root) {
  document.body.style.cssText = 'margin:0;background:transparent;color:#e8eaf0;font-family:system-ui,sans-serif';
  createRoot(root).render(
    <StrictMode>
      <div style={{ padding: 12 }}>StudyAt</div>
    </StrictMode>,
  );
}
