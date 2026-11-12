// A list's menu (v1.2 spec §3.6, §3.7), in the board's list cards and the widget's Lists view:
// Rename, Link subject (each subject, or None), Clear done, and Delete with an in-place confirm that
// says how many tasks go with it. It wears the task menu's look so the two read as one family.
//
// The panel is portalled out of the list and fixed-positioned from the trigger: the board's row of
// list columns scrolls sideways (overflow-x), which would clip an absolute panel and leave the
// "Link subject" pane, or the left-most list's whole menu, out of reach. On the board it portals
// into the overlay's host (`OverlayPortal`), so it stays inside the modal dialog; in the widget, to
// `document.body`. It opens below the trigger, right edges aligned, and flips up or to the right
// when there isn't room. Tab past either end of the panel returns to the trigger and closes it, as
// does the trigger scrolling out of view.
import {
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { LIST_NAME_MAX } from '../../shared/planner';
import type { TaskList } from '../../shared/types';
import { OverlayPortal } from '../shell/Overlay';
import { useStudyStore } from '../shell/store';
import { usePlannerStore } from './plannerStore';
import styles from './TaskMenu.module.css';

type Pane = 'menu' | 'rename' | 'subject' | 'delete';

/** At most `max` code points (an emoji is one character, as main counts it). */
export const capChars = (text: string, max: number): string => [...text].slice(0, max).join('');

/** "Delete Networks and its 2 tasks?" ("its 1 task" for one). */
export const deleteListAsk = (name: string, n: number): string =>
  `Delete ${name} and its ${n} ${n === 1 ? 'task' : 'tasks'}?`;

/** Where the fixed panel sits, in `win`'s coordinates: below `trigger` with right edges aligned;
 *  above it instead when below would run past the bottom margin and the whole panel fits above;
 *  starting at the trigger's left edge when right-aligned would pass the left margin; then clamped
 *  `margin` inside `win` (top-left wins when the panel is bigger than the room). */
export function menuSpot(
  trigger: Pick<DOMRect, 'top' | 'bottom' | 'left' | 'right'>,
  panel: { w: number; h: number },
  win: { w: number; h: number },
  gap = 4,
  margin = 8,
): { left: number; top: number } {
  let top = trigger.bottom + gap;
  if (top + panel.h > win.h - margin && trigger.top - gap - panel.h >= margin) {
    top = trigger.top - gap - panel.h;
  }
  let left = trigger.right - panel.w;
  if (left < margin) left = trigger.left;
  const clamp = (n: number, max: number): number => Math.max(margin, Math.min(n, max));
  return { left: clamp(left, win.w - margin - panel.w), top: clamp(top, win.h - margin - panel.h) };
}

/** The trigger's wrapper and the portalled panel are one menu: inside either is inside it. The
 *  panel is found by id, not by ref: a pane's autoFocus blurs the trigger before React attaches it. */
const inMenu = (node: unknown, root: HTMLElement | null, panelId: string): boolean =>
  node instanceof Node &&
  (root?.contains(node) === true || document.getElementById(panelId)?.contains(node) === true);

const UNPLACED: CSSProperties = { left: 0, top: 0, opacity: 0 };

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** `onDeleted` runs once the list is gone, so the host can put focus somewhere real: the menu's own
 *  button went with the list. */
export function ListMenu({ list, onDeleted }: { list: TaskList; onDeleted?: () => void }) {
  const [pane, setPane] = useState<Pane | null>(null);
  const [name, setName] = useState(list.name);
  const button = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [spot, setSpot] = useState<{ left: number; top: number } | null>(null);
  const panelId = useId();
  // The overlay's portal host on the board; null in the widget, where the body serves.
  const host = useContext(OverlayPortal);
  const subjects = useStudyStore((s) => s.subjects);
  // Every task in the list, done or not and whatever the filter: all of them go with it.
  const count = usePlannerStore((s) => Object.values(s.tasks).filter((t) => t.listId === list.id).length);

  const close = (): void => {
    setPane(null);
    button.current?.focus();
  };
  // A press outside, like the task menu: it closes without stealing focus back.
  const open = pane !== null;
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent): void => {
      if (inMenu(e.target, root.current, panelId)) return;
      setPane(null);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open, panelId]);

  // Placed before paint on open and on every pane change (each pane has its own height), and again
  // when the window resizes or anything around the trigger scrolls. A reopened panel starts at its
  // last spot, which this replaces before it is painted. Inside the overlay's host the spot is
  // relative to the host (the dialog is the fixed panel's containing block) and kept inside it.
  // A trigger scrolled wholly out of that area closes the menu rather than leave it floating.
  useLayoutEffect(() => {
    if (!open) return;
    const place = (): void => {
      const t = button.current?.getBoundingClientRect();
      const p = panel.current;
      if (!t || !p) return;
      const area = host?.getBoundingClientRect();
      const x = area?.left ?? 0;
      const y = area?.top ?? 0;
      const w = area?.width ?? window.innerWidth;
      const h = area?.height ?? window.innerHeight;
      const local = { left: t.left - x, right: t.right - x, top: t.top - y, bottom: t.bottom - y };
      if (local.bottom < 0 || local.top > h || local.right < 0 || local.left > w) {
        if (p.contains(document.activeElement)) button.current?.focus({ preventScroll: true });
        setPane(null);
        return;
      }
      setSpot(menuSpot(local, { w: p.offsetWidth, h: p.offsetHeight }, { w, h }));
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, pane, host]);

  const run = (action: () => Promise<void>): void => {
    close();
    void action();
  };

  const rename = (e: FormEvent): void => {
    e.preventDefault();
    const next = name.trim();
    if (next !== '' && next !== list.name) {
      run(() => usePlannerStore.getState().updateList(list.id, { name: next }));
    } else close();
  };

  const linkable = subjects.filter((s) => !s.archived || s.id === list.subjectId);

  return (
    <div
      ref={root}
      className={styles.anchor}
      onBlur={(e) => {
        // Focus moving out of the menu and its button closes it. React bubbles the portalled
        // panel's blur here too, so "out" means out of both.
        if (open && e.relatedTarget instanceof Node && !inMenu(e.relatedTarget, root.current, panelId)) {
          setPane(null);
        }
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || pane === null) return;
        // The menu's own Esc: it closes the menu, not the board around it.
        e.preventDefault();
        e.stopPropagation();
        close();
      }}
    >
      <button
        ref={button}
        type="button"
        className={styles.trigger}
        aria-label={`${list.name} menu`}
        aria-haspopup="true"
        aria-expanded={pane !== null}
        aria-controls={pane !== null ? panelId : undefined}
        onClick={() => {
          setName(list.name);
          setPane((p) => (p === null ? 'menu' : null));
        }}
      >
        ⋯
      </button>
      {pane !== null &&
        createPortal(
          <div
            ref={panel}
            id={panelId}
            role="group"
            aria-label="List actions"
            className={`${styles.panel} ${styles.fixed}`}
            // Parked at 0,0 and transparent until measured (before paint). Not visibility: hidden,
            // which would refuse the pane's autoFocus.
            style={spot ?? UNPLACED}
            onKeyDown={(e) => {
              // The panel sits apart from its trigger in the DOM, so Tab past either end goes back
              // to the trigger and closes the menu, rather than on to the rest of the page.
              if (e.key !== 'Tab') return;
              e.stopPropagation(); // the overlay's own Tab trap would see this panel as its end
              const items = [...e.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)];
              const edge = e.shiftKey ? items[0] : items[items.length - 1];
              if (document.activeElement !== edge) return;
              e.preventDefault();
              close();
            }}
          >
            {pane === 'menu' && (
              <>
                <button type="button" className={styles.item} autoFocus onClick={() => setPane('rename')}>
                  Rename
                </button>
                <button type="button" className={styles.item} onClick={() => setPane('subject')}>
                  Link subject
                </button>
                <button
                  type="button"
                  className={styles.item}
                  onClick={() => run(() => usePlannerStore.getState().clearDone(list.id))}
                >
                  Clear done
                </button>
                <button type="button" className={styles.item} onClick={() => setPane('delete')}>
                  Delete
                </button>
              </>
            )}
            {pane === 'rename' && (
              <form className={styles.row} onSubmit={rename}>
                <input
                  className={styles.small}
                  aria-label="New name"
                  autoFocus
                  value={name}
                  onChange={(e) => setName(capChars(e.target.value, LIST_NAME_MAX))}
                />
                <button type="submit" className={styles.small}>
                  Save
                </button>
              </form>
            )}
            {pane === 'subject' && (
              <>
                {[{ id: null, name: 'None' }, ...linkable].map((s) => (
                  <button
                    key={s.id ?? 'none'}
                    type="button"
                    className={styles.item}
                    aria-pressed={list.subjectId === s.id}
                    autoFocus={list.subjectId === s.id}
                    onClick={() =>
                      run(() => usePlannerStore.getState().updateList(list.id, { subjectId: s.id }))
                    }
                  >
                    {s.name}
                  </button>
                ))}
              </>
            )}
            {pane === 'delete' && (
              <>
                <p className={styles.ask}>{deleteListAsk(list.name, count)}</p>
                <div className={styles.row}>
                  <button type="button" className={styles.small} autoFocus onClick={() => setPane('menu')}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className={styles.small}
                    onClick={() => {
                      setPane(null);
                      void usePlannerStore
                        .getState()
                        .removeList(list.id)
                        .then(() => onDeleted?.());
                    }}
                  >
                    Delete
                  </button>
                </div>
              </>
            )}
          </div>,
          host ?? document.body,
        )}
    </div>
  );
}
