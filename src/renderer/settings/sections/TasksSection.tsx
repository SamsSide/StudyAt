// Settings → Tasks (v1.2 spec §3.6, §3.9): roll unfinished tasks forward, and the tags and gaps
// that decide which finished tasks schedule revision.
import { useId, useState } from 'react';
import { LIMIT_COPY, MAX_TAGS, normaliseTag, REVISION_DAYS_MAX } from '../../../shared/planner';
import { clamp, Toggle } from '../controls';
import styles from '../settings.module.css';
import type { SectionProps } from './types';

const MAX_DAYS = 4;

/** Sorted, de-duplicated copy: the saved arrays are shared defaults, never edited in place. */
const tidyDays = (days: readonly number[]): number[] => [...new Set(days)].sort((a, b) => a - b);

function DayField({
  index,
  value,
  onCommit,
}: {
  index: number;
  value: number;
  onCommit: (next: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  // Follow the saved value when it changes (days re-sort after a save).
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setDraft(String(value));
  }

  const commit = (): void => {
    const parsed = Number(draft);
    if (draft.trim() === '' || !Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    const next = clamp(Math.round(parsed), 1, REVISION_DAYS_MAX);
    setDraft(String(next));
    if (next !== value) onCommit(next);
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
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
      }}
    />
  );
}

export function TasksSection({ settings, update }: SectionProps) {
  const tagId = useId();
  const [tagDraft, setTagDraft] = useState('');
  const tags = settings.revisionTags;
  const days = settings.revisionDays;
  const tagsFull = tags.length >= MAX_TAGS;

  const addTag = (): void => {
    const tag = normaliseTag(tagDraft.trim());
    if (tag === null || tagsFull) return;
    setTagDraft('');
    if (!tags.includes(tag)) void update({ revisionTags: [...tags, tag] });
  };

  const setDay = (index: number, next: number): void => {
    void update({ revisionDays: tidyDays(days.map((d, i) => (i === index ? next : d))) });
  };

  const addDay = (): void => {
    const largest = Math.max(...days);
    let next = largest + 1;
    if (next > REVISION_DAYS_MAX) {
      next = 1;
      while (days.includes(next)) next += 1;
    }
    void update({ revisionDays: tidyDays([...days, next]) });
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
          <label className={styles.label} htmlFor={tagId}>
            Revision tags
          </label>
          <div className={styles.hint}>Finishing a task with one of these tags schedules revision</div>
        </div>
        <ul className={`${styles.list} ${styles.controls}`} aria-label="Revision tags">
          {tags.map((tag) => (
            <li key={tag} className={styles.controls}>
              <span>{tag}</span>
              <button
                type="button"
                className={styles.button}
                aria-label={`Remove ${tag}`}
                onClick={() => void update({ revisionTags: tags.filter((t) => t !== tag) })}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
        <input
          id={tagId}
          type="text"
          aria-label="Add a revision tag"
          className={styles.input}
          placeholder="Add a tag"
          maxLength={25}
          value={tagDraft}
          disabled={tagsFull}
          title={tagsFull ? LIMIT_COPY.tags : undefined}
          onChange={(e) => setTagDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addTag();
            }
          }}
        />
      </div>

      <div className={styles.listItem}>
        <div className={styles.grow}>
          <span className={styles.label}>Revision days</span>
          <div className={styles.hint}>Days after finishing that a revision task appears</div>
        </div>
        <div className={styles.controls}>
          {days.map((day, i) => (
            <span key={i} className={styles.controls}>
              <DayField index={i} value={day} onCommit={(n) => setDay(i, n)} />
              {days.length > 1 && (
                <button
                  type="button"
                  className={styles.button}
                  aria-label={`Remove revision day ${i + 1}`}
                  onClick={() => void update({ revisionDays: days.filter((_, j) => j !== i) })}
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
    </section>
  );
}
