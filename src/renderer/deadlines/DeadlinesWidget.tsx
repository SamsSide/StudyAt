// The Deadlines widget body (v1.2 spec §3.10): open deadlines soonest first with a live countdown
// ("23d 4h", "31h 12m", "42m 08s", "Due"), a Past toggle for the last ten, and a form to add or
// edit one. Countdowns read the wall clock once a second while mounted. The shell's WidgetFrame
// supplies the glass (or none, in bare mode) and the "Hide background" toggle in the header.
import { useEffect, useState } from 'react';
import { formatCountdown } from '../../core/deadlines';
import { parseDue } from '../../core/wallclock';
import type { Deadline, DeadlineInput, DeadlinesView } from '../../shared/types';
import { useStudyStore } from '../shell/store';
import { DeadlineForm } from './DeadlineForm';
import styles from './DeadlinesWidget.module.css';

/** Spec §3.10: the Past list shows the last ten. */
const PAST_SHOWN = 10;

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

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    let live = true;
    window.studyat.deadlines.list({ past }).then(
      (list) => {
        if (!live) return;
        setRows(list);
        setAnswered({ past, failed: false });
      },
      () => {
        if (!live) return;
        setRows([]);
        setAnswered({ past, failed: true });
      },
    );
    return () => {
      live = false;
    };
  }, [past]);

  const apply = (view: DeadlinesView): void => {
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
            <button type="button" className={styles.primary} onClick={() => setEditing({ kind: 'add' })}>
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
            <ul className={styles.list}>
              {shown.map((d) => {
                const subject = subjects.find((s) => s.id === d.subjectId);
                const countdown = formatCountdown(parseDue(d.due), now);
                return (
                  <li key={d.id}>
                    <button
                      type="button"
                      className={styles.row}
                      onClick={() => setEditing({ kind: 'edit', id: d.id })}
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
                      <span className={styles.countdown} data-due={!d.done && countdown === 'Due'}>
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
