// End-to-end tests for the built app on Windows (spec §9; Task 19). Run through the mirror:
//   scripts/win.sh npm run build
//   scripts/win.sh npx playwright test --reporter=line
// One worker: every test launches its own Electron with a throwaway STUDYAT_USER_DATA, and the
// global hotkey and the tray are per desktop, not per data folder.
// STUDYAT_E2E_OUT puts the artifacts outside the mirror (study-dev rule 8); STUDYAT_SHOTS_DIR, when
// set, receives the screenshots.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  outputDir: process.env.STUDYAT_E2E_OUT ?? 'test-results',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  // The accounting tests run a real focus segment for 65–80 s, and relaunch the app.
  timeout: 300_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
});
