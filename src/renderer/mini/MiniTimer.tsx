// The mini timer's contents (spec §3.7): countdown, mode, subject colour dot, one start/pause
// button and an "open StudyAt" link, in the 240x96 always-on-top window. The mini window has its
// own renderer, so mini.tsx calls initStudyStore() to get the same pushes as the main window.
import { useEffect } from 'react';
import { useStudyStore } from '../shell/store';
import { formatClock, MODE_LABEL, startLabel, toggleTimer } from '../timer/format';
import styles from './mini.module.css';

export function MiniTimer() {
  const timer = useStudyStore((s) => s.timer);
  const subject = useStudyStore((s) => s.subjects.find((x) => x.id === s.timer.subjectId));
  const refreshSubjects = useStudyStore((s) => s.refreshSubjects);

  // The subject list is loaded once at start-up; a subject made in the main window since then
  // is fetched when the timer first names it.
  const unknown = timer.subjectId !== null && subject === undefined;
  useEffect(() => {
    if (unknown) void refreshSubjects();
  }, [unknown, timer.subjectId, refreshSubjects]);

  return (
    <div className={styles.mini}>
      <p className={styles.clock} role="timer" aria-label="Time remaining">
        {formatClock(timer.remainingMs)}
      </p>
      <button type="button" className={styles.primary} onClick={() => toggleTimer(timer.status)}>
        {startLabel(timer.status)}
      </button>
      <div className={styles.meta}>
        <span
          className={styles.dot}
          style={subject ? { background: subject.colour } : undefined}
          title={subject?.name ?? 'No subject'}
          aria-hidden="true"
        />
        <span>{MODE_LABEL[timer.mode]}</span>
        <span className={styles.visuallyHidden}>{`Subject: ${subject?.name ?? 'none'}`}</span>
      </div>
      <button type="button" className={styles.link} onClick={() => void window.studyat.app.showMini(false)}>
        Open StudyAt
      </button>
    </div>
  );
}
