// A floating widget's frame (spec §3.11, §4). Position is stored as fractions of the window: `x`
// is the widget's horizontal centre, `y` its top edge (so the timer's 0.5 / 0.12 is top centre).
// Dragged by its header, clamped to the free area (clear of the dock and the top bar, 12 px off
// every edge) and re-clamped on resize; the clamp is only for display, so a window that grows back
// puts the widget where it was, and an old saved spot under the dock shows clear of it. The position is saved
// on drag end (a click without a move saves nothing); arrow keys on the header move it too. A widget with `autoHide` fades with the
// chrome (spec §3.7); the others stay.
//
// Scale (spec §3.5): the frame renders at `layoutScale × scale` (a bad stored scale reads as 1,
// and the rest is held to 0.5–2) through `transform: scale(s)`
// from its top-left, shrunk for display when that box wouldn't fit the free area. The clamp, the
// placement and the drag maths all use the scaled box. The bottom-right corner resizes: dragging
// it along the diagonal sets `scale` (0.5–2, to 0.01) on pointer up, keeping the top-left corner
// where it is; `+`/`=` and `-` step it by 0.1, `0` or a double-click resets it to 1.
//
// Settings widgets read `settings.widgets[id]` and save through `patchWidget`; an image widget
// (spec §3.6) passes its own `pos`, `onPatch` and `onClose` instead. `chrome="bare"` drops the
// glass and the header, and the body itself becomes the drag handle: focusable, labelled
// `bodyLabel` (default "Move {title}"), and focused by a press so the arrow keys work next. A body
// that holds controls of its own (`interactiveBody`: a bare Deadlines widget, a note sticky, v1.2
// spec §3.2) is no button: its non-interactive parts are still the drag handle, and the keyboard
// moves it through a "Move {title}" handle in the bare toolbar. Either way a press or a key aimed
// at a control inside the body (a button, link, field, `[contenteditable]` or anything marked
// `data-no-drag`) reaches that control and never moves the widget.
import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type { WidgetId } from '../../shared/types';
import { Icon, type IconName } from './icons';
import { MAX_SCALE, MIN_SCALE, fitScale, layoutScale } from './layoutScale';
import styles from './shell.module.css';
import { useStudyStore } from './store';

const KEY_STEP = 0.02;
const SCALE_STEP = 0.1;

const clamp = (n: number, min: number, max: number): number => Math.min(Math.max(n, min), Math.max(min, max));
const round = (n: number): number => Math.round(n * 10_000) / 10_000;
const roundScale = (n: number): number => clamp(Math.round(n * 100) / 100, MIN_SCALE, MAX_SCALE);

/**
 * A stored scale fit to use: stored JSON (and an image widget's `pos`) reaches the frame
 * unchecked, so anything but a finite number is 1 and the rest is held to 0.5–2.
 */
const usableScale = (n: unknown): number =>
  typeof n === 'number' && Number.isFinite(n) ? clamp(n, MIN_SCALE, MAX_SCALE) : 1;

interface Box {
  w: number;
  h: number;
}

/** Where a widget sits and how big it is; a settings widget's `WidgetPos` is one. */
export interface FramePos {
  x: number;
  y: number;
  scale: number;
  autoHide: boolean;
}

export type FramePatch = { x?: number; y?: number; scale?: number };

type Placed = { x: number; y: number; scale: number };

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

/** The scale a frame of unscaled size `frame` renders at for a usable `scale` in this window. */
function renderedScale(frame: Box, scale: number, win: Box): number {
  const area = freeArea(win);
  return fitScale(frame, layoutScale(win.w, win.h) * scale, {
    w: area.right - area.left,
    h: area.bottom - area.top,
  });
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

/** The fractions that put the frame's top-left at (left, top); rounded only when saved. */
const fractions = (left: number, top: number, frame: Box, win: Box) => ({
  x: win.w > 0 ? (left + frame.w / 2) / win.w : 0.5,
  y: win.h > 0 ? top / win.h : 0,
});

const windowBox = (): Box => ({ w: window.innerWidth, h: window.innerHeight });

/** What inside a bare body keeps its own pointer and keys. */
const OWN_INPUT =
  'button, a[href], input, select, textarea, label, [contenteditable]:not([contenteditable="false"]), [data-no-drag]';

/** The event is aimed at a control inside `body` (not at the body itself). */
const atControl = (target: EventTarget, body: Element): boolean => {
  if (!(target instanceof Element)) return false;
  const control = target.closest(OWN_INPUT);
  return control !== null && control !== body && body.contains(control);
};

/** Six dots: the bare toolbar's move handle, drawn like the shell's icons (24-unit grid). */
function GripIcon() {
  return (
    <svg className={styles.icon} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
      {[8, 16].map((cx) => [6, 12, 18].map((cy) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.6" />))}
    </svg>
  );
}

interface WidgetFrameProps {
  /** A settings widget: its position comes from, and is saved to, `settings.widgets[id]`. */
  id?: WidgetId;
  title: string;
  children: ReactNode;
  /** `bare`: no glass, no header; the body is the drag handle (image widgets, spec §3.6). */
  chrome?: 'framed' | 'bare';
  pos?: FramePos;
  onPatch?(p: FramePatch): void;
  onClose?(): void;
  /** Extra controls: in the header when framed, in a floating toolbar when bare. */
  headerExtra?: ReactNode;
  /** The bare body's accessible name; "Move {title}" when not given. */
  bodyLabel?: string;
  /** The bare body holds controls: it is no button, and a toolbar handle moves it by keyboard. */
  interactiveBody?: boolean;
  /** The framed close button's name and icon; "Close {title}" and a cross when not given. */
  closeLabel?: string;
  closeIcon?: IconName;
}

export function WidgetFrame({
  id,
  title,
  children,
  chrome = 'framed',
  pos: givenPos,
  onPatch,
  onClose,
  headerExtra,
  bodyLabel,
  interactiveBody = false,
  closeLabel,
  closeIcon = 'close',
}: WidgetFrameProps) {
  const storedPos = useStudyStore((s) => (id ? s.settings?.widgets[id] : undefined));
  const patchWidget = useStudyStore((s) => s.patchWidget);
  const ref = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState<Box>({ w: 0, h: 0 });
  const [win, setWin] = useState<Box>(windowBox);
  // What a drag or a resize shows until it is saved on pointer up.
  const [preview, setPreview] = useState<{ kind: 'move' | 'resize'; at: Placed } | null>(null);
  // Removes a drag's window listeners; called on drag end, and on unmount mid-drag (the widget
  // closed by a shortcut, say) so a later pointerup saves nothing.
  const stopDrag = useRef<(() => void) | null>(null);
  useEffect(() => () => stopDrag.current?.(), []);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // offsetWidth/Height are the layout size, before the transform: the unscaled frame.
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

  const pos = givenPos ?? storedPos;
  if (!pos) return null;

  const save = (patch: FramePatch): void => {
    const p: FramePatch = { ...patch };
    if (p.x !== undefined) p.x = round(p.x);
    if (p.y !== undefined) p.y = round(p.y);
    if (onPatch) onPatch(p);
    else if (id) void patchWidget(id, p);
  };
  const close = (): void => {
    if (onClose) onClose();
    else if (id) void patchWidget(id, { open: false });
  };

  // The one scale every path below uses; every path below uses it, except `setScale`, which compares against the raw `pos.scale` so a step or reset repairs a bad stored value.
  const stored = usableScale(pos.scale);
  const current: Placed = preview?.at ?? { x: pos.x, y: pos.y, scale: stored };
  const s = renderedScale(frame, current.scale, win);
  const box: Box = { w: frame.w * s, h: frame.h * s };
  const { left, top } = place(current.x, current.y, box, win);
  /** The scaled box at the stored scale in window `w`; drags measure against the window as it is now. */
  const boxIn = (w: Box): Box => {
    const r = renderedScale(frame, stored, w);
    return { w: frame.w * r, h: frame.h * r };
  };

  /** The stored fields for `scale`, keeping the frame's top-left where it is now. */
  const rescaled = (scale: number, from: { left: number; top: number }, w: Box): Placed => {
    const r = renderedScale(frame, scale, w);
    const next: Box = { w: frame.w * r, h: frame.h * r };
    const at = clampBox(from.left, from.top, next, w);
    return { ...fractions(at.left, at.top, next, w), scale };
  };

  /**
   * Follows the pointer on the window until it is released; `onEnd` hears whether it moved, so a
   * click without a move saves nothing.
   */
  const track = (
    e: PointerEvent<HTMLElement>,
    onMove: (dx: number, dy: number) => void,
    onEnd: (moved: boolean) => void,
  ): void => {
    const start = { cx: e.clientX, cy: e.clientY };
    let moved = false;
    const move = (ev: globalThis.PointerEvent): void => {
      if (ev.clientX === start.cx && ev.clientY === start.cy) return;
      moved = true;
      onMove(ev.clientX - start.cx, ev.clientY - start.cy);
    };
    const detach = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      stopDrag.current = null;
    };
    const end = (): void => {
      detach();
      setPreview(null);
      onEnd(moved);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    stopDrag.current?.();
    stopDrag.current = detach;
  };

  const onMoveDown = (e: PointerEvent<HTMLElement>): void => {
    if (e.button !== 0) return;
    e.preventDefault();
    const from = { left, top };
    let last: Placed = { ...fractions(left, top, box, win), scale: stored };
    track(
      e,
      (dx, dy) => {
        const w = windowBox();
        const b = boxIn(w);
        const next = clampBox(from.left + dx, from.top + dy, b, w);
        last = { ...fractions(next.left, next.top, b, w), scale: stored };
        setPreview({ kind: 'move', at: last });
      },
      (moved) => {
        if (moved) save({ x: last.x, y: last.y });
      },
    );
    setPreview({ kind: 'move', at: last });
  };

  const onMoveKey = (e: KeyboardEvent<HTMLElement>): void => {
    const dx = e.key === 'ArrowLeft' ? -KEY_STEP : e.key === 'ArrowRight' ? KEY_STEP : 0;
    const dy = e.key === 'ArrowUp' ? -KEY_STEP : e.key === 'ArrowDown' ? KEY_STEP : 0;
    if (dx === 0 && dy === 0) return;
    e.preventDefault();
    const next = place(pos.x + dx, pos.y + dy, box, win);
    save(fractions(next.left, next.top, box, win));
  };

  const onResizeDown = (e: PointerEvent<HTMLButtonElement>): void => {
    if (e.button !== 0) return;
    e.preventDefault();
    const from = { left, top };
    // Movement counts along the scaled box's diagonal: scale × (diag + Δ) / diag.
    if (Math.hypot(box.w, box.h) === 0) return;
    let last: Placed | null = null;
    track(
      e,
      (dx, dy) => {
        const w = windowBox();
        const b = boxIn(w);
        const diag = Math.hypot(b.w, b.h);
        if (diag === 0) return;
        const along = (dx * b.w + dy * b.h) / diag;
        last = rescaled(roundScale((stored * (diag + along)) / diag), from, w);
        setPreview({ kind: 'resize', at: last });
      },
      (moved) => {
        if (moved && last) save(last);
      },
    );
  };

  const setScale = (scale: number): void => {
    const next = roundScale(scale);
    // Against the raw value, so a step or a reset repairs a bad stored scale.
    if (next !== pos.scale) save(rescaled(next, { left, top }, win));
  };

  const onResizeKey = (e: KeyboardEvent<HTMLButtonElement>): void => {
    const step = e.key === '+' || e.key === '=' ? SCALE_STEP : e.key === '-' ? -SCALE_STEP : 0;
    if (step === 0 && e.key !== '0') return;
    e.preventDefault();
    setScale(step === 0 ? 1 : stored + step);
  };

  const bare = chrome === 'bare';
  const classes = [
    styles.widget,
    bare ? styles.bare : styles.frosted,
    preview?.kind === 'move' ? styles.dragging : '',
    preview?.kind === 'resize' ? styles.resizing : '',
    pos.autoHide ? styles.fades : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      ref={ref}
      className={classes}
      style={{ left, top, transform: `scale(${s})` }}
      role="group"
      aria-label={title}
    >
      {bare ? (
        <>
          {(headerExtra || interactiveBody) && (
            <div className={`${styles.bareTools} ${styles.fades}`}>
              {interactiveBody && (
                <button
                  type="button"
                  className={`${styles.iconButton} ${styles.small} ${styles.bareHandle}`}
                  aria-label={`Move ${title}`}
                  title="Drag to move, or use the arrow keys"
                  onPointerDown={onMoveDown}
                  onKeyDown={onMoveKey}
                >
                  <GripIcon />
                </button>
              )}
              {headerExtra}
            </div>
          )}
          {interactiveBody ? (
            <div
              className={`${styles.widgetBody} ${styles.bareBody}`}
              onPointerDown={(e) => {
                if (!atControl(e.target, e.currentTarget)) onMoveDown(e);
              }}
            >
              {children}
            </div>
          ) : (
            <div
              role="button"
              tabIndex={0}
              className={`${styles.widgetBody} ${styles.bareBody}`}
              aria-label={bodyLabel ?? `Move ${title}`}
              title="Drag to move, or use the arrow keys"
              onPointerDown={(e) => {
                if (atControl(e.target, e.currentTarget)) return;
                // The drag's preventDefault would stop the press focusing it.
                e.currentTarget.focus({ preventScroll: true });
                onMoveDown(e);
              }}
              onKeyDown={(e) => {
                if (!atControl(e.target, e.currentTarget)) onMoveKey(e);
              }}
            >
              {children}
            </div>
          )}
        </>
      ) : (
        <>
          <div className={styles.widgetHeader}>
            <button
              type="button"
              className={`${styles.iconButton} ${styles.handle}`}
              aria-label={`Move ${title}`}
              title="Drag to move, or use the arrow keys"
              onPointerDown={onMoveDown}
              onKeyDown={onMoveKey}
            >
              {title}
            </button>
            {headerExtra}
            <button
              type="button"
              className={`${styles.iconButton} ${styles.small}`}
              onClick={close}
              aria-label={closeLabel ?? `Close ${title}`}
              title={closeLabel ?? 'Close'}
            >
              <Icon name={closeIcon} />
            </button>
          </div>
          <div className={styles.widgetBody}>{children}</div>
        </>
      )}
      <button
        type="button"
        className={`${styles.resize} ${styles.fades}`}
        aria-label={`Resize ${title}`}
        title="Drag to resize, + or − to step, 0 to reset"
        onPointerDown={onResizeDown}
        onKeyDown={onResizeKey}
        onDoubleClick={() => setScale(1)}
      />
    </div>
  );
}
