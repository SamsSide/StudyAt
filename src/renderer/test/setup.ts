// Loads the jest-dom matchers (toBeInTheDocument, ...) for every renderer test.
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(async () => {
  cleanup();
  // The planner's drag guard is module state: a drag in one test must not silence a click in the
  // next. Imported late, so a suite's own `vi.mock` of dnd-kit is already in place when it loads.
  const { resetDragGuard } = await import('../planner/dnd');
  resetDragGuard();
});
