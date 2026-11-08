import { act, fireEvent, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAutoHide } from './useAutoHide';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useAutoHide', () => {
  it('auto-hide hides chrome after 5 s and mouse move shows it', () => {
    const { result } = renderHook(() => useAutoHide(5));
    expect(result.current).toBe(true);
    act(() => vi.advanceTimersByTime(4999));
    expect(result.current).toBe(true);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe(false);
    act(() => {
      fireEvent.mouseMove(window);
    });
    expect(result.current).toBe(true);
  });

  it('a key press shows it and restarts the delay', () => {
    const { result } = renderHook(() => useAutoHide(5));
    act(() => vi.advanceTimersByTime(5000));
    expect(result.current).toBe(false);
    act(() => {
      fireEvent.keyDown(window, { key: 'a' });
    });
    expect(result.current).toBe(true);
    act(() => vi.advanceTimersByTime(4000));
    expect(result.current).toBe(true);
  });

  it('0 seconds never hides', () => {
    const { result } = renderHook(() => useAutoHide(0));
    act(() => vi.advanceTimersByTime(60_000));
    expect(result.current).toBe(true);
  });
});
