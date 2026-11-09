import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { copyAtomic, nodeFs } from './db-fs';
import { recordingFs, tempDir } from './test-helpers';

describe('copyAtomic', () => {
  let dir: string;
  let cleanup: () => void;

  beforeEach(() => ({ dir, cleanup } = tempDir()));
  afterEach(() => cleanup());

  // A power cut just after the rename must not leave a backup whose name is final but whose bytes
  // never reached the disk (study-dev rule 2).
  it('fsyncs the copy before the rename that publishes it', async () => {
    const from = join(dir, 'a.sqlite');
    const to = join(dir, 'b.sqlite');
    writeFileSync(from, 'bytes');
    const { fs, log } = recordingFs();
    await copyAtomic(fs, from, to);
    expect(log).toEqual([`copyFile ${from} -> ${to}.tmp`, `syncFile ${to}.tmp`, `rename ${to}.tmp -> ${to}`]);
    expect(readFileSync(to, 'utf8')).toBe('bytes');
  });

  it('nodeFs.syncFile leaves the file as it was', async () => {
    const file = join(dir, 'c.sqlite');
    writeFileSync(file, 'kept');
    await nodeFs.syncFile(file);
    expect(readFileSync(file, 'utf8')).toBe('kept');
  });
});
