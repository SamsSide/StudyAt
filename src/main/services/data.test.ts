import { mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../db/db';
import { deadlinesRepo } from '../db/repos/deadlines';
import { notesRepo } from '../db/repos/notes';
import { sessionsRepo } from '../db/repos/sessions';
import { settingsRepo } from '../db/repos/settings';
import { subjectsRepo } from '../db/repos/subjects';
import { tasksRepo } from '../db/repos/tasks';
import { nodeFs, type DbFs } from '../db/db-fs';
import { NOW, openTestDb, tempDir } from '../db/test-helpers';
import { csvLine, dataService, localStamp } from './data';
import { IpcValidationError } from './validate';

let dir: string;
let cleanup: () => void;
let db: Db;

beforeEach(async () => {
  ({ dir, cleanup } = tempDir());
  db = await openTestDb(dir);
});

afterEach(async () => {
  await db.close();
  cleanup();
});

function service(overrides: { confirm?: () => Promise<boolean>; fs?: DbFs } = {}) {
  const app = { relaunch: vi.fn(), exit: vi.fn() };
  const beforeRestore = vi.fn(() => Promise.resolve());
  const svc = dataService({
    db,
    dir,
    now: () => NOW,
    confirm: overrides.confirm ?? (() => Promise.resolve(true)),
    beforeRestore,
    app,
    fs: overrides.fs,
  });
  return { svc, app, beforeRestore };
}

describe('dataService', () => {
  it('exportCsv writes header date,start,end,minutes,subject and local times', async () => {
    const sessions = sessionsRepo(db);
    const subject = subjectsRepo(db).list()[0]!;
    // 23:50 on 8 Nov to 00:15 on 9 Nov, 25.25 focus minutes: credited to the 8th (its start day).
    const start = new Date(2026, 10, 8, 23, 50).getTime();
    const row = sessions.insertRunning({
      pomodoroId: 'a',
      subjectId: subject.id,
      taskId: null,
      taskText: null,
      startedAt: start,
      dayKey: '2026-11-08',
    });
    sessions.close(row.id, new Date(2026, 10, 9, 0, 15).getTime(), 1_515_000, 0);
    const untagged = sessions.insertRunning({
      pomodoroId: 'b',
      subjectId: null,
      taskId: null,
      taskText: null,
      startedAt: new Date(2026, 10, 9, 9, 5).getTime(),
      dayKey: '2026-11-09',
    });
    sessions.checkpoint(untagged.id, 120_000, new Date(2026, 10, 9, 9, 7).getTime());

    const out = join(dir, 'sessions.csv');
    await service().svc.exportCsv(out);
    expect(readFileSync(out, 'utf8').split('\r\n')).toEqual([
      'date,start,end,minutes,subject',
      `2026-11-08,2026-11-08 23:50,2026-11-09 00:15,25.3,${subject.name}`,
      // A running row ends at its last checkpoint.
      '2026-11-09,2026-11-09 09:05,2026-11-09 09:07,2.0,',
      '',
    ]);
  });

  // Simple tasks spec §3.4: `tasks` is the v1 sticky shape, as on main; the planner's lists and the
  // v1 archive leave the export (they stay in the database and every backup).
  it('JSON export has the sticky tasks and deadlines, and no tasksV1 or taskLists', async () => {
    const task = tasksRepo(db).create({ text: 'Past papers', colour: 'pink' }, NOW);
    tasksRepo(db).update(task.id, { done: true }, NOW + 5);
    deadlinesRepo(db).create(
      { title: 'Calculus exam', kind: 'exam', subjectId: null, due: '2026-12-01T09:00', note: '' },
      NOW,
    );
    const out = join(dir, 'export.json');
    await service().svc.exportJson(out);
    const exported = JSON.parse(readFileSync(out, 'utf8')) as {
      tasks: unknown[];
      deadlines: { due: string }[];
    };
    expect(exported.tasks).toHaveLength(1);
    expect(exported.tasks[0]).toEqual({
      id: task.id,
      text: 'Past papers',
      colour: 'pink',
      done: true,
      sort: 0,
      createdAt: NOW,
      doneAt: NOW + 5,
    });
    expect(exported.deadlines[0]!.due).toBe('2026-12-01T09:00');
    expect('tasksV1' in exported).toBe(false);
    expect('taskLists' in exported).toBe(false);
    // The CSV is sessions only and unchanged.
    const csv = join(dir, 'sessions.csv');
    await service().svc.exportCsv(csv);
    expect(readFileSync(csv, 'utf8')).toBe('date,start,end,minutes,subject\r\n');
  });

  it('quotes CSV fields that need it', () => {
    expect(csvLine(['a,b', 'say "hi"', 'plain'])).toBe('"a,b","say ""hi""",plain');
    expect(localStamp(new Date(2026, 0, 2, 3, 4).getTime())).toBe('2026-01-02 03:04');
  });

  it('exportJson includes notes and omits spotifyTokens', async () => {
    settingsRepo(db).set({
      spotifyTokens: 'c2VjcmV0',
      spotifyClientId: 'abc',
      calendarUrls: 'Y2FsZW5kYXI=',
      calendarCache: { state: 'ok', fetchedAt: NOW, events: [] },
      weatherCache: { state: 'error', place: null, fetchedAt: null },
    });
    const [note] = notesRepo(db).create({ colour: 'blue' }, NOW);
    notesRepo(db).update(note!.id, { text: 'Bring calculator' }, NOW + 1);
    const out = join(dir, 'export.json');
    await service().svc.exportJson(out);
    const json = JSON.parse(readFileSync(out, 'utf8')) as Record<string, unknown>;
    expect(Object.keys(json)).toEqual([
      'exportedAt',
      'schemaVersion',
      'subjects',
      'sessions',
      'tasks',
      'deadlines',
      'spaces',
      'sounds',
      'mixes',
      'recaps',
      'notes',
      'settings',
    ]);
    expect(json.exportedAt).toBe(NOW);
    expect(json.schemaVersion).toBe(5);
    expect(json.notes).toEqual([
      {
        id: note!.id,
        text: 'Bring calculator',
        colour: 'blue',
        sort: 0,
        createdAt: NOW,
        updatedAt: NOW + 1,
        popped: false,
        x: null,
        y: null,
        scale: 1,
        bare: false,
      },
    ]);
    expect(json.settings).not.toHaveProperty('spotifyTokens');
    for (const key of ['calendarUrls', 'calendarCache', 'weatherCache'])
      expect(json.settings).not.toHaveProperty(key);
    expect(json.settings).toMatchObject({
      spotifyClientId: 'abc',
      weatherUnits: 'celsius',
      weatherPlace: null,
    });
    expect(readFileSync(out, 'utf8')).not.toContain('Y2FsZW5kYXI=');
    expect(readFileSync(out, 'utf8')).not.toContain('c2VjcmV0');
  });

  it('restoreBackup only restores a listed backup, after confirming, keeping the current file', async () => {
    mkdirSync(join(dir, 'backups'), { recursive: true });
    writeFileSync(join(dir, 'backups', 'daily-2026-11-07.sqlite'), 'old data');

    await expect(service().svc.restoreBackup('../studyat.sqlite')).rejects.toThrow(IpcValidationError);

    const cancelled = service({ confirm: () => Promise.resolve(false) });
    expect(await cancelled.svc.restoreBackup('daily-2026-11-07.sqlite')).toBe(false);
    expect(cancelled.beforeRestore).not.toHaveBeenCalled();

    const before = readFileSync(join(dir, 'studyat.sqlite'));
    const { svc, app, beforeRestore } = service();
    expect(await svc.restoreBackup('daily-2026-11-07.sqlite')).toBe(true);
    expect(beforeRestore).toHaveBeenCalledTimes(1);
    expect(readFileSync(join(dir, 'studyat.sqlite'), 'utf8')).toBe('old data');
    const safety = readdirSync(join(dir, 'backups')).find((n) => n.startsWith('pre-restore-'));
    expect(safety && readFileSync(join(dir, 'backups', safety))).toEqual(before);
    expect(app.relaunch).toHaveBeenCalled();
    expect(app.exit).toHaveBeenCalledWith(0);
  });

  it('restoreBackup still relaunches on the untouched original when copying the backup in fails', async () => {
    mkdirSync(join(dir, 'backups'), { recursive: true });
    writeFileSync(join(dir, 'backups', 'daily-2026-11-07.sqlite'), 'old data');
    const before = readFileSync(join(dir, 'studyat.sqlite'));
    const fs: DbFs = {
      ...nodeFs,
      copyFile: (from, to) =>
        from.endsWith('daily-2026-11-07.sqlite')
          ? Promise.reject(new Error('disk full'))
          : nodeFs.copyFile(from, to),
    };
    const { svc, app } = service({ fs });

    await expect(svc.restoreBackup('daily-2026-11-07.sqlite')).rejects.toThrow('disk full');
    expect(app.relaunch).toHaveBeenCalledTimes(1);
    expect(app.exit).toHaveBeenCalledWith(0);
    expect(readFileSync(join(dir, 'studyat.sqlite'))).toEqual(before);
  });

  it('restoreBackup never copies the backup in when the pre-restore safety copy fails, and still relaunches', async () => {
    mkdirSync(join(dir, 'backups'), { recursive: true });
    writeFileSync(join(dir, 'backups', 'daily-2026-11-07.sqlite'), 'old data');
    const before = readFileSync(join(dir, 'studyat.sqlite'));
    const copies: string[] = [];
    const fs: DbFs = {
      ...nodeFs,
      copyFile: (from, to) => {
        copies.push(from);
        return to.includes('pre-restore-') ? Promise.reject(new Error('EACCES')) : nodeFs.copyFile(from, to);
      },
    };
    const { svc, app } = service({ fs });

    await expect(svc.restoreBackup('daily-2026-11-07.sqlite')).rejects.toThrow('EACCES');
    expect(copies.some((f) => f.endsWith('daily-2026-11-07.sqlite'))).toBe(false);
    expect(readFileSync(join(dir, 'studyat.sqlite'))).toEqual(before);
    expect(app.relaunch).toHaveBeenCalledTimes(1);
    expect(app.exit).toHaveBeenCalledWith(0);
  });

  it('restoreBackup rethrows a failed shutdown without copying, relaunching or exiting', async () => {
    mkdirSync(join(dir, 'backups'), { recursive: true });
    writeFileSync(join(dir, 'backups', 'daily-2026-11-07.sqlite'), 'old data');
    const before = readFileSync(join(dir, 'studyat.sqlite'));
    const { svc, app, beforeRestore } = service();
    beforeRestore.mockRejectedValueOnce(new Error('flush failed'));

    await expect(svc.restoreBackup('daily-2026-11-07.sqlite')).rejects.toThrow('flush failed');
    expect(app.relaunch).not.toHaveBeenCalled();
    expect(app.exit).not.toHaveBeenCalled();
    expect(readdirSync(join(dir, 'backups')).filter((n) => n.startsWith('pre-restore-'))).toEqual([]);
    expect(readFileSync(join(dir, 'studyat.sqlite'))).toEqual(before);
  });
});
