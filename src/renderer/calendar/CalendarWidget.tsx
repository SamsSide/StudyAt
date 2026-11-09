// Calendar widget body (widgets addendum §2): a read-only "Up Next" tile. Today's date as the header,
// what is still to come today, then Tomorrow and later days, six events at most. Main fetches and
// caches the iCal feeds (15-min freshness) and retries a failed fetch on each ask, so this asks every
// 5 min while the window is shown, on mount and when the window regains focus, and no faster.
// Rendered inside the shell's WidgetFrame.
import { useCallback, useEffect, useState } from 'react';
import type { CalendarAgenda, CalendarEvent } from '../../shared/widgets';
import { useStudyStore } from '../shell/store';
import { usePolling } from '../spotify/usePolling';
import styles from './CalendarWidget.module.css';

const POLL_MS = 5 * 60_000;
const MAX_ITEMS = 6;
const DAY_MS = 86_400_000;

const UNAVAILABLE: CalendarAgenda = { state: 'error', fetchedAt: null, events: [] };

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const pad = (n: number): string => String(n).padStart(2, '0');

/** 24-hour local time, "09:30". */
export const clockTime = (ms: number): string => {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** "Monday 9 November". */
export const longDate = (ms: number): string => {
  const d = new Date(ms);
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
};

const startOfDay = (ms: number): number => {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

/** Whole local days from `from` to `to` (both midnights); rounding absorbs a DST hour. */
const daysBetween = (from: number, to: number): number => Math.round((to - from) / DAY_MS);

interface DayGroup {
  key: number;
  label: string;
  events: CalendarEvent[];
}

/**
 * What is still to come, grouped by local day: timed events that have ended are dropped, an event
 * that began before today (a multi-day one) is shown under today, and six events in all at most.
 */
export function upcoming(
  events: CalendarEvent[],
  now: number,
): { today: CalendarEvent[]; later: DayGroup[] } {
  const today = startOfDay(now);
  const kept = events
    .filter((e) => (e.allDay ? e.end > today : e.end > now))
    .sort((a, b) => a.start - b.start)
    .slice(0, MAX_ITEMS);

  const todays: CalendarEvent[] = [];
  const later: DayGroup[] = [];
  for (const e of kept) {
    const day = Math.max(today, startOfDay(e.start));
    if (day === today) {
      todays.push(e);
      continue;
    }
    let group = later.find((g) => g.key === day);
    if (!group) {
      const label = daysBetween(today, day) === 1 ? 'Tomorrow' : (WEEKDAYS[new Date(day).getDay()] ?? '');
      group = { key: day, label, events: [] };
      later.push(group);
    }
    group.events.push(e);
  }
  return { today: todays, later };
}

export function CalendarWidget() {
  // null until the first answer, so no state message flashes on mount.
  const [agenda, setAgenda] = useState<CalendarAgenda | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const poll = useCallback(async () => {
    let next: CalendarAgenda;
    try {
      next = await window.studyat.calendar.agenda();
    } catch {
      next = UNAVAILABLE; // main never rejects; treat a broken bridge as unavailable
    }
    setNow(Date.now());
    setAgenda((prev) =>
      next.state === 'error' && next.events.length === 0 && prev && prev.events.length > 0
        ? { ...prev, state: 'stale' }
        : next,
    );
  }, []);

  usePolling(poll, POLL_MS, true);
  useEffect(() => {
    const onFocus = () => void poll();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [poll]);

  if (agenda === null) return <div className={styles.root} aria-busy="true" />;

  if (agenda.state === 'unconfigured') {
    return (
      <div className={`${styles.root} ${styles.state}`}>
        <StateIcon />
        <p className={styles.message}>Add your Google Calendar in Settings</p>
        <button
          type="button"
          className={styles.textButton}
          onClick={() => useStudyStore.getState().setOverlay('settings')}
        >
          Open settings
        </button>
      </div>
    );
  }

  if (agenda.state === 'error' && agenda.events.length === 0) {
    return (
      <div className={`${styles.root} ${styles.state}`}>
        <StateIcon />
        <p className={styles.message} role="status">
          Calendar unavailable
        </p>
      </div>
    );
  }

  const { today, later } = upcoming(agenda.events, now);
  const stale = agenda.state === 'stale' || agenda.state === 'error';

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>Today</p>
        <h3 className={styles.date}>{longDate(now)}</h3>
      </header>

      {today.length > 0 ? (
        <EventList label="Today" events={today} />
      ) : (
        <p className={styles.empty}>No more events today</p>
      )}

      {later.map((group) => (
        <section key={group.key} className={styles.day}>
          <h4 className={styles.dayLabel} aria-hidden="true">
            {group.label}
          </h4>
          <EventList label={group.label} events={group.events} />
        </section>
      ))}

      {stale && (
        <footer className={styles.footer} role="status">
          <span>Couldn&apos;t refresh — showing earlier events</span>
          {agenda.fetchedAt !== null && (
            <span className={styles.updated}>Updated {clockTime(agenda.fetchedAt)}</span>
          )}
        </footer>
      )}
    </div>
  );
}

function EventList({ label, events }: { label: string; events: CalendarEvent[] }) {
  return (
    <ul className={styles.list} aria-label={label}>
      {events.map((e) => (
        <li key={e.id} className={styles.event}>
          <span className={styles.bar} data-colour style={{ backgroundColor: e.colour }} aria-hidden="true" />
          <span className={styles.text}>
            <span className={styles.title}>{e.title}</span>
            <span className={styles.time}>
              {e.allDay ? 'All day' : `${clockTime(e.start)} – ${clockTime(e.end)}`}
              {e.location && <span className={styles.location}> · {e.location}</span>}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The quiet calendar glyph shown above a state message (24-unit grid, 1.75 stroke, as the shell). */
function StateIcon() {
  return (
    <span className={styles.stateIcon} aria-hidden="true">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        focusable="false"
      >
        <rect x="4" y="5.5" width="16" height="14.5" rx="3" />
        <path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" />
      </svg>
    </span>
  );
}
