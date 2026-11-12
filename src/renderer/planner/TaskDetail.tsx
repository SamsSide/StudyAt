// The task detail popover (v1.2 spec §3.7): every field of one task, saved as it is edited. It is
// keyed on the store's detailTaskId, so a reminder click can open a task that is not on screen.
// The menu (Start focus, Schedule revision, Duplicate, Delete) is Task 20's, beside the close button.
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  ESTIMATE_MAX,
  ESTIMATE_MIN,
  ESTIMATE_PRESETS,
  REMINDER_RE,
  REPEAT_EVERY_MAX,
  REPEAT_EVERY_MIN,
  TASK_GONE,
  TASK_NOTE_MAX,
  TASK_TITLE_MAX,
} from '../../shared/planner';
import type { PlannerTask, RepeatRule, TaskUpdate } from '../../shared/types';
import { useStudyStore } from '../shell/store';
import { formatGoal } from '../shell/format';
import { TASK_COLOURS } from '../tasks/taskColours';
import { PlacementPicker } from './PlacementPicker';
import { usePlannerStore } from './plannerStore';
import { SAVE_FAILED, SubtaskList } from './SubtaskList';
import { TagInput } from './TagInput';
import styles from './detail.module.css';

const MIN_MS = 60_000;
const NONE = 'none';
const CUSTOM = 'custom';

/** Caps by code points, never UTF-16 units. */
const cap = (s: string, max: number): string => [...s].slice(0, max).join('');

/** A text field's draft: it belongs to the saved value it started from, so a change from main drops it. */
function useDraft(value: string): [string, (text: string) => void, () => void] {
  const [draft, setDraft] = useState<{ of: string; text: string } | null>(null);
  const text = draft && draft.of === value ? draft.text : value;
  return [text, (t) => setDraft({ of: value, text: t }), () => setDraft(null)];
}

const minutesLabel = (min: number): string => formatGoal(min * MIN_MS);

const repeatKind = (r: RepeatRule | null): string => (r ? r.kind : NONE);

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.field} role="group" aria-label={label}>
      <span className={styles.fieldLabel}>{label}</span>
      {children}
    </div>
  );
}

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

export function TaskDetail() {
  const id = usePlannerStore((s) => s.detailTaskId);
  const task = usePlannerStore((s) => (s.detailTaskId === null ? undefined : s.tasks[s.detailTaskId]));
  const closeDetail = usePlannerStore((s) => s.closeDetail);

  // Not in the store (a reminder click): ask main for it. Re-runs whenever the id changes or the
  // popover closes, so opening a missing task twice says so twice. Main has no such task: say so, close.
  useEffect(() => {
    if (id === null || task) return;
    let live = true;
    const gone = (): void => {
      if (!live) return;
      usePlannerStore.setState({ notice: TASK_GONE });
      usePlannerStore.getState().closeDetail();
    };
    window.studyat.planner.task(id).then((found) => {
      if (!live) return;
      if (found) usePlannerStore.getState().apply({ tasks: [found], removed: [] });
      else gone();
    }, gone);
    return () => {
      live = false;
    };
  }, [id, task]);

  // Esc closes the popover from anywhere outside it too; inside, the dialog's own key handler does
  // (it stops keys reaching the shell). A child that used Esc already (a picker) has called preventDefault.
  useEffect(() => {
    if (id === null) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      closeDetail();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [id, closeDetail]);

  if (!task) return null;
  return createPortal(<Popover key={task.id} task={task} />, document.body);
}

function Popover({ task }: { task: PlannerTask }) {
  const update = usePlannerStore((s) => s.update);
  const closeDetail = usePlannerStore((s) => s.closeDetail);
  const subjects = useStudyStore((s) => s.subjects);
  const root = useRef<HTMLDivElement>(null);
  const dated = task.day !== null;

  // Focus moves in on open and back to where it was on close.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    root.current?.focus();
    return () => before?.focus?.();
  }, []);

  const [title, setTitle, clearTitle] = useDraft(task.title);
  const [note, setNote, clearNote] = useDraft(task.note);
  const [reminder, setReminder, clearReminder] = useDraft(task.reminder ?? '');
  const [customOpen, setCustomOpen] = useState(false);
  const [customText, setCustomText] = useState('');
  const [customBad, setCustomBad] = useState(false);
  const [everyText, setEveryText] = useState<string | null>(null);
  const [everyBad, setEveryBad] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  // Fields with typing not yet saved. Esc, Close and unmount deliver no blur, so they are saved on the
  // way out (below).
  const dirty = useRef(new Set<string>());
  const touch = (key: string): void => {
    dirty.current.add(key);
    setSaveFailed(false);
  };

  /** Saves a patch; when main refuses it (the field is still as it was) say so rather than revert quietly. */
  const save = (patch: TaskUpdate): void => {
    setSaveFailed(false);
    const read = (): Record<string, unknown> | undefined => {
      const t: PlannerTask | undefined = usePlannerStore.getState().tasks[task.id];
      return t ? { ...t } : undefined;
    };
    const before = read();
    void update(task.id, patch).then(() => {
      const now = read();
      if (!before || !now) return;
      const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
      const patched = patch as Record<string, unknown>;
      if (Object.keys(patched).some((k) => !same(now[k], patched[k]) && same(now[k], before[k]))) {
        setSaveFailed(true);
      }
    });
  };

  const commitTitle = (): void => {
    dirty.current.delete('title');
    const next = title.trim();
    // The draft stays until the store echoes the new title, so the field never flashes the old one.
    if (next === '' || next === task.title) clearTitle();
    else save({ title: next });
  };
  const commitNote = (): void => {
    dirty.current.delete('note');
    if (note === task.note) clearNote();
    else save({ note });
  };
  const commitReminder = (): void => {
    dirty.current.delete('reminder');
    if (reminder === (task.reminder ?? '')) clearReminder();
    else if (reminder === '') save({ reminder: null });
    else if (REMINDER_RE.test(reminder)) save({ reminder });
    else clearReminder();
  };

  const estimate = task.estimateMin;
  const isPreset = estimate !== null && (ESTIMATE_PRESETS as readonly number[]).includes(estimate);
  const showCustom = customOpen || (estimate !== null && !isPreset);
  const estimateValue = showCustom ? CUSTOM : estimate === null ? NONE : String(estimate);

  const onEstimate = (value: string): void => {
    dirty.current.delete('custom');
    setCustomBad(false);
    if (value === CUSTOM) {
      setCustomOpen(true);
      setCustomText(estimate === null ? '' : String(estimate));
      return;
    }
    setCustomOpen(false);
    save({ estimateMin: value === NONE ? null : Number(value) });
  };
  const commitCustom = (): void => {
    dirty.current.delete('custom');
    const n = Number(customText);
    if (!Number.isInteger(n) || n < ESTIMATE_MIN || n > ESTIMATE_MAX) {
      setCustomBad(customText !== '');
      return;
    }
    setCustomBad(false);
    if (n !== estimate) save({ estimateMin: n });
  };

  const repeat = task.repeat;
  const onRepeat = (value: string): void => {
    dirty.current.delete('every');
    setEveryBad(false);
    setEveryText(null);
    if (value === NONE) save({ repeat: null });
    else if (value === 'every') save({ repeat: { kind: 'every', days: REPEAT_EVERY_MIN } });
    else save({ repeat: { kind: value as 'daily' | 'weekdays' | 'weekly' } });
  };
  const commitEvery = (): void => {
    dirty.current.delete('every');
    if (everyText === null) return;
    const n = Number(everyText);
    if (!Number.isInteger(n) || n < REPEAT_EVERY_MIN || n > REPEAT_EVERY_MAX) {
      setEveryBad(true);
      return;
    }
    setEveryBad(false);
    setEveryText(null);
    if (!(repeat?.kind === 'every' && repeat.days === n)) {
      save({ repeat: { kind: 'every', days: n } });
    }
  };

  // Whatever is still pending when the dialog goes (Esc, Close, another task) is saved, not dropped.
  const commits: Record<string, () => void> = {
    title: commitTitle,
    note: commitNote,
    reminder: commitReminder,
    custom: commitCustom,
    every: commitEvery,
  };
  const latest = useRef(commits);
  useEffect(() => {
    latest.current = commits;
  });
  useEffect(
    () => () => {
      for (const key of [...dirty.current]) latest.current[key]?.();
    },
    [],
  );

  // A dialog traps Tab and keeps its keys to itself: nothing behind it, shell shortcuts included,
  // sees a key pressed inside it. Esc closes (and the unmount saves). A picker's own Esc has
  // already stopped here.
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Escape' && !e.defaultPrevented) {
      e.preventDefault();
      closeDetail();
    } else if (e.key === 'Tab' && root.current) {
      const items = [...root.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const first = items[0];
      const last = items[items.length - 1];
      const at = document.activeElement;
      if (first && last) {
        if (e.shiftKey && (at === first || at === root.current)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && (at === last || at === root.current)) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    e.stopPropagation();
  };

  const subjectOptions = subjects.filter((s) => !s.archived || s.id === task.subjectId);

  return (
    <div
      ref={root}
      role="dialog"
      aria-modal="true"
      aria-label={`Task: ${task.title}`}
      tabIndex={-1}
      className={styles.popover}
      onKeyDown={onKeyDown}
    >
      <div className={styles.top}>
        <PlacementPicker task={task} />
        {/* Task 20 adds the task menu here. */}
        <button type="button" className={styles.iconButton} aria-label="Close" onClick={closeDetail}>
          ×
        </button>
      </div>

      <div className={styles.titleRow}>
        <input
          type="checkbox"
          className={styles.check}
          checked={task.done}
          aria-label={task.done ? 'Mark as not done' : 'Mark as done'}
          onChange={() => save({ done: !task.done })}
        />
        <input
          className={styles.titleInput}
          aria-label="Title"
          value={title}
          onChange={(e) => {
            touch('title');
            setTitle(cap(e.target.value, TASK_TITLE_MAX));
          }}
          onBlur={commitTitle}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
        />
      </div>

      <textarea
        className={styles.note}
        aria-label="Note"
        placeholder="Add a note"
        rows={3}
        value={note}
        onChange={(e) => {
          touch('note');
          setNote(cap(e.target.value, TASK_NOTE_MAX));
        }}
        onBlur={commitNote}
      />

      <Field label="Subtasks">
        <SubtaskList task={task} />
      </Field>

      <div className={styles.grid}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Subject</span>
          <select
            className={styles.input}
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
        </label>

        <label className={styles.field}>
          <span className={styles.fieldLabel}>Estimate</span>
          <select className={styles.input} value={estimateValue} onChange={(e) => onEstimate(e.target.value)}>
            <option value={NONE}>None</option>
            {ESTIMATE_PRESETS.map((m) => (
              <option key={m} value={m}>
                {minutesLabel(m)}
              </option>
            ))}
            <option value={CUSTOM}>Custom…</option>
          </select>
        </label>
      </div>

      {showCustom && (
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Custom estimate (minutes)</span>
          <input
            type="number"
            className={styles.input}
            min={ESTIMATE_MIN}
            max={ESTIMATE_MAX}
            value={customOpen ? customText : String(estimate ?? '')}
            aria-invalid={customBad || undefined}
            onChange={(e) => {
              touch('custom');
              setCustomOpen(true);
              setCustomText(e.target.value);
              setCustomBad(false);
            }}
            onBlur={commitCustom}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitCustom();
            }}
          />
          {customBad && (
            <p role="alert" className={styles.hint}>
              {ESTIMATE_MIN} to {ESTIMATE_MAX} minutes.
            </p>
          )}
        </label>
      )}

      <Field label="Tags">
        <TagInput tags={task.tags} label="Add a tag" onChange={(tags) => save({ tags })} />
      </Field>

      <Field label="Colour">
        <div className={styles.inline}>
          <button
            type="button"
            className={styles.swatch}
            aria-label="No colour"
            aria-pressed={task.colour === null}
            onClick={() => save({ colour: null })}
          />
          {TASK_COLOURS.map((c) => (
            <button
              key={c.id}
              type="button"
              className={styles.swatch}
              data-colour={c.id}
              aria-label={c.label}
              aria-pressed={task.colour === c.id}
              onClick={() => save({ colour: c.id })}
            />
          ))}
        </div>
      </Field>

      {dated && (
        <div className={styles.grid}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Repeat</span>
            <select
              className={styles.input}
              value={repeatKind(repeat)}
              onChange={(e) => onRepeat(e.target.value)}
            >
              <option value={NONE}>None</option>
              <option value="daily">Daily</option>
              <option value="weekdays">Weekdays</option>
              <option value="weekly">Weekly</option>
              <option value="every">Every N days</option>
            </select>
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Reminder</span>
            <input
              type="time"
              className={styles.input}
              value={reminder}
              onChange={(e) => {
                touch('reminder');
                setReminder(e.target.value);
              }}
              onBlur={commitReminder}
            />
          </label>
        </div>
      )}

      {dated && repeat?.kind === 'every' && (
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Every N days</span>
          <input
            type="number"
            className={styles.input}
            min={REPEAT_EVERY_MIN}
            max={REPEAT_EVERY_MAX}
            value={everyText ?? String(repeat.days)}
            aria-invalid={everyBad || undefined}
            onChange={(e) => {
              touch('every');
              setEveryText(e.target.value);
              setEveryBad(false);
            }}
            onBlur={commitEvery}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitEvery();
            }}
          />
          {everyBad && (
            <p role="alert" className={styles.hint}>
              {REPEAT_EVERY_MIN} to {REPEAT_EVERY_MAX} days.
            </p>
          )}
        </label>
      )}

      {saveFailed && (
        <p role="alert" className={styles.hint}>
          {SAVE_FAILED}
        </p>
      )}

      <p className={styles.focused}>Focused: {formatGoal(task.actualMs)}</p>
    </div>
  );
}
