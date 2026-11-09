import { render } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../shared/settings';
import type { PublicSettings } from '../../shared/types';
import { idleTimerState, installMockApi, mockApi, type MockApi } from '../test/mockApi';
import { audioEngine } from './engine';
import { useChimes } from './useChimes';

function Probe() {
  useChimes();
  return null;
}

const settingsWith = (over: Partial<PublicSettings>): PublicSettings => {
  const { spotifyTokens: _t, ...rest } = structuredClone(DEFAULT_SETTINGS);
  return { ...rest, ...over };
};

const flush = () => vi.advanceTimersByTimeAsync(0);

function setup(over: Partial<PublicSettings>, strict = false): MockApi {
  const api = mockApi({
    settings: { get: vi.fn(() => Promise.resolve(settingsWith(over))) },
  });
  installMockApi(api);
  render(
    strict ? (
      <StrictMode>
        <Probe />
      </StrictMode>
    ) : (
      <Probe />
    ),
  );
  return api;
}

let playChime: ReturnType<typeof vi.spyOn>;
let tick: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers();
  playChime = vi.spyOn(audioEngine, 'playChime').mockResolvedValue(undefined);
  tick = vi.spyOn(audioEngine, 'tick').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useChimes', () => {
  it('plays the focus-end chime with repeat 2 as two playChime calls 1.2 s apart', async () => {
    const api = setup({
      chimeRepeat: 2,
      chimeFocusEnd: 'bowl',
      chimeVolume: 0.6,
    });
    await flush();
    api.emitSegmentEnd({ mode: 'focus', next: 'short' });
    await flush();
    expect(playChime).toHaveBeenCalledTimes(1);
    expect(playChime).toHaveBeenLastCalledWith('bowl', {
      volume: 0.6,
      repeat: 1,
      customUrl: undefined,
    });
    await vi.advanceTimersByTimeAsync(1199);
    expect(playChime).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(playChime).toHaveBeenCalledTimes(2);
  });

  it('plays the break-end chime after a break', async () => {
    const api = setup({ chimeBreakEnd: 'digital' });
    await flush();
    api.emitSegmentEnd({ mode: 'short', next: 'focus' });
    await flush();
    expect(playChime).toHaveBeenCalledWith('digital', expect.objectContaining({ repeat: 1 }));
  });

  it('passes the media URL for a custom chime', async () => {
    const api = setup({ chimeFocusEnd: 'file:12' });
    await flush();
    api.emitSegmentEnd({ mode: 'focus', next: 'short' });
    await flush();
    expect(playChime).toHaveBeenCalledWith(
      'file:12',
      expect.objectContaining({ customUrl: 'studyat-media://chime/12' }),
    );
  });

  it('does not double-play when mounted twice in StrictMode', async () => {
    const api = setup({}, true);
    await flush();
    api.emitSegmentEnd({ mode: 'focus', next: 'short' });
    await flush();
    expect(playChime).toHaveBeenCalledTimes(1);
  });

  it('ticks once per second in the last minute of focus only when tickLastMinute is on', async () => {
    const api = setup({ tickLastMinute: true });
    await flush();
    const running = (remainingMs: number) => ({
      ...idleTimerState(),
      status: 'running' as const,
      remainingMs,
    });
    api.emitState(running(61_000));
    api.emitState(running(60_000));
    api.emitState(running(59_800)); // same displayed second as 60 000? ceil(59.8)=60 -> not a new tick
    api.emitState(running(59_000));
    expect(tick).toHaveBeenCalledTimes(2);
    api.emitState({ ...running(30_000), mode: 'short' });
    expect(tick).toHaveBeenCalledTimes(2);
  });

  it('counts Countdown as focus: end chime, last-minute tick and start chime', async () => {
    const api = setup({ tickLastMinute: true, chimeOnStart: true, chimeFocusEnd: 'bell', chimeBreakEnd: 'marimba' });
    await flush();
    const cd = { ...idleTimerState(), mode: 'countdown' as const };
    api.emitState(cd);
    api.emitState({ ...cd, status: 'running', remainingMs: 59_000 });
    await flush();
    expect(playChime).toHaveBeenCalledWith('woodblock', expect.anything());
    expect(tick).toHaveBeenCalledTimes(1);
    playChime.mockClear();
    api.emitSegmentEnd({ mode: 'countdown', next: 'countdown' });
    await flush();
    expect(playChime).toHaveBeenCalledWith('bell', expect.anything());
  });

  it('does not tick when tickLastMinute is off', async () => {
    const api = setup({ tickLastMinute: false });
    await flush();
    api.emitState({
      ...idleTimerState(),
      status: 'running',
      remainingMs: 30_000,
    });
    expect(tick).not.toHaveBeenCalled();
  });

  it('plays the Wood block when focus starts if chimeOnStart, but not when resuming', async () => {
    const api = setup({ chimeOnStart: true, chimeVolume: 0.5 });
    await flush();
    api.emitState(idleTimerState());
    api.emitState({ ...idleTimerState(), status: 'running' });
    await flush();
    expect(playChime).toHaveBeenCalledTimes(1);
    expect(playChime).toHaveBeenLastCalledWith('woodblock', {
      volume: 0.5,
      repeat: 1,
    });
    api.emitState({ ...idleTimerState(), status: 'paused' });
    api.emitState({ ...idleTimerState(), status: 'running' });
    await flush();
    expect(playChime).toHaveBeenCalledTimes(1);
  });

  it('is silent on start when chimeOnStart is off', async () => {
    const api = setup({ chimeOnStart: false });
    await flush();
    api.emitState(idleTimerState());
    api.emitState({ ...idleTimerState(), status: 'running' });
    await flush();
    expect(playChime).not.toHaveBeenCalled();
  });

  it('unsubscribes and cancels pending repeats on unmount', async () => {
    const api = mockApi({
      settings: {
        get: vi.fn(() => Promise.resolve(settingsWith({ chimeRepeat: 3 }))),
      },
    });
    installMockApi(api);
    const { unmount } = render(<Probe />);
    await flush();
    api.emitSegmentEnd({ mode: 'focus', next: 'short' });
    await flush();
    unmount();
    await vi.advanceTimersByTimeAsync(5000);
    expect(playChime).toHaveBeenCalledTimes(1);
  });
});
