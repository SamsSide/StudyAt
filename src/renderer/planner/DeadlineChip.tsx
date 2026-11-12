// A deadline as a small chip (v1.2 spec §3.7): "Exam" or "CW" (coursework) and its title. With
// `countdown` (the widget's Day view) it also says how long is left, "CW Problem sheet 6 · 42m":
// the spec §3.10 countdown without the seconds, so a chip needs only a half-minute tick.
import { useEffect, useState } from 'react';
import { formatCountdown } from '../../core/deadlines';
import { parseDue } from '../../core/wallclock';
import type { Deadline } from '../../shared/types';
import { useStudyStore } from '../shell/store';
import styles from './planner.module.css';

const TICK_MS = 30_000;

/** formatCountdown, compact: "42m 08s" reads "42m"; "31h 12m", "23d 4h" and "Due" stay. */
export const chipCountdown = (dueMs: number, now: number): string =>
  formatCountdown(dueMs, now).replace(/ \d{2}s$/, '');

function Countdown({ due }: { due: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(id);
  }, []);
  return <span className={styles.countdown}>{`· ${chipCountdown(parseDue(due), now)}`}</span>;
}

export function DeadlineChip({ deadline, countdown = false }: { deadline: Deadline; countdown?: boolean }) {
  const subject = useStudyStore((s) => s.subjects.find((x) => x.id === deadline.subjectId));
  const kind = deadline.kind === 'exam' ? 'Exam' : 'CW';
  return (
    <span
      className={styles.deadline}
      data-kind={deadline.kind}
      style={subject ? { borderColor: subject.colour } : undefined}
    >
      <b>{kind}</b> {deadline.title}
      {countdown && (
        <>
          {' '}
          <Countdown due={deadline.due} />
        </>
      )}
    </span>
  );
}
