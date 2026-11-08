import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Device, NowPlaying, Playlist } from '../../shared/types';
import { installMockApi, mockApi } from '../test/mockApi';
import { SpotifyWidget } from './SpotifyWidget';

const track = {
  title: 'Song A',
  artist: 'Artist A',
  artUrl: 'https://i.scdn.co/image/abc',
  progressMs: 30_000,
  durationMs: 120_000,
};

type SpotifyOverrides = NonNullable<Parameters<typeof mockApi>[0]['spotify']>;
const setup = (np: NowPlaying, extra: SpotifyOverrides = {}) => {
  const api = mockApi({ spotify: { nowPlaying: vi.fn(() => Promise.resolve(np)), ...extra } });
  installMockApi(api);
  return api;
};

afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
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
  });

  it('playlist choice calls playContext(uri)', async () => {
    const lists: Playlist[] = [{ id: 'p1', name: 'Focus', uri: 'spotify:playlist:p1', imageUrl: null }];
    const api = setup({ state: 'playing', track }, { playlists: vi.fn(() => Promise.resolve(lists)) });
    render(<SpotifyWidget />);
    await screen.findByRole('option', { name: 'Focus' });
    fireEvent.change(screen.getByLabelText('Playlist'), { target: { value: 'spotify:playlist:p1' } });
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

    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await act(() => vi.advanceTimersByTimeAsync(9000));
    expect(calls()).toBe(2);

    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(calls()).toBe(3);

    unmount();
    await act(() => vi.advanceTimersByTimeAsync(9000));
    expect(calls()).toBe(3);
  });
});
