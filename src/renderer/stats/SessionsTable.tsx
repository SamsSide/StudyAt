// "Sessions" (spec §4): every recorded focus row, newest first. A session's subject can be changed
// or the session deleted (after a confirm inside the overlay), and nothing else: there is no way
// to edit its time (spec §3.4 rule 10). A running session belongs to the timer and is left alone.
// After a change the overlay's revision bumps, so every number reloads from main.
import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { NO_SUBJECT_NAME } from '../../core/stats/totals';
import type { Session } from '../../shared/types';
import { formatHm } from '../shell/format';
import { useStudyStore } from '../shell/store';
import { formatClockTime, formatDayLabel } from './format';
import styles from './stats.module.css';
import { useStatsQuery } from './useStatsQuery';

const PAGE = 50;

const loadSessions = (): Promise<Session[]> => window.studyat.stats.sessions();

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
    </svg>
  );
}

export function SessionsTable({ revision, onChanged }: { revision: number; onChanged: () => void }) {
  const subjects = useStudyStore((s) => s.subjects);
  const query = useStatsQuery(loadSessions, undefined, revision);
  // Subject changes show at once, before main's answer reloads the table.
  const [edits, setEdits] = useState<ReadonlyMap<number, number | null>>(new Map());
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

  const sessions = query.status === 'ready' ? query.data.filter((s) => !gone.has(s.id)).sort((a, b) => b.startedAt - a.startedAt) : null;
  const live = subjects.filter((s) => !s.archived).sort((a, b) => a.sort - b.sort);

  const subjectOf = (s: Session): number | null => (edits.has(s.id) ? (edits.get(s.id) ?? null) : s.subjectId);

  const changeSubject = async (s: Session, subjectId: number | null): Promise<void> => {
    setEdits((m) => new Map(m).set(s.id, subjectId));
    setError(null);
    try {
      await window.studyat.stats.updateSession(s.id, { subjectId });
      onChanged();
    } catch {
      setEdits((m) => {
        const next = new Map(m);
        next.delete(s.id);
        return next;
      });
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
    } catch {
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
    <>
      <div className={styles.sectionHeader}>
        <h3 className={styles.sectionTitle}>Sessions</h3>
        {sessions && sessions.length > 0 && <p className={styles.muted}>Change a subject, or delete a session.</p>}
      </div>
      {query.status === 'error' && <p className={styles.empty}>Couldn’t load your sessions.</p>}
      {error && (
        <p className={styles.muted} role="alert">
          {error}
        </p>
      )}
      {sessions && sessions.length === 0 && <p className={styles.empty}>No sessions yet. Start a Pomodoro and they’ll appear here.</p>}
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
                <th scope="col">
                  <span className={styles.visuallyHidden}>Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {sessions.slice(0, shown).map((s) => {
                const running = s.status === 'running';
                const subjectId = subjectOf(s);
                const archived = subjects.find((x) => x.id === subjectId && x.archived);
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
                        onChange={(e) => void changeSubject(s, e.target.value === '' ? null : Number(e.target.value))}
                      >
                        <option value="">{NO_SUBJECT_NAME}</option>
                        {live.map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.name}
                          </option>
                        ))}
                        {archived && <option value={archived.id}>{archived.name}</option>}
                      </select>
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
                      <td colSpan={5}>
                        <div className={styles.confirm} role="group" aria-label="Confirm delete" onKeyDown={(e) => onConfirmKey(e, s.id)}>
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
        <button type="button" className={`${styles.secondary} ${styles.more}`} onClick={() => setShown((n) => n + PAGE)}>
          Show more
        </button>
      )}
    </>
  );
}
