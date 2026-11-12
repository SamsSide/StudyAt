// The deadline form (v1.2 spec §3.10): add or edit one. Time follows the kind (exam 09:00,
// coursework 12:00) until the time is edited by hand. Mark done and Delete (asked in place) show
// when editing an existing deadline.
import { useState, type FormEvent } from 'react';
import { DEADLINE_DEFAULT_TIME } from '../../core/deadlines';
import { DEADLINE_NOTE_MAX, DEADLINE_TITLE_MAX } from '../../shared/planner';
import type { Deadline, DeadlineInput, DeadlineKind } from '../../shared/types';
import { useStudyStore } from '../shell/store';
import styles from './DeadlinesWidget.module.css';

interface Props {
  /** The deadline being edited; absent for "+ Add". */
  deadline?: Deadline | undefined;
  onSave(input: DeadlineInput): Promise<void>;
  onDone?: ((done: boolean) => Promise<void>) | undefined;
  onDelete?: (() => Promise<void>) | undefined;
  onCancel(): void;
}

const KINDS: readonly { kind: DeadlineKind; label: string }[] = [
  { kind: 'exam', label: 'Exam' },
  { kind: 'coursework', label: 'Coursework' },
];

export function DeadlineForm({ deadline, onSave, onDone, onDelete, onCancel }: Props) {
  const subjects = useStudyStore((s) => s.subjects);
  const [dueDate = '', dueTime = ''] = deadline ? deadline.due.split('T') : [];
  const [title, setTitle] = useState(deadline?.title ?? '');
  const [kind, setKind] = useState<DeadlineKind>(deadline?.kind ?? 'exam');
  const [subjectId, setSubjectId] = useState<number | null>(deadline?.subjectId ?? null);
  const [date, setDate] = useState(dueDate);
  const [time, setTime] = useState(deadline ? dueTime : DEADLINE_DEFAULT_TIME.exam);
  // An existing deadline's time is its own; a new one's follows the kind until it's edited.
  const [timeEdited, setTimeEdited] = useState(deadline !== undefined);
  const [note, setNote] = useState(deadline?.note ?? '');
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const chooseKind = (next: DeadlineKind): void => {
    setKind(next);
    if (!timeEdited) setTime(DEADLINE_DEFAULT_TIME[next]);
  };

  const run = async (job: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await job();
    } catch {
      setError("That didn't save. Try again.");
      setBusy(false);
    }
  };

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    const trimmed = title.trim();
    if (trimmed === '') return setError('Give it a title.');
    if (trimmed.length > DEADLINE_TITLE_MAX)
      return setError(`Keep the title to ${DEADLINE_TITLE_MAX} characters or fewer.`);
    if (date === '' || time === '') return setError('Pick a date and a time.');
    if (note.length > DEADLINE_NOTE_MAX) return setError('That note is too long.');
    void run(() => onSave({ title: trimmed, kind, subjectId, due: `${date}T${time}`, note }));
  };

  return (
    <form className={styles.form} onSubmit={submit} aria-label={deadline ? 'Edit deadline' : 'Add deadline'}>
      <label className={styles.field}>
        Title
        <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
      </label>
      <div className={styles.pair}>
        <label className={styles.field}>
          Kind
          <select value={kind} onChange={(e) => chooseKind(e.target.value as DeadlineKind)}>
            {KINDS.map((k) => (
              <option key={k.kind} value={k.kind}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          Subject
          <select
            value={subjectId ?? ''}
            onChange={(e) => setSubjectId(e.target.value === '' ? null : Number(e.target.value))}
          >
            <option value="">No subject</option>
            {subjects
              .filter((s) => !s.archived || s.id === subjectId)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </select>
        </label>
      </div>
      <div className={styles.pair}>
        <label className={styles.field}>
          Date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className={styles.field}>
          Time
          <input
            type="time"
            value={time}
            onChange={(e) => {
              setTime(e.target.value);
              setTimeEdited(true);
            }}
          />
        </label>
      </div>
      <label className={styles.field}>
        Note
        <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {confirming ? (
        <div className={styles.actions} role="group" aria-label="Confirm delete">
          <span>Delete this deadline?</span>
          <button
            type="button"
            className={styles.danger}
            disabled={busy}
            onClick={() => void run(() => onDelete?.() ?? Promise.resolve())}
          >
            Yes, delete
          </button>
          <button type="button" onClick={() => setConfirming(false)}>
            Keep it
          </button>
        </div>
      ) : (
        <div className={styles.actions}>
          <button type="submit" className={styles.primary} disabled={busy}>
            Save
          </button>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          {deadline && onDone && (
            <button type="button" disabled={busy} onClick={() => void run(() => onDone(!deadline.done))}>
              {deadline.done ? 'Mark not done' : 'Mark done'}
            </button>
          )}
          {deadline && onDelete && (
            <button type="button" className={styles.danger} onClick={() => setConfirming(true)}>
              Delete
            </button>
          )}
        </div>
      )}
    </form>
  );
}
