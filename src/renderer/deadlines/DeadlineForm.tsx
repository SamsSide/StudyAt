// The deadline form (v1.2 spec §3.10): add or edit one. Time follows the kind (exam 09:00,
// coursework 12:00) until the time is edited by hand. Mark done and Delete (asked in place) show
// when editing an existing deadline.
import { useEffect, useRef, useState, type FormEvent } from 'react';
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

const SAVE_FAILED = "That didn't save. Try again.";
const DELETE_FAILED = "Couldn't delete that. Try again.";
const UPDATE_FAILED = "Couldn't update that. Try again.";

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

  const keepRef = useRef<HTMLButtonElement>(null);
  const deleteRef = useRef<HTMLButtonElement>(null);
  const askedToDelete = useRef(false);
  // The in-place confirm takes focus (on "Keep it", the safe answer); backing out returns it.
  useEffect(() => {
    if (confirming) {
      askedToDelete.current = true;
      keepRef.current?.focus();
    } else if (askedToDelete.current) {
      askedToDelete.current = false;
      deleteRef.current?.focus();
    }
  }, [confirming]);

  const run = async (job: () => Promise<void>, failure = SAVE_FAILED): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await job();
    } catch {
      setError(failure);
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
            onClick={() => void run(() => onDelete?.() ?? Promise.resolve(), DELETE_FAILED)}
          >
            Yes, delete
          </button>
          <button type="button" ref={keepRef} onClick={() => setConfirming(false)}>
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
            <button type="button" disabled={busy} onClick={() => void run(() => onDone(!deadline.done), UPDATE_FAILED)}>
              {deadline.done ? 'Mark not done' : 'Mark done'}
            </button>
          )}
          {deadline && onDelete && (
            <button type="button" className={styles.danger} ref={deleteRef} onClick={() => setConfirming(true)}>
              Delete
            </button>
          )}
        </div>
      )}
    </form>
  );
}
