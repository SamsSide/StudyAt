// "By subject" (spec §3.5, §4): focus time per subject for this week, this month or all time, in
// each subject's colour, untagged time grey. Totals and their order (largest first) are main's
// `stats.bySubject(range)`; the bars are only drawn relative to the largest.
import { useId, useState } from 'react';
import type { SubjectRange, SubjectTotal } from '../../shared/types';
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

const loadBySubject = (range: SubjectRange): Promise<SubjectTotal[]> => window.studyat.stats.bySubject(range);

export function SubjectBreakdown({ revision, className }: { revision: number; className?: string }) {
  const titleId = useId();
  const [range, setRange] = useState<SubjectRange>('week');
  const query = useStatsQuery(loadBySubject, range, revision);
  const name = useId();
  const totals = query.status === 'ready' ? query.data : null;
  const largest = Math.max(1, ...(totals ?? []).map((t) => t.ms));

  return (
    <section className={className} aria-labelledby={titleId} aria-busy={query.status === 'loading'}>
      <div className={styles.sectionHeader}>
        <h3 id={titleId} className={styles.sectionTitle}>
          By subject
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
      {query.status === 'error' && (
        <LoadError message="Couldn’t load your subjects." onRetry={query.reload} />
      )}
      {totals && totals.length === 0 && <p className={styles.empty}>No focus time in this range yet</p>}
      {totals && totals.length > 0 && (
        <ul className={styles.subjects}>
          {totals.map((t) => (
            <li key={t.subjectId ?? 'none'} className={styles.subjectRow}>
              <span className={styles.subjectName}>
                <span className={styles.dot} style={{ background: t.colour }} aria-hidden="true" />
                {t.name}
              </span>
              <span className={styles.subjectMs}>{formatHm(t.ms)}</span>
              <span className={styles.bar} aria-hidden="true">
                <span
                  className={styles.barFill}
                  style={{ display: 'block', width: `${(t.ms / largest) * 100}%`, background: t.colour }}
                />
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
