// A list's menu (v1.2 spec §3.6, §3.7), in the board's list cards and the widget's Lists view:
// Rename, Link subject (each subject, or None), Clear done, and Delete with an in-place confirm that
// says how many tasks go with it. It wears the task menu's look so the two read as one family.
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { LIST_NAME_MAX } from '../../shared/planner';
import type { TaskList } from '../../shared/types';
import { useStudyStore } from '../shell/store';
import { usePlannerStore } from './plannerStore';
import styles from './TaskMenu.module.css';

type Pane = 'menu' | 'rename' | 'subject' | 'delete';

/** At most `max` code points (an emoji is one character, as main counts it). */
export const capChars = (text: string, max: number): string => [...text].slice(0, max).join('');

/** "Delete Networks and its 2 tasks?" ("its 1 task" for one). */
export const deleteListAsk = (name: string, n: number): string =>
  `Delete ${name} and its ${n} ${n === 1 ? 'task' : 'tasks'}?`;

/** `onDeleted` runs once the list is gone, so the host can put focus somewhere real: the menu's own
 *  button went with the list. */
export function ListMenu({ list, onDeleted }: { list: TaskList; onDeleted?: () => void }) {
  const [pane, setPane] = useState<Pane | null>(null);
  const [name, setName] = useState(list.name);
  const button = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const panelId = useId();
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
      if (e.target instanceof Node && root.current?.contains(e.target)) return;
      setPane(null);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

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
        // Focus moving out of the menu and its button closes it.
        if (open && e.relatedTarget instanceof Node && !e.currentTarget.contains(e.relatedTarget)) {
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
      {pane !== null && (
        <div id={panelId} role="group" aria-label="List actions" className={styles.panel}>
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
        </div>
      )}
    </div>
  );
}
