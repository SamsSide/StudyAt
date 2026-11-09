import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Device, NowPlaying, Playlist } from '../../shared/types';
import { installMockApi, mockApi } from '../test/mockApi';
import { useStudyStore } from '../shell/store';
import { SpotifyWidget } from './SpotifyWidget';
import { usePolling } from './usePolling';

const track = {
  title: 'Song A',
  artist: 'Artist A',
  artUrl: 'https://i.scdn.co/image/abc',
  progressMs: 30_000,
  durationMs: 120_000,
};

type SpotifyOverrides = NonNullable<NonNullable<Parameters<typeof mockApi>[0]>['spotify']>;
const setup = (np: NowPlaying, extra: SpotifyOverrides = {}) => {
  const api = mockApi({
    spotify: { nowPlaying: vi.fn(() => Promise.resolve(np)), ...extra },
  });
  installMockApi(api);
  return api;
};

afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    value: false,
  });
});

describe('SpotifyWidget', () => {
  it('unconfigured shows "Set up Spotify in Settings"', async () => {
    setup({ state: 'unconfigured' });
    const onOpenSettings = vi.fn();
    render(<SpotifyWidget onOpenSettings={onOpenSettings} />);
    expect(await screen.findByText('Set up Spotify in Settings')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }));
    expect(onOpenSettings).toHaveBeenCalled();
  });

  it('shows no state message before the first answer, then the real state', async () => {
    let resolve: (v: NowPlaying) => void = () => undefined;
    const api = setup(
      { state: 'unconfigured' },
      {
        nowPlaying: vi.fn(() => new Promise<NowPlaying>((r) => (resolve = r))),
      },
    );
    render(<SpotifyWidget />);
    expect(api.spotify.nowPlaying).toHaveBeenCalled();
    expect(screen.queryByText('Set up Spotify in Settings')).toBeNull();
    expect(screen.queryByText('Spotify is offline')).toBeNull();
    await act(async () => resolve({ state: 'unconfigured' }));
    expect(await screen.findByText('Set up Spotify in Settings')).toBeInTheDocument();
  });

  it('opens settings through the shell store when no prop is given', async () => {
    setup({ state: 'unconfigured' });
    useStudyStore.getState().setOverlay(null);
    render(<SpotifyWidget />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open settings' }));
    expect(useStudyStore.getState().overlay).toBe('settings');
  });

  it('idle shows "Nothing playing"', async () => {
    setup({ state: 'idle' });
    render(<SpotifyWidget />);
    expect(await screen.findByText('Nothing playing')).toBeInTheDocument();
  });

  it('device select transfers playback when a device is chosen', async () => {
    const devices: Device[] = [
      { id: 'd1', name: 'Kitchen', type: 'Speaker', active: true },
      { id: 'd2', name: 'Desk', type: 'Computer', active: false },
    ];
    const api = setup({ state: 'playing', track }, { devices: vi.fn(() => Promise.resolve(devices)) });
    render(<SpotifyWidget />);
    await screen.findByRole('option', { name: 'Desk' });
    fireEvent.change(screen.getByLabelText('Device'), {
      target: { value: 'd2' },
    });
    await waitFor(() => expect(api.spotify.transfer).toHaveBeenCalledWith('d2'));
  });

  it('lists a device that appears after a later poll while no-device', async () => {
    vi.useFakeTimers();
    const kitchen: Device = {
      id: 'd1',
      name: 'Kitchen',
      type: 'Speaker',
      active: false,
    };
    const devices = vi.fn().mockResolvedValueOnce([]).mockResolvedValue([kitchen]);
    setup({ state: 'no-device' }, { devices });
    render(<SpotifyWidget />);
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(screen.queryByRole('button', { name: 'Kitchen' })).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(screen.getByRole('button', { name: 'Kitchen' })).toBeInTheDocument();
  });

  it('retries playlists on a later poll after a failure', async () => {
    vi.useFakeTimers();
    const lists: Playlist[] = [{ id: 'p1', name: 'Focus', uri: 'spotify:playlist:p1', imageUrl: null }];
    const playlists = vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValue(lists);
    setup({ state: 'playing', track }, { playlists });
    render(<SpotifyWidget />);
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(screen.queryByRole('option', { name: 'Focus' })).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(screen.getByRole('option', { name: 'Focus' })).toBeInTheDocument();
  });

  it('a slow older poll cannot overwrite a newer answer', async () => {
    vi.useFakeTimers();
    const resolvers: Array<(v: NowPlaying) => void> = [];
    const nowPlaying = vi.fn(() => new Promise<NowPlaying>((r) => resolvers.push(r)));
    setup({ state: 'idle' }, { nowPlaying });
    render(<SpotifyWidget />);
    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(resolvers).toHaveLength(2);
    await act(async () => resolvers[1]!({ state: 'playing', track }));
    await act(async () => resolvers[0]!({ state: 'offline' }));
    expect(screen.getByText('Song A')).toBeInTheDocument();
    expect(screen.queryByText('Spotify is offline')).toBeNull();
  });

  it('no-device shows the hint and device list', async () => {
    const devices: Device[] = [{ id: 'd1', name: 'Kitchen', type: 'Speaker', active: false }];
    const api = setup({ state: 'no-device' }, { devices: vi.fn(() => Promise.resolve(devices)) });
    render(<SpotifyWidget />);
    expect(await screen.findByText('Open Spotify on any device, then press play')).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Kitchen' }));
    await waitFor(() => expect(api.spotify.transfer).toHaveBeenCalledWith('d1'));
  });

  it('disconnected shows "Reconnect Spotify" which connects', async () => {
    const api = setup({ state: 'disconnected' });
    render(<SpotifyWidget />);
    fireEvent.click(await screen.findByRole('button', { name: 'Reconnect Spotify' }));
    await waitFor(() => expect(api.spotify.connect).toHaveBeenCalled());
  });

  it('offline shows "Spotify is offline"', async () => {
    setup({ state: 'offline' });
    render(<SpotifyWidget />);
    expect(await screen.findByText('Spotify is offline')).toBeInTheDocument();
  });

  it('playing shows title, artist, art and progress', async () => {
    setup({ state: 'playing', track });
    render(<SpotifyWidget />);
    expect(await screen.findByText('Song A')).toBeInTheDocument();
    expect(screen.getByText('Artist A')).toBeInTheDocument();
    expect(screen.getByAltText('Album art')).toHaveAttribute('src', 'https://i.scdn.co/image/abc');
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '30000');
  });

  it('styles the playing view with module classes, not global ones', async () => {
    setup({ state: 'playing', track });
    const { container } = render(<SpotifyWidget />);
    await screen.findByText('Song A');
    const moduleClass = (el: Element | null) => {
      const c = el?.getAttribute('class') ?? '';
      expect(c).not.toBe('');
      expect(c.startsWith('spotify')).toBe(false);
    };
    const bar = screen.getByRole('progressbar');
    moduleClass(bar);
    moduleClass(bar.firstElementChild);
    const pause = screen.getByRole('button', { name: 'Pause' });
    moduleClass(pause.parentElement);
    for (const name of ['Previous', 'Pause', 'Next']) {
      moduleClass(screen.getByRole('button', { name }));
    }
    expect(pause.className).not.toBe(screen.getByRole('button', { name: 'Next' }).className);
    moduleClass(screen.getByLabelText('Playlist'));
    expect(container.querySelector('[class^="spotify"]')).toBeNull();
  });

  it.each([
    [{ state: 'unconfigured' } as NowPlaying, 'Set up Spotify in Settings'],
    [{ state: 'disconnected' } as NowPlaying, 'Reconnect Spotify'],
    [{ state: 'offline' } as NowPlaying, 'Spotify is offline'],
    [{ state: 'no-device' } as NowPlaying, 'Open Spotify on any device, then press play'],
  ])('styles the %o view with module classes, not global ones', async (np, text) => {
    setup(np);
    const { container } = render(<SpotifyWidget />);
    const el = await screen.findByText(text);
    const root = container.firstElementChild;
    for (const node of [root, el, container.querySelector('svg')?.parentElement ?? null]) {
      const c = node?.getAttribute('class') ?? '';
      expect(c).not.toBe('');
      expect(c.startsWith('spotify')).toBe(false);
    }
    expect(container.querySelector('[class^="spotify"]')).toBeNull();
  });

  it('holds its place with the same root class before the first answer', async () => {
    setup({ state: 'unconfigured' }, { nowPlaying: vi.fn(() => new Promise<NowPlaying>(() => undefined)) });
    const { container } = render(<SpotifyWidget />);
    const busy = container.firstElementChild as HTMLElement;
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(busy.getAttribute('class') ?? '').not.toBe('');
    expect(busy.className.startsWith('spotify')).toBe(false);
  });

  it('with no device the transport is dimmed, marked unavailable and does nothing', async () => {
    const api = setup({ state: 'no-device' });
    render(<SpotifyWidget />);
    await screen.findByText('Open Spotify on any device, then press play');
    for (const name of ['Previous', 'Play', 'Next']) {
      const b = screen.getByRole('button', { name });
      expect(b).toHaveAttribute('aria-disabled', 'true');
      fireEvent.click(b);
    }
    expect(api.spotify.play).not.toHaveBeenCalled();
    expect(api.spotify.previous).not.toHaveBeenCalled();
    expect(api.spotify.next).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Playlist')).toBeDisabled();
  });

  it('buttons call previous/pause/next', async () => {
    const api = setup({ state: 'playing', track });
    render(<SpotifyWidget />);
    fireEvent.click(await screen.findByRole('button', { name: 'Previous' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => {
      expect(api.spotify.previous).toHaveBeenCalled();
      expect(api.spotify.pause).toHaveBeenCalled();
      expect(api.spotify.next).toHaveBeenCalled();
    });
  });

  it('play button plays when paused, and a rejection does not crash', async () => {
    const api = setup({ state: 'paused', track }, { play: vi.fn(() => Promise.reject(new Error('x'))) });
    render(<SpotifyWidget />);
    fireEvent.click(await screen.findByRole('button', { name: 'Play' }));
    await waitFor(() => expect(api.spotify.play).toHaveBeenCalled());
    expect(await screen.findByText('Song A')).toBeInTheDocument();
    await waitFor(() =>
      expect(vi.mocked(api.spotify.nowPlaying).mock.calls.length).toBeGreaterThanOrEqual(2),
    );
  });

  it('a rejected nowPlaying shows offline and the next poll recovers', async () => {
    vi.useFakeTimers();
    const nowPlaying = vi
      .fn()
      .mockRejectedValueOnce(new Error('net'))
      .mockResolvedValue({ state: 'playing', track });
    const api = setup({ state: 'idle' }, { nowPlaying });
    render(<SpotifyWidget />);
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(screen.getByText('Spotify is offline')).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(api.spotify.nowPlaying).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Song A')).toBeInTheDocument();
  });

  it('playlist choice calls playContext(uri)', async () => {
    const lists: Playlist[] = [{ id: 'p1', name: 'Focus', uri: 'spotify:playlist:p1', imageUrl: null }];
    const api = setup({ state: 'playing', track }, { playlists: vi.fn(() => Promise.resolve(lists)) });
    render(<SpotifyWidget />);
    await screen.findByRole('option', { name: 'Focus' });
    fireEvent.change(screen.getByLabelText('Playlist'), {
      target: { value: 'spotify:playlist:p1' },
    });
    await waitFor(() => expect(api.spotify.playContext).toHaveBeenCalledWith('spotify:playlist:p1'));
  });

  it('polls every 3 s only while mounted and visible', async () => {
    vi.useFakeTimers();
    const api = setup({ state: 'playing', track });
    const { unmount } = render(<SpotifyWidget />);
    const calls = () => vi.mocked(api.spotify.nowPlaying).mock.calls.length;
    expect(calls()).toBe(1);
    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(calls()).toBe(2);

    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event('visibilitychange'));
    await act(() => vi.advanceTimersByTimeAsync(9000));
    expect(calls()).toBe(2);

    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: false,
    });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(calls()).toBe(3);

    unmount();
    await act(() => vi.advanceTimersByTimeAsync(9000));
    expect(calls()).toBe(3);
  });

  it('usePolling does nothing while disabled', async () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const Probe = () => {
      usePolling(fn, 1000, false);
      return null;
    };
    render(<Probe />);
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(fn).not.toHaveBeenCalled();
  });
});
