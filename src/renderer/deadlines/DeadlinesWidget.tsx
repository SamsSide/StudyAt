// The Deadlines widget body (v1.2 spec §3.10): open deadlines soonest first with a live countdown
// ("23d 4h", "31h 12m", "42m 08s", "Due"), a Past toggle for the last ten, and a form to add or
// edit one. Countdowns read the wall clock once a second while mounted. The shell's WidgetFrame
// supplies the glass (or none, in bare mode) and the "Hide background" toggle in the header.
import { useEffect, useId, useRef, useState } from 'react';
import { formatCountdown } from '../../core/deadlines';
import { calendarDate, parseDue } from '../../core/wallclock';
import type { Deadline, DeadlineInput, DeadlinesView } from '../../shared/types';
import { useStudyStore } from '../shell/store';
import { DeadlineForm } from './DeadlineForm';
import styles from './DeadlinesWidget.module.css';

/** Spec §3.10: the Past list shows the last ten. */
const PAST_SHOWN = 10;

/** "Due Fri, 20 Nov 2026, 14:30": read out as the row's description, so the name stays put. */
const dueText = (due: string): string =>
  `Due ${new Date(parseDue(due)).toLocaleString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })}`;

const byDue = (a: Deadline, b: Deadline): number => parseDue(a.due) - parseDue(b.due) || a.id - b.id;

type Editing = { kind: 'add' } | { kind: 'edit'; id: number } | null;

export function DeadlinesWidget() {
  const subjects = useStudyStore((s) => s.subjects);
  const [past, setPast] = useState(false);
  const [rows, setRows] = useState<Deadline[]>([]);
  // Which list (`past`) `rows` holds, and whether loading it failed; null until the first answer.
  const [answered, setAnswered] = useState<{ past: boolean; failed: boolean } | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [now, setNow] = useState(() => Date.now());
  // Bumped when the window regains focus so a long stay in the tray never shows stale rows.
  const [focusTick, setFocusTick] = useState(0);
  const addRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  // Where focus returns when the form closes: the edited row's id, or 'add'.
  const returnTo = useRef<number | 'add' | null>(null);
  // Which list request is the newest: a slow `list()` reply never overwrites what `apply()` showed since.
  const listSeq = useRef(0);
  const dueId = useId();
  // The calendar date of `now`: a new day re-lists, so a row that fell due leaves Upcoming.
  const today = calendarDate(now);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const onFocus = (): void => setFocusTick((n) => n + 1);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  useEffect(() => {
    if (editing !== null || returnTo.current === null) return;
    const target = returnTo.current;
    returnTo.current = null;
    const row =
      target === 'add' ? null : listRef.current?.querySelector<HTMLButtonElement>(`[data-id="${target}"]`);
    (row ?? addRef.current)?.focus();
  }, [editing, rows]);

  useEffect(() => {
    let live = true;
    const mine = ++listSeq.current;
    window.studyat.deadlines.list({ past }).then(
      (list) => {
        if (!live || mine !== listSeq.current) return;
        setRows(list);
        setAnswered({ past, failed: false });
      },
      () => {
        if (!live || mine !== listSeq.current) return;
        setRows([]);
        setAnswered({ past, failed: true });
      },
    );
    return () => {
      live = false;
    };
  }, [past, today, focusTick]);

  const apply = (view: DeadlinesView): void => {
    listSeq.current++;
    setAnswered({ past, failed: false });
    setRows(past ? view.past : view.upcoming);
    setEditing(null);
  };

  const loaded = answered?.past === past;
  const failed = loaded && answered.failed;
  const shown = !loaded
    ? []
    : past
      ? [...rows].sort((a, b) => byDue(b, a)).slice(0, PAST_SHOWN)
      : [...rows].sort(byDue);
  const editingRow = editing?.kind === 'edit' ? rows.find((d) => d.id === editing.id) : undefined;
  const api = window.studyat.deadlines;

  return (
    <div className={styles.widget}>
      {editing && (editing.kind === 'add' || editingRow) ? (
        <DeadlineForm
          key={editingRow?.id ?? 'new'}
          deadline={editingRow}
          onCancel={() => setEditing(null)}
          onSave={async (input: DeadlineInput) =>
            apply(editingRow ? await api.update(editingRow.id, input) : await api.create(input))
          }
          onDone={editingRow ? async (done) => apply(await api.update(editingRow.id, { done })) : undefined}
          onDelete={editingRow ? async () => apply(await api.remove(editingRow.id)) : undefined}
        />
      ) : (
        <>
          <div className={styles.bar}>
            {/* The plain glass button, like Past (P1, D9). */}
            <button
              type="button"
              ref={addRef}
              onClick={() => {
                returnTo.current = 'add';
                setEditing({ kind: 'add' });
              }}
            >
              + Add
            </button>
            <button type="button" aria-pressed={past} onClick={() => setPast((p) => !p)}>
              Past
            </button>
          </div>
          {failed ? (
            <p className={styles.empty}>Couldn't load your deadlines.</p>
          ) : shown.length === 0 ? (
            <p className={styles.empty}>
              {!loaded
                ? 'Loading…'
                : past
                  ? 'Nothing in the past yet.'
                  : 'No deadlines coming up. Enjoy the calm.'}
            </p>
          ) : (
            <ul className={styles.list} ref={listRef}>
              {shown.map((d) => {
                const subject = subjects.find((s) => s.id === d.subjectId);
                const countdown = formatCountdown(parseDue(d.due), now);
                return (
                  <li key={d.id}>
                    <button
                      type="button"
                      className={styles.row}
                      data-id={d.id}
                      aria-describedby={`${dueId}-${d.id}`}
                      aria-label={[
                        d.title,
                        d.kind === 'exam' ? 'Exam' : 'Coursework',
                        subject?.name,
                        d.done ? 'done' : undefined,
                      ]
                        .filter(Boolean)
                        .join(', ')}
                      onClick={() => {
                        returnTo.current = d.id;
                        setEditing({ kind: 'edit', id: d.id });
                      }}
                    >
                      <b className={styles.badge} data-kind={d.kind}>
                        {d.kind === 'exam' ? 'Exam' : 'CW'}
                      </b>
                      {subject && (
                        <span
                          className={styles.dot}
                          style={{ background: subject.colour }}
                          role="img"
                          aria-label={subject.name}
                        />
                      )}
                      <span className={styles.title}>{d.title}</span>
                      <span id={`${dueId}-${d.id}`} className={styles.visuallyHidden}>
                        {dueText(d.due)}
                      </span>
                      <span
                        className={styles.countdown}
                        aria-hidden="true"
                        data-due={!d.done && countdown === 'Due'}
                      >
                        {d.done ? 'Done' : countdown}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
