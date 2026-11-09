// Task 19 extra (spec §3.3, widgets addendum §4b): a schema-v1 database, as the app shipped before
// the Notes widget, opens, gains the notes table, keeps its history, and leaves a pre-migration
// backup behind.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildV1Database, expect, queryDb, test } from './fixtures';

test('a v1 database migrates to v2 with a pre-migration backup', async ({ launch, dataDir }) => {
  await buildV1Database(dataDir);
  expect(await queryDb(dataDir, "SELECT value FROM meta WHERE key = 'schema_version'")).toEqual([{ value: '1' }]);

  const { win } = await launch();
  const backups = readdirSync(join(dataDir, 'backups'));
  expect(backups.filter((f) => /^pre-migration-v1-.*\.sqlite$/.test(f))).toHaveLength(1);

  expect(await queryDb(dataDir, "SELECT value FROM meta WHERE key = 'schema_version'")).toEqual([{ value: '2' }]);
  expect(await queryDb(dataDir, "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'notes'")).toHaveLength(1);
  // The old session survived, and the new table works through the app.
  expect(await win.evaluate(() => window.studyat.stats.sessions())).toHaveLength(1);
  const notes = await win.evaluate(() => window.studyat.notes.create());
  expect(notes).toHaveLength(1);
});
