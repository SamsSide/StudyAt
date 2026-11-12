// The quick card (Tweek board feel spec §4.2): what a click on a task opens. Placement and Expand,
// the title with its done check, a note, one row of chips for StudyAt's fields, the subtasks when
// there are any, and an icon bar whose small menus open inside the card. Expand switches the dialog
// to the full detail (TaskDetail); both save through useTaskEditor.
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { ESTIMATE_PRESETS, TASK_NOTE_MAX, TASK_TITLE_MAX } from '../../shared/planner';
import type { PlannerTask } from '../../shared/types';
import { formatGoal } from '../shell/format';
import { useStudyStore } from '../shell/store';
import { TASK_COLOURS } from '../tasks/taskColours';
import { PlacementPicker } from './PlacementPicker';
import { usePlannerStore } from './plannerStore';
import { SAVE_FAILED, SubtaskList } from './SubtaskList';
import { TagInput } from './TagInput';
import { TaskMenu } from './TaskMenu';
import { cap, useTaskEditor } from './useTaskEditor';
import styles from './card.module.css';
import detail from './detail.module.css';

const MIN_MS = 60_000;
const NONE = 'none';

type Menu = 'repeat' | 'colour' | 'reminder';

const REPEATS = [
  { value: NONE, label: 'None' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekdays', label: 'Weekdays' },
  { value: 'weekly', label: 'Weekly' },
] as const;

/** Line icons on the shell's 24-unit grid, in the text colour (or the accent when their value is set). */
function CardIcon({ children }: { children: ReactNode }) {
  return (
    <svg
      className={styles.icon}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

/** Arrow keys and Home/End move between a menu's items. */
function onMenuKeys(e: ReactKeyboardEvent<HTMLDivElement>): void {
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitemradio"]')];
  const at = items.indexOf(document.activeElement as HTMLElement);
  const go = (i: number): void => {
    e.preventDefault();
    items[(i + items.length) % items.length]?.focus();
  };
  if (e.key === 'ArrowDown') go(at + 1);
  else if (e.key === 'ArrowUp') go(at - 1);
  else if (e.key === 'Home') go(0);
  else if (e.key === 'End') go(items.length - 1);
}

export function TaskCard({ task }: { task: PlannerTask }) {
  const closeDetail = usePlannerStore((s) => s.closeDetail);
  const expandDetail = usePlannerStore((s) => s.expandDetail);
  const startTask = usePlannerStore((s) => s.startTask);
  const subjects = useStudyStore((s) => s.subjects);
  const dated = task.day !== null;
  const {
    title,
    setTitle,
    commitTitle,
    note,
    setNote,
    commitNote,
    reminder,
    setReminder,
    commitReminder,
    save,
    saveFailed,
    touch,
  } = useTaskEditor(task);

  // ☰ shows the subtasks (they show anyway once there are some) and puts the caret in "Add a subtask".
  const [subtasksShown, setSubtasksShown] = useState(false);
  const [focusAdd, setFocusAdd] = useState(0);
  const subtasksRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focusAdd > 0)
      subtasksRef.current?.querySelector<HTMLInputElement>('input[aria-label="Add a subtask"]')?.focus();
  }, [focusAdd]);

  // One small menu at a time, opened below the icon bar inside the card.
  const [menu, setMenu] = useState<Menu | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const repeatButton = useRef<HTMLButtonElement>(null);
  const colourButton = useRef<HTMLButtonElement>(null);
  const reminderButton = useRef<HTMLButtonElement>(null);
  const triggerOf = (m: Menu): HTMLButtonElement | null =>
    (m === 'repeat' ? repeatButton : m === 'colour' ? colourButton : reminderButton).current;
  const open = menu === 'colour' || (menu !== null && dated) ? menu : null;

  /** Closes the menu. A field in it is blurred first, so the reminder being typed is saved by its blur. */
  const closeMenu = (refocus: boolean): void => {
    const at = document.activeElement;
    if (at instanceof HTMLElement && panel.current?.contains(at)) at.blur();
    const trigger = menu ? triggerOf(menu) : null;
    setMenu(null);
    if (refocus) trigger?.focus();
  };
  const latestClose = useRef(closeMenu);
  useEffect(() => {
    latestClose.current = closeMenu;
  });

  // A press anywhere but the menu and its own button closes it (outside the card, the card goes too).
  useEffect(() => {
    if (open === null) return;
    const onDown = (e: PointerEvent): void => {
      const t = e.target;
      if (!(t instanceof Node) || panel.current?.contains(t) || triggerOf(open)?.contains(t)) return;
      latestClose.current(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  // Opening a menu moves focus into it: the chosen item, or the time field.
  useEffect(() => {
    if (open === null || !panel.current) return;
    const target =
      panel.current.querySelector<HTMLElement>('[aria-checked="true"]') ??
      panel.current.querySelector<HTMLElement>('[role="menuitemradio"], input');
    target?.focus();
  }, [open]);

  const toggle = (m: Menu): void => setMenu((now) => (now === m ? null : m));

  const estimate = task.estimateMin;
  const isPreset = estimate !== null && (ESTIMATE_PRESETS as readonly number[]).includes(estimate);
  const subjectOptions = subjects.filter((s) => !s.archived || s.id === task.subjectId);
  const subject = subjects.find((s) => s.id === task.subjectId);
  const repeatValue = task.repeat ? task.repeat.kind : NONE;

  const chooseRepeat = (value: string): void => {
    closeMenu(true);
    if (value === repeatValue) return;
    if (value === NONE) save({ repeat: null });
    else save({ repeat: { kind: value as 'daily' | 'weekdays' | 'weekly' } });
  };

  return (
    <>
      <div className={styles.head}>
        <PlacementPicker task={task} />
        <div className={styles.headEnd}>
          <button type="button" className={styles.expand} onClick={expandDetail}>
            <span aria-hidden="true">⤢</span>
            Expand
          </button>
          <button type="button" className={detail.iconButton} aria-label="Close" onClick={closeDetail}>
            ×
          </button>
        </div>
      </div>

      <div className={styles.titleRow}>
        {/* One line of text that wraps to fit, as in the full detail: Enter saves, a line break becomes a space. */}
        <textarea
          className={styles.title}
          aria-label="Title"
          rows={1}
          value={title}
          onChange={(e) => {
            touch('title');
            setTitle(cap(e.target.value.replace(/\r?\n/g, ' '), TASK_TITLE_MAX));
          }}
          onBlur={commitTitle}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            e.currentTarget.blur();
          }}
        />
        <input
          type="checkbox"
          className={styles.done}
          checked={task.done}
          aria-label={task.done ? 'Mark as not done' : 'Mark as done'}
          onChange={() => save({ done: !task.done })}
        />
      </div>

      <textarea
        className={styles.note}
        aria-label="Note"
        placeholder="Add some extra notes here…"
        rows={4}
        value={note}
        onChange={(e) => {
          touch('note');
          setNote(cap(e.target.value, TASK_NOTE_MAX));
        }}
        onBlur={commitNote}
      />

      <div className={styles.chips} role="group" aria-label="Details">
        <span className={styles.chip}>
          <span
            className={styles.dot}
            aria-hidden="true"
            style={subject ? { background: subject.colour } : undefined}
            data-empty={subject ? undefined : 'true'}
          />
          <select
            className={styles.chipSelect}
            aria-label="Subject"
            value={task.subjectId ?? ''}
            onChange={(e) => save({ subjectId: e.target.value === '' ? null : Number(e.target.value) })}
          >
            <option value="">No subject</option>
            {subjectOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </span>
        <span className={styles.chip}>
          <select
            className={styles.chipSelect}
            aria-label="Estimate"
            value={estimate === null ? NONE : String(estimate)}
            onChange={(e) => save({ estimateMin: e.target.value === NONE ? null : Number(e.target.value) })}
          >
            <option value={NONE}>No estimate</option>
            {ESTIMATE_PRESETS.map((m) => (
              <option key={m} value={m}>
                {formatGoal(m * MIN_MS)}
              </option>
            ))}
            {estimate !== null && !isPreset && (
              <option value={estimate}>{formatGoal(estimate * MIN_MS)}</option>
            )}
          </select>
        </span>
        <div className={styles.tagSlot}>
          <TagInput tags={task.tags} label="Add a tag" onChange={(tags) => save({ tags })} />
        </div>
        {task.actualMs > 0 && <span className={styles.focused}>Focused {formatGoal(task.actualMs)}</span>}
      </div>

      {saveFailed && (
        <p role="alert" className={detail.hint}>
          {SAVE_FAILED}
        </p>
      )}

      {(subtasksShown || task.subtasks.length > 0) && (
        <div ref={subtasksRef} className={styles.subtasks}>
          <SubtaskList task={task} />
        </div>
      )}

      <div
        className={styles.tools}
        onKeyDown={(e) => {
          if (e.key !== 'Escape' || open === null) return;
          // The menu's own Esc: it closes the menu, not the card around it.
          e.preventDefault();
          e.stopPropagation();
          closeMenu(true);
        }}
        onBlur={(e) => {
          // Focus moving out of the bar and its menu closes the menu, as the other pickers do.
          if (
            open !== null &&
            e.relatedTarget instanceof Node &&
            !e.currentTarget.contains(e.relatedTarget)
          ) {
            closeMenu(false);
          }
        }}
      >
        <div className={styles.bar}>
          <button
            type="button"
            className={styles.tool}
            aria-label="Add subtask"
            data-set={task.subtasks.length > 0 || undefined}
            onClick={() => {
              setSubtasksShown(true);
              setFocusAdd((n) => n + 1);
            }}
          >
            <CardIcon>
              <path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" />
            </CardIcon>
          </button>
          <button
            ref={repeatButton}
            type="button"
            className={styles.tool}
            aria-label="Repeat"
            aria-haspopup="menu"
            aria-expanded={open === 'repeat'}
            aria-controls={open === 'repeat' ? panelId : undefined}
            disabled={!dated}
            title={dated ? undefined : 'Repeat is for tasks on a day'}
            data-set={task.repeat !== null || undefined}
            onClick={() => toggle('repeat')}
          >
            <CardIcon>
              <path d="M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3" />
            </CardIcon>
          </button>
          <button
            ref={colourButton}
            type="button"
            className={styles.tool}
            aria-label="Colour"
            aria-haspopup="menu"
            aria-expanded={open === 'colour'}
            aria-controls={open === 'colour' ? panelId : undefined}
            data-set={task.colour !== null || undefined}
            onClick={() => toggle('colour')}
          >
            <CardIcon>
              <path d="M12 3.5s6 6.4 6 10.8a6 6 0 0 1-12 0c0-4.4 6-10.8 6-10.8z" />
            </CardIcon>
          </button>
          <button
            ref={reminderButton}
            type="button"
            className={styles.tool}
            aria-label="Reminder"
            aria-expanded={open === 'reminder'}
            aria-controls={open === 'reminder' ? panelId : undefined}
            disabled={!dated}
            title={dated ? undefined : 'Reminders are for tasks on a day'}
            data-set={task.reminder !== null || undefined}
            onClick={() => toggle('reminder')}
          >
            <CardIcon>
              <path d="M6 9a6 6 0 0 1 12 0c0 6 2 7 2 7H4s2-1 2-7M10 20a2 2 0 0 0 4 0" />
            </CardIcon>
          </button>
          <button
            type="button"
            className={styles.tool}
            aria-label="Start focus"
            onClick={() => {
              void startTask(task.id);
              closeDetail();
            }}
          >
            <CardIcon>
              <path d="M8 5.5v13l10.5-6.5z" />
            </CardIcon>
          </button>
          <TaskMenu task={task} />
        </div>

        {open === 'repeat' && (
          <div
            id={panelId}
            ref={panel}
            role="menu"
            aria-label="Repeat"
            className={styles.menu}
            onKeyDown={onMenuKeys}
          >
            {REPEATS.map((r) => (
              <button
                key={r.value}
                type="button"
                role="menuitemradio"
                aria-checked={repeatValue === r.value}
                className={styles.menuItem}
                onClick={() => chooseRepeat(r.value)}
              >
                {r.label}
              </button>
            ))}
            <button
              type="button"
              role="menuitemradio"
              aria-checked={repeatValue === 'every'}
              className={styles.menuItem}
              onClick={() => {
                setMenu(null);
                expandDetail();
              }}
            >
              Every N days…
            </button>
          </div>
        )}

        {open === 'colour' && (
          <div
            id={panelId}
            ref={panel}
            role="menu"
            aria-label="Colour"
            aria-orientation="horizontal"
            className={`${styles.menu} ${styles.swatches}`}
            onKeyDown={onMenuKeys}
          >
            {[{ id: null, label: 'No colour' }, ...TASK_COLOURS].map((c) => (
              <button
                key={c.id ?? NONE}
                type="button"
                role="menuitemradio"
                aria-checked={task.colour === c.id}
                aria-label={c.label}
                title={c.label}
                className={detail.swatch}
                data-colour={c.id ?? undefined}
                onClick={() => {
                  closeMenu(true);
                  if (task.colour !== c.id) save({ colour: c.id });
                }}
              />
            ))}
          </div>
        )}

        {open === 'reminder' && (
          <div
            id={panelId}
            ref={panel}
            role="group"
            aria-label="Reminder"
            className={`${styles.menu} ${styles.reminder}`}
          >
            <input
              type="time"
              className={detail.input}
              aria-label="Reminder time"
              value={reminder}
              onChange={(e) => {
                touch('reminder');
                setReminder(e.target.value);
              }}
              onBlur={commitReminder}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                closeMenu(true);
              }}
            />
            <button
              type="button"
              className={detail.smallButton}
              onClick={() => {
                setReminder('');
                save({ reminder: null });
                closeMenu(true);
              }}
            >
              Clear
            </button>
          </div>
        )}
      </div>
    </>
  );
}
