// Soundboard channels (spec §3.9; appplan §4.3): added files by extension, `missing` against the
// file system, relocate keeping the id (R19, so saved mixes and chimes still name it). Built-in
// file sources are relative to the assets folder; generated noise has no file.
import { existsSync } from 'node:fs';
import { basename, extname, isAbsolute, join } from 'node:path';
import { DEFAULT_SETTINGS } from '../../shared/settings';
import type { Settings, Sound } from '../../shared/types';
import type { Db } from '../db/db';
import { settingsRepo } from '../db/repos/settings';
import { soundsRepo } from '../db/repos/sounds';
import { IpcValidationError } from './validate';

export const AUDIO_EXTS = ['mp3', 'ogg', 'wav', 'm4a'] as const;

export interface SoundsServiceDeps {
  db: Db;
  assetsDir: string;
  exists?: (path: string) => boolean;
}

export type SoundsService = ReturnType<typeof soundsService>;

export const isAudioFile = (path: string): boolean =>
  (AUDIO_EXTS as readonly string[]).includes(extname(path).slice(1).toLowerCase());

const CHIME_KEYS = ['chimeFocusEnd', 'chimeBreakEnd'] as const satisfies readonly (keyof Settings)[];

export function soundsService(deps: SoundsServiceDeps) {
  const repo = soundsRepo(deps.db);
  const settings = settingsRepo(deps.db);
  const exists = deps.exists ?? existsSync;

  const resolve = (s: Sound): string =>
    s.builtin && !isAbsolute(s.source) ? join(deps.assetsDir, s.source) : s.source;

  const list = (): Sound[] =>
    repo.list().map((s) => (s.kind === 'noise' ? s : { ...s, missing: !exists(resolve(s)) }));

  return {
    list,

    /** The file a `file` channel (or a `file:<id>` chime) plays; null for noise or unknown ids. */
    pathOf(id: number): string | null {
      const s = repo.list().find((x) => x.id === id);
      return s && s.kind === 'file' ? resolve(s) : null;
    },

    addFiles(paths: string[]): Sound[] {
      const known = new Set(repo.list().map((s) => s.source));
      for (const path of paths) {
        if (!isAudioFile(path) || known.has(path)) continue;
        repo.create({ name: basename(path, extname(path)), kind: 'file', source: path });
        known.add(path);
      }
      return list();
    },

    /** A chime that played this sound goes back to its default, so it never points at nothing. */
    remove(id: number): Sound[] {
      repo.remove(id);
      const current = settings.get();
      const reset: Partial<Pick<Settings, (typeof CHIME_KEYS)[number]>> = {};
      for (const key of CHIME_KEYS) if (current[key] === `file:${id}`) reset[key] = DEFAULT_SETTINGS[key];
      if (Object.keys(reset).length > 0) settings.set(reset);
      return list();
    },

    relocate(id: number, path: string): Sound[] {
      const s = repo.list().find((x) => x.id === id);
      if (!s) throw new IpcValidationError('No such sound');
      if (s.kind !== 'file') throw new IpcValidationError('A generated sound has no file to relocate');
      if (!isAudioFile(path)) throw new IpcValidationError('Choose an mp3, ogg, wav or m4a file');
      // The repo has no update; the row keeps its id, name, sort and built-in flag.
      deps.db.raw.run('UPDATE sounds SET source = ? WHERE id = ?', [path, id]);
      deps.db.markDirty();
      return list();
    },
  };
}
