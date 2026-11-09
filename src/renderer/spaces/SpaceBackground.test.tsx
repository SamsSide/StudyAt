import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../shared/settings';
import type { Space } from '../../shared/types';
import { installMockApi, mockApi } from '../test/mockApi';
import { makeSpace } from './fixtures';
import { resetSpacesStore, useSpacesStore } from './spacesStore';
import { spaceAudio } from './spaceAudio';
import { SpaceBackground } from './SpaceBackground';
import { useWindowVisibility } from './windowVisibility';
import { YT_SCRIPT, type YTPlayerOptions } from './youtube';

const mount = async (spaces: Space[], activeId: number | null = spaces[0]?.id ?? null) => {
  const { spotifyTokens: _t, ...pub } = structuredClone(DEFAULT_SETTINGS);
  const api = mockApi({
    spaces: {
      list: vi.fn(() => Promise.resolve(spaces)),
      update: vi.fn(() => Promise.resolve(useSpacesStore.getState().spaces)),
    },
    settings: { get: vi.fn(() => Promise.resolve({ ...pub, activeSpaceId: activeId })) },
  });
  installMockApi(api);
  render(<SpaceBackground />);
  await waitFor(() => expect(useSpacesStore.getState().loaded).toBe(true));
  return api;
};

beforeEach(() => {
  resetSpacesStore();
  useWindowVisibility.setState({ visible: true });
  // jsdom has no media playback: stub it so no test logs "not implemented" noise.
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
});
afterEach(() => {
  delete window.YT;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('SpaceBackground', () => {
  it('renders dim overlay with opts.dim opacity', async () => {
    const s = makeSpace({ id: 1, opts: { audio: false, volume: 0.5, speed: 1, dim: 0.4, blur: 6 } });
    await mount([s]);
    const dim = await screen.findByTestId('space-dim');
    expect(dim).toHaveStyle({ opacity: '0.4' });
  });

  it('a local video uses the media protocol, muted, looping, at its speed', async () => {
    await mount([makeSpace({ id: 7, opts: { audio: false, volume: 0.5, speed: 1.5, dim: 0, blur: 0 } })]);
    const v = (await screen.findByTestId('space-video')) as HTMLVideoElement;
    expect(v.getAttribute('src')).toBe('studyat-media://space/7');
    expect(v.loop).toBe(true);
    expect(v.muted).toBe(true);
    expect(v.playbackRate).toBe(1.5);
  });

  it('a failed first load says so over the empty background, and "Try again" loads the space', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { spotifyTokens: _t, ...pub } = structuredClone(DEFAULT_SETTINGS);
    const list = vi
      .fn()
      .mockRejectedValueOnce(new Error("EACCES: permission denied, open 'C:\\studyat.db'"))
      .mockResolvedValue([makeSpace({ id: 1, kind: 'image' })]);
    installMockApi(
      mockApi({
        spaces: { list },
        settings: { get: vi.fn(() => Promise.resolve({ ...pub, activeSpaceId: 1 })) },
      }),
    );
    render(<SpaceBackground />);
    expect(await screen.findByText("Couldn't load your spaces.")).toBeInTheDocument();
    expect(screen.getByTestId('space-background')).not.toHaveTextContent('EACCES');
    expect(warn).toHaveBeenCalled();
    await act(async () => screen.getByRole('button', { name: 'Try again' }).click());
    expect(await screen.findByTestId('space-image')).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load your spaces.")).not.toBeInTheDocument();
  });

  it('shows a relocate state for a missing file', async () => {
    const api = await mount([makeSpace({ id: 1, missing: true })]);
    await act(async () => screen.getByRole('button', { name: 'File moved — Relocate…' }).click());
    expect(api.spaces.relocate).toHaveBeenCalledWith(1);
  });

  it('the relocate notice sits above the blurred media and the dim, even with a thumbnail', async () => {
    const thumb = 'data:image/jpeg;base64,AAA';
    await mount([
      makeSpace({
        id: 1,
        missing: true,
        thumb,
        opts: { audio: false, volume: 0.5, speed: 1, dim: 0.3, blur: 6 },
      }),
    ]);
    const button = screen.getByRole('button', { name: 'File moved — Relocate…' });
    const layer = screen.getByTestId('space-layer');
    const dim = screen.getByTestId('space-dim');
    expect(layer.querySelector(`img[src="${thumb}"]`)).not.toBeNull();
    expect(layer).not.toContainElement(button);
    // Painted after the dim, so the dim and the blur never cover it.
    expect(dim.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('pauses a video while the window is minimised or hidden to the tray', async () => {
    await mount([makeSpace({ id: 1 })]);
    const v = (await screen.findByTestId('space-video')) as HTMLVideoElement;
    const pause = vi.spyOn(v, 'pause').mockImplementation(() => undefined);
    const play = vi.spyOn(v, 'play').mockImplementation(() => Promise.resolve());
    act(() => useWindowVisibility.getState().setVisible(false));
    expect(pause).toHaveBeenCalled();
    act(() => useWindowVisibility.getState().setVisible(true));
    expect(play).toHaveBeenCalled();
  });

  it('pauses a video while the document is hidden', async () => {
    await mount([makeSpace({ id: 1 })]);
    const v = (await screen.findByTestId('space-video')) as HTMLVideoElement;
    const pause = vi.spyOn(v, 'pause').mockImplementation(() => undefined);
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    expect(pause).toHaveBeenCalled();
  });

  describe('YouTube', () => {
    const yt = (space: Space) => {
      let opts: YTPlayerOptions | undefined;
      const player = {
        playVideo: vi.fn(),
        pauseVideo: vi.fn(),
        mute: vi.fn(),
        unMute: vi.fn(),
        setVolume: vi.fn(),
        setPlaybackRate: vi.fn(),
        destroy: vi.fn(),
        unloadModule: vi.fn(),
        setOption: vi.fn(),
      };
      class FakePlayer {
        constructor(_el: HTMLElement, o: YTPlayerOptions) {
          opts = o;
          return player as unknown as FakePlayer;
        }
      }
      window.YT = { Player: FakePlayer as never };
      return { player, opts: () => opts, space };
    };
    const space = makeSpace({ id: 3, kind: 'youtube', source: 'dQw4w9WgXcQ', thumb: 'data:x' });

    it('creates the player with the spec params', async () => {
      const h = yt(space);
      await mount([space]);
      await waitFor(() => expect(h.opts()).toBeDefined());
      expect(h.opts()?.videoId).toBe('dQw4w9WgXcQ');
      expect(h.opts()?.playerVars).toMatchObject({
        mute: 1,
        controls: 0,
        loop: 1,
        playlist: 'dQw4w9WgXcQ',
        playsinline: 1,
        rel: 0,
        modestbranding: 1,
        origin: window.location.origin,
      });
    });

    it('asks for no captions, no annotations, no keyboard and no fullscreen button', async () => {
      const h = yt(space);
      await mount([space]);
      await waitFor(() => expect(h.opts()).toBeDefined());
      expect(h.opts()?.playerVars).toMatchObject({
        cc_load_policy: 0,
        iv_load_policy: 3,
        disablekb: 1,
        fs: 0,
      });
    });

    it('turns captions off once the player is ready, even when the video forces them', async () => {
      const h = yt(space);
      await mount([space]);
      await waitFor(() => expect(h.opts()).toBeDefined());
      act(() => h.opts()?.events.onReady?.());
      expect(h.player.unloadModule).toHaveBeenCalledWith('captions');
      expect(h.player.setOption).toHaveBeenCalledWith('captions', 'track', {});
    });

    it('coming back online retries a video that could not play', async () => {
      const h = yt(space);
      await mount([space]);
      await waitFor(() => expect(h.opts()).toBeDefined());
      act(() => h.opts()?.events.onError?.({ data: 5 }));
      expect(await screen.findByText("This video can't be played.")).toBeInTheDocument();
      act(() => void window.dispatchEvent(new Event('online')));
      expect(screen.queryByText("This video can't be played.")).not.toBeInTheDocument();
      expect(screen.getByTestId('space-youtube')).toBeInTheDocument();
    });

    it('coming back online keeps an embed block', async () => {
      const h = yt(space);
      await mount([space]);
      await waitFor(() => expect(h.opts()).toBeDefined());
      act(() => h.opts()?.events.onError?.({ data: 150 }));
      act(() => void window.dispatchEvent(new Event('online')));
      expect(screen.getByText("This video can't be embedded.")).toBeInTheDocument();
    });

    it.each([2, 5, 100])('error %i shows the thumbnail and "This video can\'t be played."', async (code) => {
      const h = yt(space);
      await mount([space]);
      await waitFor(() => expect(h.opts()).toBeDefined());
      act(() => h.opts()?.events.onError?.({ data: code }));
      expect(await screen.findByText("This video can't be played.")).toBeInTheDocument();
      expect(screen.getByTestId('space-layer').querySelector('img[src="data:x"]')).not.toBeNull();
    });

    it('logs every player error code', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const h = yt(space);
      await mount([space]);
      await waitFor(() => expect(h.opts()).toBeDefined());
      act(() => h.opts()?.events.onError?.({ data: 5 }));
      expect(warn).toHaveBeenCalledWith('[spaces] YouTube error', 5);
      warn.mockRestore();
    });

    it('an error after the video has played is only logged, never marked', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const h = yt(space);
      await mount([space]);
      await waitFor(() => expect(h.opts()).toBeDefined());
      act(() => h.opts()?.events.onStateChange?.({ data: 1 }));
      act(() => h.opts()?.events.onError?.({ data: 5 }));
      expect(warn).toHaveBeenCalledWith('[spaces] YouTube error', 5);
      expect(useSpacesStore.getState().embedErrors[3]).toBeUndefined();
      expect(screen.queryByText("This video can't be played.")).not.toBeInTheDocument();
      expect(screen.getByTestId('space-youtube')).toBeInTheDocument();
      warn.mockRestore();
    });

    it('a passing error code (not 2, 5, 100, 101 or 150) is never marked', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const h = yt(space);
      await mount([space]);
      await waitFor(() => expect(h.opts()).toBeDefined());
      act(() => h.opts()?.events.onError?.({ data: 3 }));
      expect(warn).toHaveBeenCalledWith('[spaces] YouTube error', 3);
      expect(useSpacesStore.getState().embedErrors[3]).toBeUndefined();
      expect(screen.getByTestId('space-youtube')).toBeInTheDocument();
      warn.mockRestore();
    });

    it('reaching PLAYING clears a mark the player set before', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const h = yt(space);
      await mount([space]);
      await waitFor(() => expect(h.opts()).toBeDefined());
      act(() => {
        h.opts()?.events.onError?.({ data: 5 });
        expect(useSpacesStore.getState().embedErrors[3]).toBe('play');
        h.opts()?.events.onStateChange?.({ data: 1 });
      });
      expect(useSpacesStore.getState().embedErrors[3]).toBeUndefined();
      expect(screen.queryByText("This video can't be played.")).not.toBeInTheDocument();
      warn.mockRestore();
    });

    it('a failed API script load shows "This video can\'t be played."', async () => {
      await mount([space]);
      const script = await waitFor(() => {
        const el = document.head.querySelector(`script[src="${YT_SCRIPT}"]`);
        expect(el).not.toBeNull();
        return el as HTMLScriptElement;
      });
      act(() => void script.dispatchEvent(new Event('error')));
      expect(await screen.findByText("This video can't be played.")).toBeInTheDocument();
      script.remove();
    });

    it('error 150 shows the embed message', async () => {
      const h = yt(space);
      await mount([space]);
      await waitFor(() => expect(h.opts()).toBeDefined());
      act(() => h.opts()?.events.onError?.({ data: 150 }));
      expect(await screen.findByText("This video can't be embedded.")).toBeInTheDocument();
    });

    it('offline shows the thumbnail and "Offline"', async () => {
      yt(space);
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
      await mount([space]);
      expect(await screen.findByText('Offline')).toBeInTheDocument();
    });

    it('applies the audio volume to the player via spaceAudio', async () => {
      const h = yt(space);
      const api = await mount([space]);
      await waitFor(() => expect(h.opts()).toBeDefined());
      act(() => h.opts()?.events.onReady?.());
      act(() => spaceAudio.set(0.8));
      await waitFor(() => expect(h.player.unMute).toHaveBeenCalled());
      expect(h.player.setVolume).toHaveBeenLastCalledWith(80);
      expect(api.spaces.update).toHaveBeenCalledWith(3, { opts: { volume: 0.8, audio: true } });
      expect(spaceAudio.get()).toBe(0.8);
    });
  });

  describe('reduced motion', () => {
    it('stays on the still until play is pressed', async () => {
      vi.stubGlobal('matchMedia', (q: string) => ({
        matches: q.includes('reduce'),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }));
      await mount([makeSpace({ id: 1, thumb: 'data:image/jpeg;base64,AAA' })]);
      expect(screen.queryByTestId('space-video')).not.toBeInTheDocument();
      act(() => screen.getByRole('button', { name: 'Play background' }).click());
      expect(await screen.findByTestId('space-video')).toBeInTheDocument();
    });

    it('the footer toggles back to the still', async () => {
      vi.stubGlobal('matchMedia', (q: string) => ({
        matches: q.includes('reduce'),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }));
      await mount([makeSpace({ id: 1, thumb: 'data:image/jpeg;base64,AAA' })]);
      act(() => screen.getByRole('button', { name: 'Play background' }).click());
      expect(await screen.findByTestId('space-video')).toBeInTheDocument();
      act(() => screen.getByRole('button', { name: 'Pause background' }).click());
      expect(screen.queryByTestId('space-video')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Play background' })).toBeInTheDocument();
    });

    const reducedMotion = () =>
      vi.stubGlobal('matchMedia', (q: string) => ({
        matches: q.includes('reduce'),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }));
    const tube = makeSpace({ id: 3, kind: 'youtube', source: 'dQw4w9WgXcQ', thumb: 'data:x' });

    it('has no play button while a YouTube space is offline', async () => {
      reducedMotion();
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
      await mount([tube]);
      expect(await screen.findByText('Offline')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Play background' })).not.toBeInTheDocument();
    });

    it.each(['embed', 'play'] as const)(
      'has no play button while a YouTube space shows a %s error',
      async (kind) => {
        reducedMotion();
        await mount([tube]);
        act(() => useSpacesStore.getState().markEmbedError(3, kind));
        expect(screen.queryByRole('button', { name: 'Play background' })).not.toBeInTheDocument();
      },
    );
  });
});
