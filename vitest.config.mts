import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Node by default; the renderer tests (src/renderer/**) run under jsdom.
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
          exclude: ['src/renderer/**', 'node_modules/**'],
        },
      },
      {
        extends: true,
        test: {
          name: 'renderer',
          environment: 'jsdom',
          include: ['src/renderer/**/*.test.ts', 'src/renderer/**/*.test.tsx'],
          setupFiles: ['src/renderer/test/setup.ts'],
        },
      },
    ],
  },
});
