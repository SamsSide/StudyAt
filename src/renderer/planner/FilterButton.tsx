// The Tasks filter (v1.2 spec §3.7): a "Filter" button that opens a small popover with a subject
// and a tag. It reads as pressed while any filter is set. Esc closes it and returns focus; a click outside closes it too.
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useStudyStore } from '../shell/store';
import { usePlannerStore } from './plannerStore';
import styles from './planner.module.css';

export function FilterButton() {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const button = useRef<HTMLButtonElement>(null);
  const subjects = useStudyStore((s) => s.subjects);
  const filter = usePlannerStore((s) => s.filter);
  const setFilter = usePlannerStore((s) => s.setFilter);
  const tags = usePlannerStore((s) => {
    const all = new Set<string>();
    for (const t of Object.values(s.tasks)) for (const tag of t.tags) all.add(tag);
    return [...all].sort().join(' ');
  });
  const active = filter.subjectId !== null || filter.tag !== null;

  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent): void => {
      if (e.target instanceof Node && root.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape' || !open) return;
    e.stopPropagation();
    setOpen(false);
    button.current?.focus();
  };

  return (
    <div ref={root} className={styles.filter} onKeyDown={onKeyDown}>
      <button
        ref={button}
        type="button"
        className={styles.textButton}
        aria-pressed={active}
        data-popup
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        Filter
      </button>
      {open && (
        <div id={panelId} role="group" aria-label="Filter tasks" className={styles.filterPanel}>
          <select
            className={styles.select}
            aria-label="Subject"
            value={filter.subjectId ?? ''}
            onChange={(e) =>
              setFilter({ ...filter, subjectId: e.target.value === '' ? null : Number(e.target.value) })
            }
          >
            <option value="">All subjects</option>
            {subjects
              .filter((s) => !s.archived || s.id === filter.subjectId)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </select>
          <select
            className={styles.select}
            aria-label="Tag"
            value={filter.tag ?? ''}
            onChange={(e) => setFilter({ ...filter, tag: e.target.value === '' ? null : e.target.value })}
          >
            <option value="">All tags</option>
            {(tags === '' ? [] : tags.split(' ')).map((t) => (
              <option key={t} value={t}>
                #{t}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
