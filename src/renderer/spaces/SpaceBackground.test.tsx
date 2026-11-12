import { act, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../shared/settings';
import type { Space } from '../../shared/types';
import { TopBar } from '../shell/TopBar';
import { installMockApi, mockApi } from '../test/mockApi';
import { makeSpace } from './fixtures';
import { useYouTubeQuality } from './qualityStore';
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
    const s = makeSpace({
      id: 1,
      opts: { audio: false, volume: 0.5, speed: 1, dim: 0.4, blur: 6, quality: 'auto' },
    });
    await mount([s]);
    const dim = await screen.findByTestId('space-dim');
    expect(dim).toHaveStyle({ opacity: '0.4' });
  });

  it('a local video uses the media protocol, muted, looping, at its speed', async () => {
    await mount([
      makeSpace({ id: 7, opts: { audio: false, volume: 0.5, speed: 1.5, dim: 0, blur: 0, quality: 'auto' } }),
    ]);
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
        opts: { audio: false, volume: 0.5, speed: 1, dim: 0.3, blur: 6, quality: 'auto' },
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

  describe('background pause (spec §3.4)', () => {
    it('pausing the background pauses a local video, and playing again resumes it', async () => {
      await mount([makeSpace({ id: 1 })]);
      const v = (await screen.findByTestId('space-video')) as HTMLVideoElement;
      const pause = vi.spyOn(v, 'pause').mockImplementation(() => undefined);
      const play = vi.spyOn(v, 'play').mockImplementation(() => Promise.resolve());
      act(() => useSpacesStore.getState().setBackgroundPaused(true));
      expect(pause).toHaveBeenCalled();
      act(() => useSpacesStore.getState().setBackgroundPaused(false));
      expect(play).toHaveBeenCalled();
    });

    it('an image space is unaffected', async () => {
      await mount([makeSpace({ id: 2, kind: 'image', source: 'images/a.jpg' })]);
      const img = await screen.findByTestId('space-image');
      act(() => useSpacesStore.getState().setBackgroundPaused(true));
      expect(screen.getByTestId('space-image')).toBe(img);
    });

    it('a YouTube player is paused and played with it', async () => {
      const pauseVideo = vi.fn();
      const playVideo = vi.fn();
      let opts: YTPlayerOptions | undefined;
      const player = {
        playVideo,
        pauseVideo,
        mute: vi.fn(),
        unMute: vi.fn(),
        setVolume: vi.fn(),
        setPlaybackRate: vi.fn(),
        destroy: vi.fn(),
        unloadModule: vi.fn(),
        setOption: vi.fn(),
        getPlaybackQuality: vi.fn(() => 'hd1080'),
        setPlaybackQuality: vi.fn(),
      };
      class FakePlayer {
        constructor(_el: HTMLElement, o: YTPlayerOptions) {
          opts = o;
          return player as unknown as FakePlayer;
        }
      }
      window.YT = { Player: FakePlayer as never };
      await mount([makeSpace({ id: 3, kind: 'youtube', source: 'dQw4w9WgXcQ', thumb: 'data:x' })]);
      await waitFor(() => expect(opts).toBeDefined());
      act(() => opts?.events.onReady?.());
      pauseVideo.mockClear();
      playVideo.mockClear();
      act(() => useSpacesStore.getState().setBackgroundPaused(true));
      expect(pauseVideo).toHaveBeenCalled();
      act(() => useSpacesStore.getState().setBackgroundPaused(false));
      expect(playVideo).toHaveBeenCalled();
    });
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
        getPlaybackQuality: vi.fn(() => 'hd1080'),
        setPlaybackQuality: vi.fn(),
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

    describe('quality (spec §3.3)', () => {
      const q = (quality: 'auto' | '2160') =>
        makeSpace({
          id: 3,
          kind: 'youtube',
          source: 'dQw4w9WgXcQ',
          opts: { audio: false, volume: 0.5, speed: 1, dim: 0, blur: 0, quality },
        });
      beforeEach(() => {
        useYouTubeQuality.getState().clear();
        vi.stubGlobal('devicePixelRatio', 1);
        vi.stubGlobal('innerWidth', 1920);
        vi.stubGlobal('innerHeight', 1080);
      });

      it('4K sizes the player to 3840 x 2160 CSS px, covers the window and asks for hd2160', async () => {
        const s = q('2160');
        const h = yt(s);
        await mount([s]);
        await waitFor(() => expect(h.opts()).toBeDefined());
        const host = screen.getByTestId('space-youtube');
        expect(host).toHaveStyle({ width: '3840px', height: '2160px' });
        expect(host.style.transform).toBe('translate(-50%, -50%) scale(0.6)');
        act(() => h.opts()?.events.onReady?.());
        expect(h.player.setPlaybackQuality).toHaveBeenCalledWith('hd2160');
      });

      it('resizing recomputes the cover scale', async () => {
        const s = q('2160');
        const h = yt(s);
        await mount([s]);
        await waitFor(() => expect(h.opts()).toBeDefined());
        vi.stubGlobal('innerHeight', 1200);
        act(() => void window.dispatchEvent(new Event('resize')));
        expect(screen.getByTestId('space-youtube').style.transform).toBe(
          `translate(-50%, -50%) scale(${((1.2 * 1200) / 2160).toFixed(6)})`,
        );
      });

      it('an unknown stored quality behaves as Auto', async () => {
        const s = q('2160');
        s.opts.quality = 'bogus' as never;
        const h = yt(s);
        await mount([s]);
        await waitFor(() => expect(h.opts()).toBeDefined());
        act(() => h.opts()?.events.onReady?.());
        expect(screen.getByTestId('space-youtube').style.transform).toBe('');
        expect(h.player.setPlaybackQuality).not.toHaveBeenCalled();
      });

      it('Auto sets no size and never asks for a level', async () => {
        const s = q('auto');
        const h = yt(s);
        await mount([s]);
        await waitFor(() => expect(h.opts()).toBeDefined());
        act(() => h.opts()?.events.onReady?.());
        const host = screen.getByTestId('space-youtube');
        expect(host.style.width).toBe('');
        expect(host.style.transform).toBe('');
        expect(h.player.setPlaybackQuality).not.toHaveBeenCalled();
      });

      it('reads the playing level every 5 s and when the player reports a change', async () => {
        const s = q('auto');
        const h = yt(s);
        await mount([s]);
        await waitFor(() => expect(h.opts()).toBeDefined());
        vi.useFakeTimers();
        try {
          act(() => h.opts()?.events.onReady?.());
          act(() => h.opts()?.events.onStateChange?.({ data: 1 }));
          expect(h.player.getPlaybackQuality).not.toHaveBeenCalled();
          act(() => void vi.advanceTimersByTime(5000));
          expect(h.player.getPlaybackQuality).toHaveBeenCalledTimes(1);
          expect(useYouTubeQuality.getState()).toMatchObject({ spaceId: 3, level: 'hd1080', playing: true });
          act(() => void vi.advanceTimersByTime(5000));
          expect(h.player.getPlaybackQuality).toHaveBeenCalledTimes(2);
          act(() => h.opts()?.events.onPlaybackQualityChange?.({ data: 'hd1440' }));
          expect(useYouTubeQuality.getState().level).toBe('hd1440');
        } finally {
          vi.useRealTimers();
        }
      });
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
      expect(useSpacesStore.getState().embedErrors[3]).toBe('embed');
    });

    it('error 153 is a configuration error: a play message, not an embed block', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const h = yt(space);
      await mount([space]);
      await waitFor(() => expect(h.opts()).toBeDefined());
      act(() => h.opts()?.events.onError?.({ data: 153 }));
      expect(await screen.findByText("This video can't be played.")).toBeInTheDocument();
      expect(useSpacesStore.getState().embedErrors[3]).toBe('play');
      expect(warn).toHaveBeenCalledWith('[spaces] YouTube player configuration error 153');
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

    it('the footer follows a pause made elsewhere, and playing clears it', async () => {
      vi.stubGlobal('matchMedia', (q: string) => ({
        matches: q.includes('reduce'),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }));
      await mount([makeSpace({ id: 1, thumb: 'data:image/jpeg;base64,AAA' })]);
      act(() => screen.getByRole('button', { name: 'Play background' }).click());
      expect(await screen.findByTestId('space-video')).toBeInTheDocument();
      act(() => useSpacesStore.getState().setBackgroundPaused(true));
      expect(screen.getByRole('button', { name: 'Play background' })).toBeInTheDocument();
      act(() => screen.getByRole('button', { name: 'Play background' }).click());
      expect(useSpacesStore.getState().backgroundPaused).toBe(false);
      expect(screen.getByRole('button', { name: 'Pause background' })).toBeInTheDocument();
    });

    const reducedMotion = () =>
      vi.stubGlobal('matchMedia', (q: string) => ({
        matches: q.includes('reduce'),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }));
    const tube = makeSpace({ id: 3, kind: 'youtube', source: 'dQw4w9WgXcQ', thumb: 'data:x' });

    it('the footer and the top bar never disagree, and a space change resets both', async () => {
      reducedMotion();
      await mount([tube, makeSpace({ id: 4, kind: 'youtube', source: 'abcdefghijk', thumb: 'data:y' })]);
      render(<TopBar />);
      const labels = () =>
        screen
          .getAllByRole('button', { name: /background$/ })
          .map((b) => b.getAttribute('aria-label') ?? b.textContent);
      expect(labels()).toEqual(['Play background', 'Play background']);
      act(() => within(screen.getByRole('banner')).getByRole('button', { name: 'Play background' }).click());
      expect(labels()).toEqual(['Pause background', 'Pause background']);
      act(() =>
        within(screen.getByTestId('space-background'))
          .getByRole('button', { name: 'Pause background' })
          .click(),
      );
      expect(labels()).toEqual(['Play background', 'Play background']);
      act(() => useSpacesStore.getState().playBackground());
      act(() => useSpacesStore.setState({ activeId: 4 }));
      expect(labels()).toEqual(['Play background', 'Play background']);
    });

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
