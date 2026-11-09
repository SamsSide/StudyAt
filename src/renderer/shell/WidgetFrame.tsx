// A floating widget's frame (spec §3.11, §4). Position is stored as fractions of the window: `x`
// is the widget's horizontal centre, `y` its top edge (so the timer's 0.5 / 0.12 is top centre).
// Dragged by its header, clamped to the free area (clear of the dock and the top bar, 12 px off
// every edge) and re-clamped on resize; the clamp is only for display, so a window that grows back
// puts the widget where it was, and an old saved spot under the dock shows clear of it. The position is saved
// on drag end (a click without a move saves nothing); arrow keys on the header move it too. A widget with `autoHide` fades with the
// chrome (spec §3.7); the others stay.
import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
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

/** A layout token in px, or the value tokens.css sets when the sheet isn't loaded (tests). */
function tokenPx(name: string, fallback: number): number {
  const value = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
  return Number.isFinite(value) ? value : fallback;
}

/** Where a widget may sit: right of the dock and below the top bar, a gap clear of each. */
function freeArea(win: Box): { left: number; top: number; right: number; bottom: number } {
  const gap = tokenPx('--space-3', 12);
  // The dock and the top bar are both inset by one gap from the window edge (shell.module.css).
  return {
    left: gap + tokenPx('--dock-w', 76) + gap,
    top: gap + tokenPx('--topbar-h', 52) + gap,
    right: win.w - gap,
    bottom: win.h - gap,
  };
}

/** Window-pixel top-left clamped into the free area, so the whole frame stays clear of the chrome. */
function clampBox(left: number, top: number, frame: Box, win: Box): { left: number; top: number } {
  const area = freeArea(win);
  return {
    left: clamp(left, area.left, area.right - frame.w),
    top: clamp(top, area.top, area.bottom - frame.h),
  };
}

/** Window-pixel top-left for fractional (x, y). */
const place = (x: number, y: number, frame: Box, win: Box): { left: number; top: number } =>
  clampBox(x * win.w - frame.w / 2, y * win.h, frame, win);

/** The fractions that put the frame's top-left at (left, top). */
const fractions = (left: number, top: number, frame: Box, win: Box) => ({
  x: round(win.w > 0 ? (left + frame.w / 2) / win.w : 0.5),
  y: round(win.h > 0 ? top / win.h : 0),
});

const windowBox = (): Box => ({ w: window.innerWidth, h: window.innerHeight });

export function WidgetFrame({ id, title, children }: { id: WidgetId; title: string; children: ReactNode }) {
  const pos = useStudyStore((s) => s.settings?.widgets[id]);
  const patchWidget = useStudyStore((s) => s.patchWidget);
  const ref = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState<Box>({ w: 0, h: 0 });
  const [win, setWin] = useState<Box>(windowBox);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  // Removes a drag's window listeners; called on drag end, and on unmount mid-drag (the widget
  // closed by a shortcut, say) so a later pointerup saves nothing.
  const stopDrag = useRef<(() => void) | null>(null);
  useEffect(() => () => stopDrag.current?.(), []);

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
    let moved = false;
    const move = (ev: globalThis.PointerEvent): void => {
      if (ev.clientX === start.cx && ev.clientY === start.cy) return;
      moved = true;
      const w = windowBox();
      const next = clampBox(start.left + ev.clientX - start.cx, start.top + ev.clientY - start.cy, frame, w);
      last = fractions(next.left, next.top, frame, w);
      setDrag(last);
    };
    const detach = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      stopDrag.current = null;
    };
    const end = (): void => {
      detach();
      setDrag(null);
      // A click on the header without a move is not a drag: nothing to save.
      if (moved) save(last.x, last.y);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    stopDrag.current?.();
    stopDrag.current = detach;
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

  const classes = [
    styles.widget,
    styles.frosted,
    drag ? styles.dragging : '',
    pos.autoHide ? styles.fades : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div ref={ref} className={classes} style={{ left, top }} role="group" aria-label={title}>
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
