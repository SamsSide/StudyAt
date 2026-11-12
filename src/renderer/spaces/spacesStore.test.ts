import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Space } from '../../shared/types';
import { installMockApi, mockApi } from '../test/mockApi';
import { makeSpace } from './fixtures';
import { resetSpacesStore, useSpacesStore } from './spacesStore';

const deferred = <T>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

const withDim = (dim: number): Space =>
  makeSpace({ id: 1, opts: { audio: false, volume: 0.5, speed: 1, dim, blur: 0, quality: 'auto' } });

beforeEach(() => resetSpacesStore());

describe('spacesStore.update', () => {
  it('ignores a stale reply that lands after a newer update for the same space', async () => {
    const first = deferred<Space[]>();
    const second = deferred<Space[]>();
    const update = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    installMockApi(mockApi({ spaces: { update } }));
    useSpacesStore.setState({ spaces: [withDim(0.1)], activeId: 1, loaded: true });

    const a = useSpacesStore.getState().update(1, { opts: { dim: 0.2 } });
    const b = useSpacesStore.getState().update(1, { opts: { dim: 0.3 } });
    second.resolve([withDim(0.3)]);
    await b;
    first.resolve([withDim(0.2)]);
    await a;
    expect(useSpacesStore.getState().spaces[0]?.opts.dim).toBe(0.3);
  });

  it('a rejected update reloads the list, so the optimistic change is rolled back', async () => {
    const list = vi.fn(() => Promise.resolve([withDim(0.1)]));
    const update = vi.fn(() => Promise.reject(new Error('disk full')));
    installMockApi(mockApi({ spaces: { update, list } }));
    useSpacesStore.setState({ spaces: [withDim(0.1)], activeId: 1, loaded: true });

    await expect(useSpacesStore.getState().update(1, { opts: { dim: 0.5 } })).resolves.toBeUndefined();
    expect(list).toHaveBeenCalled();
    expect(useSpacesStore.getState().spaces[0]?.opts.dim).toBe(0.1);
  });
});

describe('spacesStore.setActive', () => {
  it('a failed switch puts the previous space back and rejects', async () => {
    installMockApi(mockApi({ spaces: { setActive: vi.fn(() => Promise.reject(new Error('db'))) } }));
    useSpacesStore.setState({ spaces: [withDim(0.1)], activeId: 1, loaded: true });
    await expect(useSpacesStore.getState().setActive(2)).rejects.toThrow('db');
    expect(useSpacesStore.getState().activeId).toBe(1);
  });

  it('clears a "can\'t be played" mark so the space retries, but keeps an embed block', async () => {
    installMockApi(mockApi());
    useSpacesStore.setState({
      spaces: [withDim(0.1)],
      activeId: null,
      loaded: true,
      embedErrors: { 1: 'play', 2: 'embed' },
    });
    await useSpacesStore.getState().setActive(1);
    await useSpacesStore.getState().setActive(2);
    expect(useSpacesStore.getState().embedErrors).toEqual({ 2: 'embed' });
  });
});

describe('spacesStore.load', () => {
  it('a failed load never rejects: it marks loadFailed, logs, and a later load clears it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const list = vi
      .fn()
      .mockRejectedValueOnce(new Error('EACCES'))
      .mockResolvedValue([makeSpace({ id: 1 })]);
    installMockApi(mockApi({ spaces: { list } }));
    await expect(useSpacesStore.getState().load()).resolves.toBeUndefined();
    expect(useSpacesStore.getState()).toMatchObject({ loaded: false, loadFailed: true });
    expect(warn).toHaveBeenCalled();
    await useSpacesStore.getState().load();
    expect(useSpacesStore.getState()).toMatchObject({ loaded: true, loadFailed: false });
    expect(useSpacesStore.getState().spaces).toHaveLength(1);
    warn.mockRestore();
  });
});

describe('spacesStore.backgroundPaused (spec §3.4)', () => {
  const youtube = makeSpace({ id: 3, kind: 'youtube', source: 'dQw4w9WgXcQ' });
  const image = makeSpace({ id: 2, kind: 'image', source: 'images/a.jpg' });
  const seed = (activeId: number) =>
    useSpacesStore.setState({ spaces: [makeSpace({ id: 1 }), image, youtube], activeId, loaded: true });

  it('starts playing', () => {
    expect(useSpacesStore.getState().backgroundPaused).toBe(false);
  });

  it('toggleBackground flips it for a YouTube or video space', () => {
    seed(3);
    useSpacesStore.getState().toggleBackground();
    expect(useSpacesStore.getState().backgroundPaused).toBe(true);
    useSpacesStore.getState().toggleBackground();
    expect(useSpacesStore.getState().backgroundPaused).toBe(false);
    seed(1);
    useSpacesStore.getState().toggleBackground();
    expect(useSpacesStore.getState().backgroundPaused).toBe(true);
  });

  it('toggleBackground does nothing for an image space or with no active space', () => {
    seed(2);
    useSpacesStore.getState().toggleBackground();
    expect(useSpacesStore.getState().backgroundPaused).toBe(false);
    useSpacesStore.setState({ activeId: null });
    useSpacesStore.getState().toggleBackground();
    expect(useSpacesStore.getState().backgroundPaused).toBe(false);
  });

  it('setActive to another space resets it to playing', async () => {
    installMockApi(mockApi());
    seed(3);
    useSpacesStore.getState().setBackgroundPaused(true);
    await useSpacesStore.getState().setActive(1);
    expect(useSpacesStore.getState().backgroundPaused).toBe(false);
  });

  it('any change of the active id resets it, e.g. a load that finds another space', () => {
    seed(3);
    useSpacesStore.getState().setBackgroundPaused(true);
    useSpacesStore.setState({ activeId: 1 });
    expect(useSpacesStore.getState().backgroundPaused).toBe(false);
  });

  it('apply keeps the pause while the active space is unchanged', () => {
    seed(3);
    useSpacesStore.getState().setBackgroundPaused(true);
    useSpacesStore.getState().apply([makeSpace({ id: 1 }), image, youtube]);
    expect(useSpacesStore.getState().backgroundPaused).toBe(true);
  });

  it('apply resets it when the active space is no longer in the list', () => {
    seed(3);
    useSpacesStore.getState().setBackgroundPaused(true);
    useSpacesStore.getState().apply([makeSpace({ id: 1 }), image]);
    expect(useSpacesStore.getState().backgroundPaused).toBe(false);
  });
});
