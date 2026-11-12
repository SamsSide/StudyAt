// The task menu (v1.2 spec §3.7), beside the detail's close button: Start focus (the row's ▶),
// Schedule revision… (§3.9; not for a revision task), Duplicate, and Delete with an in-place confirm.
import { useEffect, useId, useRef, useState } from 'react';
import type { PlannerTask } from '../../shared/types';
import { usePlannerStore } from './plannerStore';
import styles from './TaskMenu.module.css';

export function TaskMenu({ task }: { task: PlannerTask }) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const panelId = useId();

  const close = (): void => {
    setOpen(false);
    setConfirming(false);
  };
  const run = (action: () => void): void => {
    close();
    button.current?.focus();
    action();
  };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent): void => {
      if (e.target instanceof Node && root.current?.contains(e.target)) return;
      close();
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  return (
    <div
      ref={root}
      className={styles.anchor}
      onBlur={(e) => {
        // Focus moving out of the menu and its button closes it, as the other pickers do.
        if (open && e.relatedTarget instanceof Node && !e.currentTarget.contains(e.relatedTarget)) close();
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || !open) return;
        // The menu's own Esc: it closes the menu, not the dialog around it.
        e.preventDefault();
        e.stopPropagation();
        close();
        button.current?.focus();
      }}
    >
      <button
        ref={button}
        type="button"
        className={styles.trigger}
        aria-label="Task menu"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => {
          setConfirming(false);
          setOpen((o) => !o);
        }}
      >
        ⋯
      </button>
      {open && (
        <div id={panelId} role="group" aria-label="Task actions" className={styles.panel}>
          {confirming ? (
            <>
              <p className={styles.ask}>Delete this task?</p>
              <div className={styles.row}>
                <button type="button" className={styles.small} autoFocus onClick={() => setConfirming(false)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className={styles.small}
                  onClick={() => run(() => void usePlannerStore.getState().remove(task.id))}
                >
                  Delete
                </button>
              </div>
            </>
          ) : (
            <>
              <button
                type="button"
                className={styles.item}
                autoFocus
                onClick={() => run(() => void usePlannerStore.getState().startTask(task.id))}
              >
                Start focus
              </button>
              {task.kind !== 'revision' && (
                <button
                  type="button"
                  className={styles.item}
                  onClick={() => {
                    close();
                    usePlannerStore.getState().offerRevision(task.id);
                    // The bar lives in the widget behind this dialog, so the dialog steps aside.
                    usePlannerStore.getState().closeDetail();
                  }}
                >
                  Schedule revision…
                </button>
              )}
              <button
                type="button"
                className={styles.item}
                onClick={() => run(() => void usePlannerStore.getState().duplicate(task.id))}
              >
                Duplicate
              </button>
              <button type="button" className={styles.item} onClick={() => setConfirming(true)}>
                Delete
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
