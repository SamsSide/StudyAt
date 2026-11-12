import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Deadline } from '../../shared/types';
import { resetStudyStore } from '../shell/store';
import { chipCountdown, DeadlineChip } from './DeadlineChip';

// 2026-11-20 12:00:00 local.
const NOW = new Date(2026, 10, 20, 12, 0, 0).getTime();
const SEC = 1000;
const HOUR = 3_600_000;

const stamp = (ms: number): string => {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

const deadline = (due: string): Deadline => ({
  id: 1,
  title: 'Problem sheet 6',
  kind: 'coursework',
  subjectId: null,
  due,
  note: '',
  done: false,
  createdAt: 0,
  updatedAt: 0,
});

beforeEach(() => {
  resetStudyStore();
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'], now: NOW });
});
afterEach(() => vi.useRealTimers());

describe('chipCountdown', () => {
  it('drops the seconds from a minute up, and keeps them in the last minute', () => {
    expect(chipCountdown(NOW + 42 * 60 * SEC + 8 * SEC, NOW)).toBe('42m');
    expect(chipCountdown(NOW + 42 * SEC, NOW)).toBe('0m 42s');
    expect(chipCountdown(NOW + 31 * HOUR + 12 * 60 * SEC, NOW)).toBe('31h 12m');
    expect(chipCountdown(NOW + 49 * HOUR, NOW)).toBe('2d 1h');
    expect(chipCountdown(NOW - SEC, NOW)).toBe('Due');
  });
});

describe('DeadlineChip countdown', () => {
  it('ticks each second in the last minute, until it says Due on time', () => {
    // Due is minute-precise, so start 42 s before it.
    vi.setSystemTime(NOW - 42 * SEC);
    render(<DeadlineChip deadline={deadline(stamp(NOW))} countdown />);
    expect(screen.getByText('· 0m 42s')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(SEC);
    });
    expect(screen.getByText('· 0m 41s')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(41 * SEC);
    });
    expect(screen.getByText('· Due')).toBeInTheDocument();
  });

  it('shows days and hours from 48 h out, on the slow tick', () => {
    render(<DeadlineChip deadline={deadline(stamp(NOW + 49 * HOUR + 5 * 60 * SEC))} countdown />);
    expect(screen.getByText('· 2d 1h')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(screen.getByText('· 2d 1h')).toBeInTheDocument();
  });

  it('goes back to the slow tick once the deadline is past', () => {
    const spy = vi.spyOn(window, 'setInterval');
    render(<DeadlineChip deadline={deadline(stamp(NOW - 5 * 60 * SEC))} countdown />);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[1]).toBe(30_000);
    spy.mockRestore();
  });

  it('ticks each second only while the deadline is ahead and within the hour', () => {
    const spy = vi.spyOn(window, 'setInterval');
    render(<DeadlineChip deadline={deadline(stamp(NOW + 30 * 60 * SEC))} countdown />);
    expect(spy.mock.calls[0]?.[1]).toBe(1000);
    spy.mockRestore();
  });

  it('reads Due for a deadline already past', () => {
    render(<DeadlineChip deadline={deadline(stamp(NOW - 5 * 60 * SEC))} countdown />);
    expect(screen.getByText('· Due')).toBeInTheDocument();
  });
});
