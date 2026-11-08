// The subject dropdown (spec §4): "No subject" plus the live subjects, with the chosen subject's
// colour as a dot beside it. A native select keeps keyboard and screen-reader behaviour for free;
// an archived subject stays listed only while it is the one selected.
import { useId } from 'react';
import { useStudyStore } from '../shell/store';
import styles from './timer.module.css';

export function SubjectSelect() {
  const subjects = useStudyStore((s) => s.subjects);
  const subjectId = useStudyStore((s) => s.timer.subjectId);
  const id = useId();
  const options = subjects.filter((s) => !s.archived || s.id === subjectId);
  const current = subjects.find((s) => s.id === subjectId);

  return (
    <div className={styles.subject}>
      <span className={styles.dot} style={current ? { background: current.colour } : undefined} aria-hidden="true" />
      <label htmlFor={id} className={styles.visuallyHidden}>
        Subject
      </label>
      <select
        id={id}
        className={styles.select}
        value={subjectId ?? ''}
        onChange={(e) => void window.studyat.timer.setSubject(e.target.value === '' ? null : Number(e.target.value))}
      >
        <option value="">No subject</option>
        {options.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    </div>
  );
}
