// A deadline as a small chip (v1.2 spec §3.7): "Exam" or "CW" (coursework) and its title.
import type { Deadline } from '../../shared/types';
import { useStudyStore } from '../shell/store';
import styles from './planner.module.css';

export function DeadlineChip({ deadline }: { deadline: Deadline }) {
  const subject = useStudyStore((s) => s.subjects.find((x) => x.id === deadline.subjectId));
  const kind = deadline.kind === 'exam' ? 'Exam' : 'CW';
  return (
    <span
      className={styles.deadline}
      data-kind={deadline.kind}
      style={subject ? { borderColor: subject.colour } : undefined}
    >
      <b>{kind}</b> {deadline.title}
    </span>
  );
}
