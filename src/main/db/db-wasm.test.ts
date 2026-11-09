import { expect, it, vi } from 'vitest';

// sql.js can't initialise (a missing or unreadable wasm): the readability check must say false.
vi.mock('sql.js', () => ({ default: () => Promise.reject(new Error('wasm missing')) }));

import { isReadableDatabase } from './db';

it('isReadableDatabase is false, not a rejection, when sql.js cannot load', async () => {
  await expect(isReadableDatabase('/nowhere/studyat.sqlite', '/nowhere/sql-wasm.wasm')).resolves.toBe(false);
});
