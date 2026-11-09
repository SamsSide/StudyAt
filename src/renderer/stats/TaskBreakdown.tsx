// "By task" (v1.1 spec §3.3): focus time per task for this week, this month or all time. Totals,
// their order (largest first) and the top-10 cut are main's `stats.byTask(range)`; sessions with
// no task are not listed. Reuses the By subject card's styles.
import { useId, useState } from 'react';
import type { SubjectRange, TaskTotal } from '../../shared/types';
import { formatHm } from '../shell/format';
import { LoadError } from './LoadError';
import { Skeleton } from './Skeleton';
import styles from './stats.module.css';
import { useStatsQuery } from './useStatsQuery';

const RANGES: { value: SubjectRange; label: string }[] = [
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'all', label: 'All time' },
];

const loadByTask = (range: SubjectRange): Promise<TaskTotal[]> => window.studyat.stats.byTask(range);

export function TaskBreakdown({ revision, className }: { revision: number; className?: string }) {
  const titleId = useId();
  const [range, setRange] = useState<SubjectRange>('week');
  const query = useStatsQuery(loadByTask, range, revision);
  const name = useId();
  const totals = query.status === 'ready' ? query.data : null;
  const largest = Math.max(1, ...(totals ?? []).map((t) => t.ms));

  return (
    <section className={className} aria-labelledby={titleId} aria-busy={query.status === 'loading'}>
      <div className={styles.sectionHeader}>
        <h3 id={titleId} className={styles.sectionTitle}>
          By task
        </h3>
        <div className={styles.segmented} role="radiogroup" aria-label="Range">
          {RANGES.map((r) => (
            <label key={r.value} className={styles.segment}>
              <input
                type="radio"
                name={name}
                value={r.value}
                checked={range === r.value}
                onChange={() => setRange(r.value)}
              />
              <span>{r.label}</span>
            </label>
          ))}
        </div>
      </div>
      {query.status === 'loading' && <Skeleton kind="list" />}
      {query.status === 'error' && <LoadError message="Couldn’t load your tasks." onRetry={query.reload} />}
      {totals && totals.length === 0 && <p className={styles.empty}>No tasks linked yet</p>}
      {totals && totals.length > 0 && (
        <ul className={styles.subjects}>
          {totals.map((t) => (
            <li key={t.taskId} className={styles.subjectRow}>
              <span className={styles.subjectName} title={t.text}>
                {t.text}
              </span>
              <span className={styles.subjectMs}>{formatHm(t.ms)}</span>
              <span className={styles.bar} aria-hidden="true">
                <span
                  className={styles.barFill}
                  style={{
                    display: 'block',
                    width: `${(t.ms / largest) * 100}%`,
                    background: 'var(--accent)',
                  }}
                />
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
