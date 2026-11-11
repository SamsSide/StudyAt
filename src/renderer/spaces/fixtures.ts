// Space fixtures for the spaces tests.
import type { Space } from '../../shared/types';

export const makeSpace = (over: Partial<Space> & { id: number }): Space => ({
  kind: 'video',
  name: `Space ${over.id}`,
  source: `C:/media/${over.id}.mp4`,
  thumb: null,
  favourite: false,
  builtin: false,
  opts: { audio: false, volume: 0.5, speed: 1, dim: 0.15, blur: 0, quality: 'auto' },
  createdAt: 0,
  missing: false,
  ...over,
});

export const sampleSpaces = (): Space[] => [
  makeSpace({ id: 1, kind: 'video', name: 'Rainy Window' }),
  makeSpace({
    id: 2,
    kind: 'image',
    name: 'Forest Path',
    source: 'images/forest-path.jpg',
    builtin: true,
    favourite: true,
  }),
  makeSpace({
    id: 3,
    kind: 'youtube',
    name: 'Lofi Cafe',
    source: 'dQw4w9WgXcQ',
    builtin: true,
    thumb: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
  }),
];
