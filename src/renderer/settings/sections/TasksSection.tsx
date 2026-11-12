// Settings → Tasks (v1.2 spec §3.6, §3.9): roll unfinished tasks forward, and the tags and gaps
// that decide which finished tasks schedule revision.
import { useId, useState } from 'react';
import { LIMIT_COPY, MAX_TAGS, normaliseTag, REVISION_DAYS_MAX } from '../../../shared/planner';
import type { SettingsPatch } from '../../../shared/types';
import { useStudyStore } from '../../shell/store';
import { clamp, Toggle } from '../controls';
import styles from '../settings.module.css';
import own from './TasksSection.module.css';
import type { SectionProps } from './types';

const MAX_DAYS = 4;
const SAVE_FAILED = "Couldn't save that. Please try again.";

/** Rows that may wrap inside the content width instead of pushing the section sideways. */
const wrapStyle = { flexWrap: 'wrap', flexShrink: 1, minWidth: 0 } as const;

/** Sorted, de-duplicated copy: the saved arrays are shared defaults, never edited in place. */
const tidyDays = (days: readonly number[]): number[] => [...new Set(days)].sort((a, b) => a - b);

/** The latest saved lists, so a click never overwrites a change still settling from a blur. */
const latest = (): { tags: readonly string[]; days: readonly number[] } => {
  const s = useStudyStore.getState().settings;
  return { tags: s?.revisionTags ?? [], days: s?.revisionDays ?? [] };
};

function DayField({
  index,
  value,
  onCommit,
  onFailed,
}: {
  index: number;
  value: number;
  /** Saves the day; resolves false when it couldn't be saved (the field then reverts). */
  onCommit: (next: number) => Promise<boolean>;
  onFailed: (failed: boolean) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  // Follow the saved value when it changes (days re-sort after a save).
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setDraft(String(value));
  }

  const commit = async (): Promise<void> => {
    const parsed = Number(draft);
    if (draft.trim() === '' || !Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    const next = clamp(Math.round(parsed), 1, REVISION_DAYS_MAX);
    setDraft(String(next));
    if (next === value) return;
    onFailed(false);
    if (!(await onCommit(next))) {
      setDraft(String(value));
      onFailed(true);
    }
  };

  return (
    <input
      type="number"
      inputMode="numeric"
      aria-label={`Revision day ${index + 1}`}
      className={`${styles.input} ${styles.numberInput}`}
      min={1}
      max={REVISION_DAYS_MAX}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') void commit();
      }}
    />
  );
}

export function TasksSection({ settings, update }: SectionProps) {
  const tagId = useId();
  const tagHintId = useId();
  const tagsHeadingId = useId();
  const [tagDraft, setTagDraft] = useState('');
  const [failed, setFailed] = useState(false);
  const tags = settings.revisionTags;
  const days = settings.revisionDays;
  const tagsFull = tags.length >= MAX_TAGS;

  /** Saves a patch and shows the fixed line when it couldn't be saved. */
  const save = async (patch: SettingsPatch): Promise<boolean> => {
    setFailed(false);
    const ok = await update(patch);
    if (!ok) setFailed(true);
    return ok;
  };

  const addTag = async (): Promise<void> => {
    const tag = normaliseTag(tagDraft.trim());
    if (tag === null || tagsFull) return;
    const current = latest().tags;
    if (current.includes(tag)) {
      setTagDraft('');
      return;
    }
    // The draft is cleared only once the tag is saved.
    if (await save({ revisionTags: [...current, tag] })) setTagDraft('');
  };

  const setDay = (index: number, next: number): Promise<boolean> =>
    update({ revisionDays: tidyDays(latest().days.map((d, i) => (i === index ? next : d))) });

  const addDay = (): void => {
    const current = latest().days;
    let next = Math.max(...current) + 1;
    if (next > REVISION_DAYS_MAX) {
      next = 1;
      while (current.includes(next)) next += 1;
    }
    void save({ revisionDays: tidyDays([...current, next]) });
  };

  return (
    <section aria-labelledby="settings-tasks">
      <h3 id="settings-tasks" className={styles.heading}>
        Tasks
      </h3>
      <Toggle
        label="Move unfinished tasks to today"
        hint="At the start of a new day, tasks you didn't finish move across"
        checked={settings.rollTasksForward}
        onChange={(v) => update({ rollTasksForward: v })}
      />

      <div className={styles.listItem}>
        <div className={styles.grow}>
          <span id={tagsHeadingId} className={styles.label}>
            Revision tags
          </span>
          <div className={styles.hint}>Finishing a task with one of these tags schedules revision</div>
        </div>
        <ul
          className={`${styles.list} ${styles.controls} ${own.chips}`}
          style={wrapStyle}
          aria-labelledby={tagsHeadingId}
        >
          {tags.map((tag) => (
            <li key={tag} className={own.chip}>
              <span>{tag}</span>
              <button
                type="button"
                className={own.remove}
                aria-label={`Remove ${tag}`}
                onClick={() => void save({ revisionTags: latest().tags.filter((t) => t !== tag) })}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className={styles.listItem}>
        <div className={styles.grow}>
          <label className={styles.label} htmlFor={tagId}>
            Add a revision tag
          </label>
          <div id={tagHintId} className={styles.hint}>
            Letters, numbers and hyphens
          </div>
        </div>
        <input
          id={tagId}
          type="text"
          aria-describedby={tagHintId}
          className={styles.input}
          placeholder="Add a tag"
          maxLength={25}
          value={tagDraft}
          disabled={tagsFull}
          title={tagsFull ? LIMIT_COPY.tags : undefined}
          onChange={(e) => {
            setFailed(false);
            setTagDraft(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void addTag();
            }
          }}
        />
      </div>

      <div className={styles.listItem}>
        <div className={styles.grow}>
          <span className={styles.label}>Revision days</span>
          <div className={styles.hint}>Days after finishing that a revision task appears</div>
        </div>
        <div className={styles.controls} style={wrapStyle}>
          {days.map((day, i) => (
            <span key={i} className={own.day}>
              <DayField index={i} value={day} onCommit={(n) => setDay(i, n)} onFailed={setFailed} />
              {days.length > 1 && (
                <button
                  type="button"
                  className={own.remove}
                  aria-label={`Remove revision day ${i + 1}`}
                  onClick={() => void save({ revisionDays: latest().days.filter((_, j) => j !== i) })}
                >
                  ×
                </button>
              )}
            </span>
          ))}
          {days.length < MAX_DAYS && (
            <button type="button" className={styles.button} aria-label="Add a revision day" onClick={addDay}>
              Add
            </button>
          )}
        </div>
      </div>

      {failed && (
        <p role="alert" className={styles.error}>
          {SAVE_FAILED}
        </p>
      )}
    </section>
  );
}
