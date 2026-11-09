// Spaces (spec §3.8; appplan §4.2): files added by extension, YouTube links by id, per-space
// options, relocate and the active space. `missing` is worked out here, against the file system:
// built-in sources are relative to the assets folder, added ones are absolute paths.
import { existsSync } from 'node:fs';
import { basename, extname, isAbsolute, join } from 'node:path';
import { parseYouTubeId } from '../../core/youtube';
import type { Space, SpaceOpts } from '../../shared/types';
import type { Db } from '../db/db';
import { settingsRepo } from '../db/repos/settings';
import { spacesRepo, youTubeThumb, type MainSpacePatch } from '../db/repos/spaces';
import { assertBool, assertRecord, assertStr, clampNum, IpcValidationError } from './validate';

export const VIDEO_EXTS = ['mp4', 'webm', 'mov', 'm4v'] as const;
export const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'gif'] as const;

/** A captured frame is a JPEG data URL; a YouTube thumb is an i.ytimg.com URL (R15). */
export const MAX_THUMB_CHARS = 300_000;
const THUMB_PREFIXES = ['data:image/jpeg;base64,', 'https://i.ytimg.com/'];

/** Ranges of the per-space options (spec §3.8). */
const OPT_RANGES: Record<Exclude<keyof SpaceOpts, 'audio'>, [number, number]> = {
  volume: [0, 1],
  speed: [0.5, 1.5],
  dim: [0, 0.6],
  blur: [0, 12],
};

export interface SpacesServiceDeps {
  db: Db;
  now: () => number;
  /** The bundled assets folder that built-in sources are relative to. */
  assetsDir: string;
  exists?: (path: string) => boolean;
}

export type SpacesService = ReturnType<typeof spacesService>;

const extOf = (path: string): string => extname(path).slice(1).toLowerCase();

export function kindByExtension(path: string): 'video' | 'image' | null {
  const ext = extOf(path);
  if ((VIDEO_EXTS as readonly string[]).includes(ext)) return 'video';
  if ((IMAGE_EXTS as readonly string[]).includes(ext)) return 'image';
  return null;
}

/** Validates a renderer `spaces.update` patch: names bounded, options clamped, thumb checked. */
export function sanitiseSpacePatch(v: unknown): MainSpacePatch {
  const p = assertRecord(v, 'patch');
  const out: MainSpacePatch = {};
  if (p.name !== undefined) out.name = assertStr(p.name, 'name', { nonEmpty: true }).trim();
  if (p.favourite !== undefined) out.favourite = assertBool(p.favourite, 'favourite');
  if (p.opts !== undefined) {
    const o = assertRecord(p.opts, 'opts');
    const opts: Partial<SpaceOpts> = {};
    if (o.audio !== undefined) opts.audio = assertBool(o.audio, 'audio');
    for (const [key, [min, max]] of Object.entries(OPT_RANGES) as [
      keyof typeof OPT_RANGES,
      [number, number],
    ][]) {
      if (o[key] !== undefined) opts[key] = clampNum(o[key], min, max, key);
    }
    out.opts = opts;
  }
  if (p.thumb !== undefined) {
    if (p.thumb === null) out.thumb = null;
    else {
      const thumb = assertStr(p.thumb, 'thumb', { max: MAX_THUMB_CHARS });
      if (!THUMB_PREFIXES.some((prefix) => thumb.startsWith(prefix))) {
        throw new IpcValidationError('thumb must be a JPEG data URL or a YouTube thumbnail');
      }
      out.thumb = thumb;
    }
  }
  return out;
}

export function spacesService(deps: SpacesServiceDeps) {
  const repo = spacesRepo(deps.db);
  const settings = settingsRepo(deps.db);
  const exists = deps.exists ?? existsSync;

  const resolve = (s: Space): string =>
    s.builtin && !isAbsolute(s.source) ? join(deps.assetsDir, s.source) : s.source;

  const list = (): Space[] =>
    repo.list().map((s) => (s.kind === 'youtube' ? s : { ...s, missing: !exists(resolve(s)) }));

  const find = (id: number): Space => {
    const s = repo.list().find((x) => x.id === id);
    if (!s) throw new IpcValidationError('No such space');
    return s;
  };

  return {
    list,

    /** The file a video or image space plays, for the media protocol; null for YouTube or unknown ids. */
    pathOf(id: number): string | null {
      const s = repo.list().find((x) => x.id === id);
      return s && s.kind !== 'youtube' ? resolve(s) : null;
    },

    /** Adds each path with a known extension, named after the file; a path already added is skipped. */
    addFiles(paths: string[]): Space[] {
      const known = new Set(repo.list().map((s) => s.source));
      for (const path of paths) {
        const kind = kindByExtension(path);
        if (!kind || known.has(path)) continue;
        repo.create({ kind, name: basename(path, extname(path)), source: path, thumb: null }, deps.now());
        known.add(path);
      }
      return list();
    },

    addYouTube(url: string): Space[] {
      const id = parseYouTubeId(url);
      if (!id) throw new IpcValidationError("That isn't a YouTube video link");
      if (!repo.list().some((s) => s.kind === 'youtube' && s.source === id)) {
        repo.create(
          { kind: 'youtube', name: `YouTube video ${id}`, source: id, thumb: youTubeThumb(id) },
          deps.now(),
        );
      }
      return list();
    },

    update(id: number, patch: unknown): Space[] {
      const clean = sanitiseSpacePatch(patch);
      if (!repo.update(id, clean)) throw new IpcValidationError('No such space');
      return list();
    },

    /** Removing the active space makes the first remaining one active (or none). */
    remove(id: number): Space[] {
      repo.remove(id);
      if (settings.get().activeSpaceId === id) settings.set({ activeSpaceId: repo.list()[0]?.id ?? null });
      return list();
    },

    /** Points a moved file at its new path; the new file must be the same kind (spec §3.8). */
    relocate(id: number, path: string): Space[] {
      const s = find(id);
      if (s.kind === 'youtube') throw new IpcValidationError('A YouTube space has no file to relocate');
      if (kindByExtension(path) !== s.kind) throw new IpcValidationError(`Choose a ${s.kind} file`);
      repo.update(id, { source: path });
      return list();
    },

    setActive(id: number): Space[] {
      find(id);
      settings.set({ activeSpaceId: id });
      return list();
    },
  };
}
