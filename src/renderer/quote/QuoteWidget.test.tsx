import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../shared/settings';
import { resetStudyStore, useStudyStore } from '../shell/store';
import { QuoteWidget } from './QuoteWidget';
import { QUOTES, quoteIndexFor } from './quotes';

/** Local wall-clock time on a given day, as the app's own clock would read it. */
const at = (day: number, hour: number, minute = 0) => new Date(2026, 10, day, hour, minute).getTime();

const settingsWithRollover = (rolloverHour: number) => {
  const { spotifyTokens: _t, ...rest } = structuredClone(DEFAULT_SETTINGS);
  return { ...rest, rolloverHour };
};

const shownText = () => screen.getByTestId('quote-text').textContent;
const shownAuthor = () => screen.getByTestId('quote-author').textContent;

beforeEach(() => resetStudyStore());
afterEach(() => vi.useRealTimers());

describe('quoteIndexFor', () => {
  it('is stable for a day key and moves on by one the next day', () => {
    const a = quoteIndexFor('2026-11-09', QUOTES.length);
    expect(quoteIndexFor('2026-11-09', QUOTES.length)).toBe(a);
    expect(quoteIndexFor('2026-11-10', QUOTES.length)).toBe((a + 1) % QUOTES.length);
  });

  it('always lands inside the list, before 1970 too', () => {
    for (const key of ['1969-12-31', '1970-01-01', '2026-11-09', '2099-02-28']) {
      const i = quoteIndexFor(key, 7);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(7);
    }
  });
});

describe('QUOTES', () => {
  it('bundles the quotes, each with text and an author', () => {
    expect(QUOTES.length).toBeGreaterThan(50);
    for (const q of QUOTES) {
      expect(q.text.trim()).not.toBe('');
      expect(q.author.trim()).not.toBe('');
    }
  });

  it('uses typographic apostrophes, never straight ones', () => {
    expect(QUOTES.filter((q) => q.text.includes("'")).map((q) => q.text)).toEqual([]);
  });
});

describe('QuoteWidget', () => {
  it("shows the study day's quote in typographic quotes, with its author", () => {
    const now = at(9, 10);
    render(<QuoteWidget now={() => now} />);
    const q = QUOTES[quoteIndexFor('2026-11-09', QUOTES.length)]!;
    expect(shownText()).toBe(`“${q.text}”`);
    expect(shownAuthor()).toBe(q.author);
  });

  it('keeps the same quote until the rollover hour, then changes', () => {
    vi.useFakeTimers();
    let now = at(10, 3, 30); // still the study day of 9 November before 04:00
    render(<QuoteWidget now={() => now} />);
    const before = QUOTES[quoteIndexFor('2026-11-09', QUOTES.length)]!;
    expect(shownAuthor()).toBe(before.author);
    expect(shownText()).toBe(`“${before.text}”`);

    now = at(10, 4, 1);
    act(() => vi.advanceTimersByTime(60_000));
    const after = QUOTES[quoteIndexFor('2026-11-10', QUOTES.length)]!;
    expect(shownText()).toBe(`“${after.text}”`);
  });

  it('follows the rollover hour from settings', () => {
    useStudyStore.setState({ settings: settingsWithRollover(0) });
    const now = at(10, 2);
    render(<QuoteWidget now={() => now} />);
    const q = QUOTES[quoteIndexFor('2026-11-10', QUOTES.length)]!;
    expect(shownText()).toBe(`“${q.text}”`);
  });

  it('"Another" cycles to the next quote and wraps round', async () => {
    const user = userEvent.setup();
    const now = at(9, 10);
    render(<QuoteWidget now={() => now} />);
    const start = quoteIndexFor('2026-11-09', QUOTES.length);
    await user.click(screen.getByRole('button', { name: 'Another' }));
    expect(shownText()).toBe(`“${QUOTES[(start + 1) % QUOTES.length]!.text}”`);
    for (let i = 1; i < QUOTES.length; i += 1) {
      await user.click(screen.getByRole('button', { name: 'Another' }));
    }
    expect(shownText()).toBe(`“${QUOTES[start]!.text}”`);
  });

  it('a new study day starts again from that day’s quote', async () => {
    vi.useFakeTimers();
    let now = at(9, 22);
    render(<QuoteWidget now={() => now} />);
    act(() => screen.getByRole('button', { name: 'Another' }).click());
    now = at(10, 5);
    act(() => vi.advanceTimersByTime(60_000));
    const q = QUOTES[quoteIndexFor('2026-11-10', QUOTES.length)]!;
    expect(shownText()).toBe(`“${q.text}”`);
  });
});
