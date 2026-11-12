// "Sessions" (spec §4): every recorded focus row, newest first. A session's subject can be changed
// or the session deleted (after a confirm inside the overlay), and nothing else: there is no way
// to edit its time (spec §3.4 rule 10). A running session belongs to the timer and is left alone.
// After a change the overlay's revision bumps, so every number reloads from main, and the stats
// widgets on the space refetch too. Each row shows the focus's intention and how it went (v1.2
// spec §3.11): ✓ Done, ½ Partly, ✗ Not.
import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';
import { NO_SUBJECT_NAME } from '../../core/stats/totals';
import type { Session, SessionOutcome } from '../../shared/types';
import { logIpcError } from '../lib/ipcError';
import { formatHm } from '../shell/format';
import { useStudyStore } from '../shell/store';
import { usePlannerStore } from '../planner/plannerStore';
import { refreshStatCards } from '../statWidgets/statWidgetsStore';
import { formatClockTime, formatDayLabel } from './format';
import { LoadError } from './LoadError';
import { Skeleton } from './Skeleton';
import styles from './stats.module.css';
import { useStatsQuery } from './useStatsQuery';

const PAGE = 50;
/** Shown for a subject id the store doesn't know (deleted elsewhere, or subjects not loaded yet). */
const UNKNOWN_SUBJECT_NAME = 'Unknown subject';

/** A subject change shown before main's answer reloads the table; `saved` once main has it. */
interface Edit {
  subjectId: number | null;
  saved: boolean;
}

/** The outcome mark and its spoken name (spec §3.11). */
const OUTCOME_MARKS: Record<SessionOutcome, { mark: string; label: string }> = {
  done: { mark: '✓', label: 'Done' },
  partly: { mark: '½', label: 'Partly' },
  not: { mark: '✗', label: 'Not' },
};

const loadSessions = (): Promise<Session[]> => window.studyat.stats.sessions();

function TrashIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
    </svg>
  );
}

export function SessionsTable({
  revision,
  onChanged,
  className,
}: {
  revision: number;
  onChanged: () => void;
  className?: string;
}) {
  const titleId = useId();
  const subjects = useStudyStore((s) => s.subjects);
  const query = useStatsQuery(loadSessions, undefined, revision);
  // Subject changes show at once, before main's answer reloads the table.
  const [edits, setEdits] = useState<ReadonlyMap<number, Edit>>(new Map());
  const [confirming, setConfirming] = useState<number | null>(null);
  // Deleted rows leave at once, before main's answer reloads the table.
  const [gone, setGone] = useState<ReadonlySet<number>>(new Set());
  const [shown, setShown] = useState(PAGE);
  const [error, setError] = useState<string | null>(null);
  const wrap = useRef<HTMLDivElement>(null);

  // Cancel is the safe default, so a stray Enter never deletes study time.
  useEffect(() => {
    if (confirming !== null) wrap.current?.querySelector<HTMLButtonElement>('[data-cancel]')?.focus();
  }, [confirming]);

  // When main's rows land, they win: drop every edit main has saved or already agrees with, and
  // every deleted id it no longer returns. Only a change still on its way stays on top.
  const data = query.status === 'ready' ? query.data : null;
  const [seen, setSeen] = useState(data);
  if (data !== seen) {
    setSeen(data);
    if (data) {
      const byId = new Map(data.map((s) => [s.id, s]));
      setEdits(
        (m) => new Map([...m].filter(([id, e]) => !e.saved && byId.get(id)?.subjectId !== e.subjectId)),
      );
      setGone((g) => new Set([...g].filter((id) => byId.has(id))));
    }
  }

  const sessions =
    query.status === 'ready'
      ? query.data.filter((s) => !gone.has(s.id)).sort((a, b) => b.startedAt - a.startedAt)
      : null;
  const live = subjects.filter((s) => !s.archived).sort((a, b) => a.sort - b.sort);

  const subjectOf = (s: Session): number | null => {
    const edit = edits.get(s.id);
    return edit ? edit.subjectId : s.subjectId;
  };

  /** Applies `change` to this session's edit only if it is still the one for `subjectId`. */
  const settle = (id: number, subjectId: number | null, change: (e: Edit) => Edit | null): void => {
    setEdits((m) => {
      const edit = m.get(id);
      if (!edit || edit.subjectId !== subjectId) return m;
      const next = new Map(m);
      const changed = change(edit);
      if (changed) next.set(id, changed);
      else next.delete(id);
      return next;
    });
  };

  const changeSubject = async (s: Session, subjectId: number | null): Promise<void> => {
    setEdits((m) => new Map(m).set(s.id, { subjectId, saved: false }));
    setError(null);
    try {
      await window.studyat.stats.updateSession(s.id, { subjectId });
      settle(s.id, subjectId, (e) => ({ ...e, saved: true }));
      onChanged();
      refreshStatCards();
      void usePlannerStore.getState().reload();
    } catch (err) {
      logIpcError('Changing a session subject failed', err);
      settle(s.id, subjectId, () => null);
      setError('Couldn’t change that session’s subject. Please try again.');
    }
  };

  const focusDeleteButton = (id: number): void => {
    wrap.current?.querySelector<HTMLButtonElement>(`[data-delete="${id}"]`)?.focus();
  };

  const cancel = (id: number): void => {
    setConfirming(null);
    // The button is back once the confirm row has gone.
    requestAnimationFrame(() => focusDeleteButton(id));
  };

  const remove = async (s: Session): Promise<void> => {
    setError(null);
    try {
      await window.studyat.stats.deleteSession(s.id);
      setGone((g) => new Set(g).add(s.id));
      setConfirming(null);
      wrap.current?.focus();
      onChanged();
      refreshStatCards();
      void usePlannerStore.getState().reload();
    } catch (err) {
      logIpcError('Deleting a session failed', err);
      setError('Couldn’t delete that session. Please try again.');
    }
  };

  const onConfirmKey = (e: KeyboardEvent<HTMLDivElement>, id: number): void => {
    if (e.key !== 'Escape') return;
    // Esc backs out of the confirm, not out of the whole overlay.
    e.preventDefault();
    e.stopPropagation();
    cancel(id);
  };

  return (
    <section className={className} aria-labelledby={titleId} aria-busy={query.status === 'loading'}>
      <div className={styles.sectionHeader}>
        <h3 id={titleId} className={styles.sectionTitle}>
          Sessions
        </h3>
        {sessions && sessions.length > 0 && (
          <p className={styles.muted}>Change a subject, or delete a session.</p>
        )}
      </div>
      {query.status === 'loading' && <Skeleton kind="table" />}
      {query.status === 'error' && (
        <LoadError message="Couldn’t load your sessions." onRetry={query.reload} />
      )}
      {error && (
        <p className={styles.muted} role="alert">
          {error}
        </p>
      )}
      {sessions && sessions.length === 0 && (
        <p className={styles.empty}>No sessions yet. Start a Pomodoro and they’ll appear here.</p>
      )}
      {sessions && sessions.length > 0 && (
        <div className={styles.tableWrap} ref={wrap} tabIndex={-1}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Day</th>
                <th scope="col">Time</th>
                <th scope="col" className={styles.numeric}>
                  Focus
                </th>
                <th scope="col">Subject</th>
                <th scope="col">Task</th>
                <th scope="col">Intention</th>
                <th scope="col">
                  <span className={styles.visuallyHidden}>Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {sessions.slice(0, shown).map((s) => {
                const running = s.status === 'running';
                const subjectId = subjectOf(s);
                const known = subjects.find((x) => x.id === subjectId);
                return [
                  <tr key={s.id}>
                    <td>{formatDayLabel(s.dayKey)}</td>
                    <td>
                      {formatClockTime(s.startedAt)}–{s.endedAt === null ? 'now' : formatClockTime(s.endedAt)}
                    </td>
                    <td className={styles.numeric}>{formatHm(s.focusMs)}</td>
                    <td>
                      <select
                        className={styles.select}
                        aria-label="Subject"
                        value={subjectId ?? ''}
                        disabled={running}
                        onChange={(e) =>
                          void changeSubject(s, e.target.value === '' ? null : Number(e.target.value))
                        }
                      >
                        <option value="">{NO_SUBJECT_NAME}</option>
                        {live.map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.name}
                          </option>
                        ))}
                        {subjectId !== null && known?.archived && (
                          <option value={known.id}>{known.name}</option>
                        )}
                        {subjectId !== null && !known && (
                          <option value={subjectId}>{UNKNOWN_SUBJECT_NAME}</option>
                        )}
                      </select>
                    </td>
                    <td className={styles.taskCell} title={s.taskText ?? undefined}>
                      {s.taskText}
                    </td>
                    <td className={styles.taskCell} title={s.intention ?? undefined}>
                      {s.outcome && (
                        <span
                          role="img"
                          aria-label={OUTCOME_MARKS[s.outcome].label}
                          title={OUTCOME_MARKS[s.outcome].label}
                        >
                          {OUTCOME_MARKS[s.outcome].mark}
                        </span>
                      )}
                      {s.outcome && s.intention && ' '}
                      {s.intention}
                    </td>
                    <td className={styles.numeric}>
                      {running ? (
                        <span className={styles.running}>In progress</span>
                      ) : (
                        <button
                          type="button"
                          className={styles.iconButton}
                          aria-label="Delete session"
                          title="Delete session"
                          data-delete={s.id}
                          aria-expanded={confirming === s.id}
                          onClick={() => setConfirming(confirming === s.id ? null : s.id)}
                        >
                          <TrashIcon />
                        </button>
                      )}
                    </td>
                  </tr>,
                  confirming === s.id && (
                    <tr key={`${s.id}-confirm`}>
                      <td colSpan={7}>
                        <div
                          className={styles.confirm}
                          role="group"
                          aria-label="Confirm delete"
                          onKeyDown={(e) => onConfirmKey(e, s.id)}
                        >
                          <p>{`Delete this session? This removes ${formatHm(s.focusMs)} from your stats.`}</p>
                          <button type="button" className={styles.danger} onClick={() => void remove(s)}>
                            Delete
                          </button>
                          <button
                            type="button"
                            className={styles.secondary}
                            onClick={() => cancel(s.id)}
                            data-cancel
                          >
                            Cancel
                          </button>
                        </div>
                      </td>
                    </tr>
                  ),
                ];
              })}
            </tbody>
          </table>
        </div>
      )}
      {sessions && sessions.length > shown && (
        <button
          type="button"
          className={`${styles.secondary} ${styles.more}`}
          onClick={() => setShown((n) => n + PAGE)}
        >
          Show more
        </button>
      )}
    </section>
  );
}
