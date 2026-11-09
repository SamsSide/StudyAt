// The Quote widget body (widgets addendum §4): one quote per study day, chosen from the day key so
// it changes at the rollover hour, and an "Another" button that cycles locally. The shell's
// WidgetFrame supplies the glass tile and title.
import { useEffect, useRef, useState } from 'react';
import { dayKeyOf } from '../../core/time';
import { DEFAULT_SETTINGS } from '../../shared/settings';
import { useStudyStore } from '../shell/store';
import styles from './QuoteWidget.module.css';
import { QUOTES, quoteIndexFor } from './quotes';

/** How often the widget re-reads the clock to notice the rollover. */
const TICK_MS = 60_000;

export function QuoteWidget({ now = Date.now }: { now?: () => number }) {
  const rolloverHour = useStudyStore((s) => s.settings?.rolloverHour ?? DEFAULT_SETTINGS.rolloverHour);
  const [dayKey, setDayKey] = useState(() => dayKeyOf(now(), rolloverHour));
  // How far "Another" has moved on from the day's quote; a new day starts again at 0.
  const [offset, setOffset] = useState({ dayKey, by: 0 });

  // The clock is read through a ref so a new `now` each render doesn't restart the tick.
  const clock = useRef(now);
  useEffect(() => {
    clock.current = now;
  }, [now]);

  useEffect(() => {
    const check = (): void => setDayKey(dayKeyOf(clock.current(), rolloverHour));
    check();
    const timer = window.setInterval(check, TICK_MS);
    return () => window.clearInterval(timer);
  }, [rolloverHour]);

  const by = offset.dayKey === dayKey ? offset.by : 0;
  const quote = QUOTES[(quoteIndexFor(dayKey, QUOTES.length) + by) % QUOTES.length];
  if (!quote) return null;

  return (
    <figure className={styles.widget}>
      <blockquote className={styles.quote} aria-live="polite">
        <p data-testid="quote-text">{`“${quote.text}”`}</p>
      </blockquote>
      <figcaption className={styles.footer}>
        <cite className={styles.author} data-testid="quote-author">
          {quote.author}
        </cite>
        <button
          type="button"
          className={styles.another}
          onClick={() => setOffset({ dayKey, by: (by + 1) % QUOTES.length })}
        >
          Another
        </button>
      </figcaption>
    </figure>
  );
}
