import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../db/db';
import { settingsRepo } from '../db/repos/settings';
import { NOW, openTestDb, tempDir } from '../db/test-helpers';
import { soundsService } from './sounds';
import { spacesService } from './spaces';
import { IpcValidationError } from './validate';

let dir: string;
let cleanup: () => void;
let db: Db;
let assets: string;

beforeEach(async () => {
  ({ dir, cleanup } = tempDir());
  db = await openTestDb(dir);
  assets = join(dir, 'assets');
  mkdirSync(join(assets, 'images'), { recursive: true });
  mkdirSync(join(assets, 'sounds'), { recursive: true });
});

afterEach(async () => {
  await db.close();
  cleanup();
});

const touch = (name: string): string => {
  const p = join(dir, name);
  writeFileSync(p, 'x');
  return p;
};

describe('spacesService', () => {
  it('addFiles assigns video/image kind by extension', () => {
    const svc = spacesService({ db, now: () => NOW, assetsDir: assets });
    const files = [
      'a.MP4',
      'b.webm',
      'c.mov',
      'd.m4v',
      'e.jpg',
      'f.JPEG',
      'g.png',
      'h.webp',
      'i.gif',
      'j.txt',
    ].map(touch);
    const added = svc.addFiles(files).filter((s) => !s.builtin);
    expect(added.map((s) => [s.name, s.kind])).toEqual([
      ['a', 'video'],
      ['b', 'video'],
      ['c', 'video'],
      ['d', 'video'],
      ['e', 'image'],
      ['f', 'image'],
      ['g', 'image'],
      ['h', 'image'],
      ['i', 'image'],
    ]);
    expect(added[0]?.source).toBe(files[0]);
    // The same file twice is one space.
    expect(svc.addFiles([files[0]!]).filter((s) => !s.builtin)).toHaveLength(9);
  });

  it('missing true when file absent', () => {
    const svc = spacesService({ db, now: () => NOW, assetsDir: assets });
    const here = touch('café rain.mp4');
    svc.addFiles([here, join(dir, 'gone.png')]);
    const byName = new Map(svc.list().map((s) => [s.name, s]));
    expect(byName.get('café rain')?.missing).toBe(false);
    // addFiles skips nothing by existence; the dialog only returns real files.
    expect(byName.get('gone')?.missing).toBe(true);
    // Built-in images resolve against the assets folder (absent here); YouTube is never missing.
    expect(byName.get('Forest path')?.missing).toBe(true);
    writeFileSync(join(assets, 'images', 'forest-path.jpg'), 'x');
    expect(svc.list().find((s) => s.name === 'Forest path')?.missing).toBe(false);
    expect(
      svc
        .list()
        .filter((s) => s.kind === 'youtube')
        .every((s) => !s.missing),
    ).toBe(true);
  });

  it('addYouTube stores the id and thumb, and rejects other links', () => {
    const svc = spacesService({ db, now: () => NOW, assetsDir: assets });
    const added = svc.addYouTube('https://youtu.be/dQw4w9WgXcQ').at(-1)!;
    expect(added).toMatchObject({
      kind: 'youtube',
      source: 'dQw4w9WgXcQ',
      thumb: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    });
    expect(() => svc.addYouTube('https://vimeo.com/123')).toThrow(IpcValidationError);
  });

  it('update validates the patch, clamps opts and accepts a captured thumb', () => {
    const svc = spacesService({ db, now: () => NOW, assetsDir: assets });
    const id = svc.addFiles([touch('v.mp4')]).at(-1)!.id;
    const thumb = `data:image/jpeg;base64,${'A'.repeat(100)}`;
    const s = svc
      .update(id, { name: 'Rain', favourite: true, opts: { speed: 9, dim: 0.3 }, thumb })
      .find((x) => x.id === id)!;
    expect(s).toMatchObject({ name: 'Rain', favourite: true, thumb });
    expect(s.opts).toMatchObject({ speed: 1.5, dim: 0.3 });
    expect(() => svc.update(id, { thumb: 'https://evil.example/x.jpg' })).toThrow(IpcValidationError);
    expect(() => svc.update(id, { thumb: `data:image/jpeg;base64,${'A'.repeat(300_000)}` })).toThrow(
      IpcValidationError,
    );
    expect(() => svc.update(id, { name: 'x'.repeat(501) })).toThrow(IpcValidationError);
    expect(() => svc.update(9999, { name: 'x' })).toThrow(IpcValidationError);
  });

  it('update keeps a valid YouTube quality and rejects any other', () => {
    const svc = spacesService({ db, now: () => NOW, assetsDir: assets });
    const id = svc.addYouTube('https://youtu.be/dQw4w9WgXcQ').at(-1)!.id;
    const s = svc.update(id, { opts: { quality: '2160' } }).find((x) => x.id === id)!;
    expect(s.opts.quality).toBe('2160');
    expect(() => svc.update(id, { opts: { quality: '720' } } as never)).toThrow(IpcValidationError);
  });

  it('relocate keeps the id and needs a file of the same kind', () => {
    const svc = spacesService({ db, now: () => NOW, assetsDir: assets });
    const id = svc.addFiles([join(dir, 'old.mp4')]).at(-1)!.id;
    const moved = touch('new.webm');
    expect(svc.relocate(id, moved).find((s) => s.id === id)).toMatchObject({ source: moved, missing: false });
    expect(() => svc.relocate(id, touch('pic.png'))).toThrow(IpcValidationError);
  });

  it('setActive stores the id; removing the active space falls back to the first', () => {
    const svc = spacesService({ db, now: () => NOW, assetsDir: assets });
    const id = svc.addFiles([touch('v.mp4')]).at(-1)!.id;
    svc.setActive(id);
    expect(settingsRepo(db).get().activeSpaceId).toBe(id);
    svc.remove(id);
    expect(settingsRepo(db).get().activeSpaceId).toBe(svc.list()[0]!.id);
    expect(() => svc.setActive(9999)).toThrow(IpcValidationError);
  });
});

describe('soundsService', () => {
  it('adds audio files by extension and works out missing', () => {
    const svc = soundsService({ db, assetsDir: assets });
    const ok = touch('rain loop.OGG');
    const list = svc.addFiles([ok, join(dir, 'gone.mp3'), touch('notes.txt')]);
    const added = list.filter((s) => !s.builtin);
    expect(added.map((s) => [s.name, s.kind, s.missing])).toEqual([
      ['rain loop', 'file', false],
      ['gone', 'file', true],
    ]);
    // Built-in noise is generated, so never missing; built-in files resolve against assets.
    expect(list.filter((s) => s.kind === 'noise').every((s) => !s.missing)).toBe(true);
    expect(list.filter((s) => s.builtin && s.kind === 'file').every((s) => s.missing)).toBe(true);
  });

  it('relocate keeps the id and resets nothing else', () => {
    const svc = soundsService({ db, assetsDir: assets });
    const id = svc.addFiles([join(dir, 'gone.mp3')]).at(-1)!.id;
    const moved = touch('found.wav');
    expect(svc.relocate(id, moved).find((s) => s.id === id)).toMatchObject({
      id,
      source: moved,
      missing: false,
    });
    expect(svc.pathOf(id)).toBe(moved);
    expect(() => svc.relocate(id, touch('x.mp4'))).toThrow(IpcValidationError);
    const noise = svc.list().find((s) => s.kind === 'noise')!;
    expect(() => svc.relocate(noise.id, moved)).toThrow(IpcValidationError);
  });

  it('removing a sound used as a chime puts that chime back to its default', () => {
    const svc = soundsService({ db, assetsDir: assets });
    const id = svc.addFiles([touch('ding.wav')]).at(-1)!.id;
    settingsRepo(db).set({ chimeFocusEnd: `file:${id}` });
    svc.remove(id);
    expect(settingsRepo(db).get().chimeFocusEnd).toBe('bell');
    expect(svc.pathOf(id)).toBeNull();
  });
});
