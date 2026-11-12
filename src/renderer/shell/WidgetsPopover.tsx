// The dock's Widgets popover (widgets addendum §1, v1.2 spec §3.1): a small glass sheet beside the dock
// listing the Spotify, Calendar, Weather, Quote, Notes and Deadlines widgets, each with a macOS-style
// switch bound to toggleWidget. Timer and Tasks keep their own dock items. Below the switches,
// "Add stats widget…" adds a stats card (aria-disabled at six, the UI half of the limit main also
// enforces) and "Add image…" opens the image dialog (v1.1 spec §3.6), each in the popover's place. Focus moves to the first switch on open and
// back to the dock item on close; Esc (useShortcuts), W, a click outside or tabbing away closes it.
import { useEffect, useId, useLayoutEffect, useRef, type KeyboardEvent, type RefObject } from 'react';
import type { WidgetId } from '../../shared/types';
import { LIMIT_COPY, MAX_STAT_WIDGETS } from '../../shared/planner';
import { useImagesStore } from '../images/imagesStore';
import { useStatWidgetsStore } from '../statWidgets/statWidgetsStore';
import styles from './shell.module.css';
import { useStudyStore } from './store';

export const POPOVER_WIDGETS: readonly { id: WidgetId; label: string }[] = [
  { id: 'spotify', label: 'Spotify' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'weather', label: 'Weather' },
  { id: 'quote', label: 'Quote' },
  { id: 'notes', label: 'Notes' },
  { id: 'deadlines', label: 'Deadlines' },
];

/** Gap between the dock item and the popover, and the least gap to the window's edge. */
const GAP = 12;
const EDGE = 8;
/** The popover's menu items, in order, for Up and Down. */
const ITEMS = '[role="switch"], [data-popover-item]';

export function WidgetsPopover({
  id,
  anchor,
  onClose,
}: {
  id: string;
  anchor: RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  const widgets = useStudyStore((s) => s.settings?.widgets);
  const toggleWidget = useStudyStore((s) => s.toggleWidget);
  const setAdding = useImagesStore((s) => s.setAdding);
  const statCount = useStatWidgetsStore((s) => s.widgets.length);
  const full = statCount >= MAX_STAT_WIDGETS;
  const hintId = useId();
  const ref = useRef<HTMLDivElement>(null);

  // Beside the dock item, vertically centred on it, kept inside the window (and again on resize).
  useLayoutEffect(() => {
    const place = (): void => {
      const node = ref.current;
      const a = anchor.current?.getBoundingClientRect();
      if (!node || !a) return;
      const h = node.offsetHeight;
      const centre = a.top + a.height / 2 - h / 2;
      node.style.left = `${a.right + GAP}px`;
      node.style.top = `${Math.max(EDGE, Math.min(centre, window.innerHeight - h - EDGE))}px`;
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [anchor]);

  // Focus in on open; on close, focus goes back to the dock item unless Sam has moved it elsewhere.
  useLayoutEffect(() => {
    const node = ref.current;
    const trigger = anchor.current;
    node?.querySelector<HTMLElement>('[role="switch"]')?.focus();
    return () => {
      const active = document.activeElement;
      if (!active || active === document.body || node?.contains(active)) trigger?.focus();
    };
  }, [anchor]);

  // A press anywhere outside the popover and its dock item closes it.
  useEffect(() => {
    const onDown = (e: PointerEvent): void => {
      const t = e.target;
      if (!(t instanceof Node)) return;
      if (ref.current?.contains(t) || anchor.current?.contains(t)) return;
      onClose();
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [anchor, onClose]);

  /** Up and Down move between the items, as in a menu. */
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = [...(ref.current?.querySelectorAll<HTMLElement>(ITEMS) ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const step = e.key === 'ArrowDown' ? 1 : -1;
    items[(at + step + items.length) % items.length]?.focus();
    e.preventDefault();
  };

  return (
    <div
      ref={ref}
      id={id}
      role="dialog"
      aria-label="Widgets"
      className={`${styles.popover} ${styles.frosted} ${styles.fades}`}
      onKeyDown={onKeyDown}
      onBlur={(e) => {
        // Tabbing out closes it, as a macOS popover does; a click elsewhere is the pointer handler's.
        const next = e.relatedTarget;
        if (next instanceof Node && !ref.current?.contains(next) && !anchor.current?.contains(next))
          onClose();
      }}
    >
      <h2 className={styles.popoverTitle}>Widgets</h2>
      <ul className={styles.popoverList}>
        {POPOVER_WIDGETS.map((w) => (
          <li key={w.id}>
            <button
              type="button"
              role="switch"
              aria-checked={widgets?.[w.id].open ?? false}
              className={styles.popoverRow}
              onClick={() => void toggleWidget(w.id)}
            >
              {w.label}
              <span className={styles.switch} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        data-popover-item
        className={styles.popoverRow}
        aria-disabled={full}
        aria-describedby={full ? hintId : undefined}
        title={full ? LIMIT_COPY.statWidgets : undefined}
        onClick={() => {
          if (full) return;
          onClose();
          void useStatWidgetsStore.getState().add();
        }}
      >
        Add stats widget…
      </button>
      {full && (
        <span id={hintId} className={styles.srOnly}>
          {LIMIT_COPY.statWidgets}
        </span>
      )}
      <button
        type="button"
        data-popover-item
        className={styles.popoverRow}
        onClick={() => {
          onClose();
          setAdding(true);
        }}
      >
        Add image…
      </button>
    </div>
  );
}
