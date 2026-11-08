// A floating widget's frame (spec §3.11, §4). Position is stored as fractions of the window: `x`
// is the widget's horizontal centre, `y` its top edge (so the timer's 0.5 / 0.12 is top centre).
// Dragged by its header, clamped inside the window and re-clamped on resize; the clamp is only
// for display, so a window that grows back puts the widget where it was. The position is saved
// on drag end; arrow keys on the header move it too. A widget with `autoHide` fades with the
// chrome (spec §3.7); the others stay.
import { type KeyboardEvent, type PointerEvent, type ReactNode, useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { WidgetId } from '../../shared/types';
import { Icon } from './icons';
import styles from './shell.module.css';
import { useStudyStore } from './store';

const KEY_STEP = 0.02;

const clamp = (n: number, min: number, max: number): number => Math.min(Math.max(n, min), Math.max(min, max));
const round = (n: number): number => Math.round(n * 10_000) / 10_000;

interface Box {
  w: number;
  h: number;
}

/** Window-pixel top-left for fractional (x, y), clamped so the whole frame stays on screen. */
function place(x: number, y: number, frame: Box, win: Box): { left: number; top: number } {
  return {
    left: clamp(x * win.w - frame.w / 2, 0, win.w - frame.w),
    top: clamp(y * win.h, 0, win.h - frame.h),
  };
}

/** The fractions that put the frame's top-left at (left, top). */
const fractions = (left: number, top: number, frame: Box, win: Box) => ({
  x: round(win.w > 0 ? (left + frame.w / 2) / win.w : 0.5),
  y: round(win.h > 0 ? top / win.h : 0),
});

const windowBox = (): Box => ({ w: window.innerWidth, h: window.innerHeight });

export function WidgetFrame({
  id,
  title,
  children,
}: {
  id: WidgetId;
  title: string;
  children: ReactNode;
}) {
  const pos = useStudyStore((s) => s.settings?.widgets[id]);
  const patchWidget = useStudyStore((s) => s.patchWidget);
  const ref = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState<Box>({ w: 0, h: 0 });
  const [win, setWin] = useState<Box>(windowBox);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = (): void => setFrame({ w: el.offsetWidth, h: el.offsetHeight });
    measure();
    const onResize = (): void => {
      setWin(windowBox());
      measure();
    };
    window.addEventListener('resize', onResize);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(el);
    return () => {
      window.removeEventListener('resize', onResize);
      observer?.disconnect();
    };
  }, []);

  const save = useCallback((x: number, y: number) => void patchWidget(id, { x, y }), [id, patchWidget]);

  if (!pos) return null;
  const current = drag ?? pos;
  const { left, top } = place(current.x, current.y, frame, win);

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>): void => {
    if (e.button !== 0) return;
    e.preventDefault();
    const start = { cx: e.clientX, cy: e.clientY, left, top };
    let last = fractions(left, top, frame, win);
    const move = (ev: globalThis.PointerEvent): void => {
      const w = windowBox();
      const nextLeft = clamp(start.left + ev.clientX - start.cx, 0, w.w - frame.w);
      const nextTop = clamp(start.top + ev.clientY - start.cy, 0, w.h - frame.h);
      last = fractions(nextLeft, nextTop, frame, w);
      setDrag(last);
    };
    const end = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      setDrag(null);
      save(last.x, last.y);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    setDrag(last);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>): void => {
    const dx = e.key === 'ArrowLeft' ? -KEY_STEP : e.key === 'ArrowRight' ? KEY_STEP : 0;
    const dy = e.key === 'ArrowUp' ? -KEY_STEP : e.key === 'ArrowDown' ? KEY_STEP : 0;
    if (dx === 0 && dy === 0) return;
    e.preventDefault();
    const next = place(pos.x + dx, pos.y + dy, frame, win);
    const f = fractions(next.left, next.top, frame, win);
    save(f.x, f.y);
  };

  const classes = [styles.widget, styles.frosted, drag ? styles.dragging : '', pos.autoHide ? styles.fades : '']
    .filter(Boolean)
    .join(' ');

  return (
    <div
      ref={ref}
      className={classes}
      style={{ left, top }}
      role="group"
      aria-label={title}
    >
      <div className={styles.widgetHeader}>
        <button
          type="button"
          className={`${styles.iconButton} ${styles.handle}`}
          aria-label={`Move ${title}`}
          title="Drag to move, or use the arrow keys"
          onPointerDown={onPointerDown}
          onKeyDown={onKeyDown}
        >
          {title}
        </button>
        <button
          type="button"
          className={`${styles.iconButton} ${styles.small}`}
          onClick={() => void patchWidget(id, { open: false })}
          aria-label={`Close ${title}`}
          title="Close"
        >
          <Icon name="close" />
        </button>
      </div>
      <div className={styles.widgetBody}>{children}</div>
    </div>
  );
}
