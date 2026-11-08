import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Placeholder shell: Task 18 replaces this with App.
const root = document.getElementById('root');
if (root) {
  document.body.style.cssText = 'margin:0;background:#0f1115;color:#e8eaf0;font-family:system-ui,sans-serif';
  createRoot(root).render(
    <StrictMode>
      <h1 style={{ margin: 0, padding: 32 }}>StudyAt</h1>
    </StrictMode>,
  );
}
