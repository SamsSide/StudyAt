// The task detail popover (v1.2 spec §3.7): every field of one task, saved as it is edited. It is
// keyed on the store's detailTaskId, so a reminder click can open a task that is not on screen.
// The menu (Start focus, Schedule revision, Duplicate, Delete) is Task 20's, beside the close button.
import { useEffect, useRef, useState, type ReactNode } from 'react';
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
import type { PlannerTask, RepeatRule } from '../../shared/types';
import { useStudyStore } from '../shell/store';
import { formatGoal } from '../shell/format';
import { TASK_COLOURS } from '../tasks/taskColours';
import { plannerToday } from './format';
import { PlacementPicker } from './PlacementPicker';
import { usePlannerStore } from './plannerStore';
import { SubtaskList } from './SubtaskList';
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

/** Fetches the task if it is not in the store (a reminder click): today's day, then the lists. */
async function fetchTask(id: number): Promise<void> {
  const { apply } = usePlannerStore.getState();
  const rollover = useStudyStore.getState().settings?.rolloverHour ?? 4;
  const api = window.studyat.planner;
  const tries = [() => api.day(plannerToday(rollover)), () => api.lists()];
  for (const run of tries) {
    try {
      apply({ tasks: (await run()).tasks, removed: [] });
    } catch {
      // Try the next place.
    }
    if (usePlannerStore.getState().tasks[id]) return;
  }
}

export function TaskDetail() {
  const id = usePlannerStore((s) => s.detailTaskId);
  const task = usePlannerStore((s) => (s.detailTaskId === null ? undefined : s.tasks[s.detailTaskId]));
  const closeDetail = usePlannerStore((s) => s.closeDetail);
  const [lookedFor, setLookedFor] = useState<number | null>(null);

  // Not in the store: look for it once; if main has no such task, say so and close.
  useEffect(() => {
    if (id === null || task || lookedFor === id) return;
    let live = true;
    void fetchTask(id).then(() => {
      if (!live) return;
      setLookedFor(id);
      if (!usePlannerStore.getState().tasks[id]) {
        usePlannerStore.setState({ notice: TASK_GONE });
        usePlannerStore.getState().closeDetail();
      }
    });
    return () => {
      live = false;
    };
  }, [id, task, lookedFor]);

  // Esc closes the popover; a child that used Esc already (a picker) has called preventDefault.
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

  const commitTitle = (): void => {
    const next = title.trim();
    clearTitle();
    if (next === '' || next === task.title) return;
    void update(task.id, { title: next });
  };
  const commitNote = (): void => {
    clearNote();
    if (note !== task.note) void update(task.id, { note });
  };
  const commitReminder = (): void => {
    clearReminder();
    if (reminder === (task.reminder ?? '')) return;
    if (reminder === '') void update(task.id, { reminder: null });
    else if (REMINDER_RE.test(reminder)) void update(task.id, { reminder });
  };

  const estimate = task.estimateMin;
  const isPreset = estimate !== null && (ESTIMATE_PRESETS as readonly number[]).includes(estimate);
  const showCustom = customOpen || (estimate !== null && !isPreset);
  const estimateValue = showCustom ? CUSTOM : estimate === null ? NONE : String(estimate);

  const onEstimate = (value: string): void => {
    setCustomBad(false);
    if (value === CUSTOM) {
      setCustomOpen(true);
      setCustomText(estimate === null ? '' : String(estimate));
      return;
    }
    setCustomOpen(false);
    void update(task.id, { estimateMin: value === NONE ? null : Number(value) });
  };
  const commitCustom = (): void => {
    const n = Number(customText);
    if (!Number.isInteger(n) || n < ESTIMATE_MIN || n > ESTIMATE_MAX) {
      setCustomBad(customText !== '');
      return;
    }
    setCustomBad(false);
    if (n !== estimate) void update(task.id, { estimateMin: n });
  };

  const repeat = task.repeat;
  const onRepeat = (value: string): void => {
    setEveryBad(false);
    setEveryText(null);
    if (value === NONE) void update(task.id, { repeat: null });
    else if (value === 'every') void update(task.id, { repeat: { kind: 'every', days: REPEAT_EVERY_MIN } });
    else void update(task.id, { repeat: { kind: value as 'daily' | 'weekdays' | 'weekly' } });
  };
  const commitEvery = (): void => {
    if (everyText === null) return;
    const n = Number(everyText);
    if (!Number.isInteger(n) || n < REPEAT_EVERY_MIN || n > REPEAT_EVERY_MAX) {
      setEveryBad(true);
      return;
    }
    setEveryBad(false);
    setEveryText(null);
    if (!(repeat?.kind === 'every' && repeat.days === n)) {
      void update(task.id, { repeat: { kind: 'every', days: n } });
    }
  };

  const subjectOptions = subjects.filter((s) => !s.archived || s.id === task.subjectId);

  return (
    <div ref={root} role="dialog" aria-label={`Task: ${task.title}`} tabIndex={-1} className={styles.popover}>
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
          onChange={() => void update(task.id, { done: !task.done })}
        />
        <input
          className={styles.titleInput}
          aria-label="Title"
          value={title}
          onChange={(e) => setTitle(cap(e.target.value, TASK_TITLE_MAX))}
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
        onChange={(e) => setNote(cap(e.target.value, TASK_NOTE_MAX))}
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
            onChange={(e) =>
              void update(task.id, { subjectId: e.target.value === '' ? null : Number(e.target.value) })
            }
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
        <TagInput tags={task.tags} label="Add a tag" onChange={(tags) => void update(task.id, { tags })} />
      </Field>

      <Field label="Colour">
        <div className={styles.inline}>
          <button
            type="button"
            className={styles.swatch}
            aria-label="No colour"
            aria-pressed={task.colour === null}
            onClick={() => void update(task.id, { colour: null })}
          />
          {TASK_COLOURS.map((c) => (
            <button
              key={c.id}
              type="button"
              className={styles.swatch}
              data-colour={c.id}
              aria-label={c.label}
              aria-pressed={task.colour === c.id}
              onClick={() => void update(task.id, { colour: c.id })}
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
              onChange={(e) => setReminder(e.target.value)}
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

      <p className={styles.focused}>Focused: {formatGoal(task.actualMs)}</p>
    </div>
  );
}
