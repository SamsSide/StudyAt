// "Weekly recaps" (spec §4): every stored recap, newest week first.
import { useId } from 'react';
import type { WeeklyRecap } from '../../shared/types';
import { RecapCard } from './RecapCard';
import { LoadError } from './LoadError';
import { Skeleton } from './Skeleton';
import styles from './stats.module.css';
import { useStatsQuery } from './useStatsQuery';

const loadRecaps = (): Promise<WeeklyRecap[]> => window.studyat.recaps.list();

export function RecapList({ revision, className }: { revision: number; className?: string }) {
  const titleId = useId();
  const query = useStatsQuery(loadRecaps, undefined, revision);
  const recaps = query.status === 'ready' ? [...query.data].sort((a, b) => b.weekStart.localeCompare(a.weekStart)) : null;

  return (
    <section className={className} aria-labelledby={titleId} aria-busy={query.status === 'loading'}>
      <div className={styles.sectionHeader}>
        <h3 id={titleId} className={styles.sectionTitle}>
          Weekly recaps
        </h3>
      </div>
      {query.status === 'loading' && <Skeleton kind="list" />}
      {query.status === 'error' && <LoadError message="Couldn’t load your recaps." onRetry={query.reload} />}
      {recaps && recaps.length === 0 && <p className={styles.empty}>Your first recap arrives after your first full week.</p>}
      {recaps && recaps.length > 0 && (
        <ul className={styles.recaps}>
          {recaps.map((r) => (
            <li key={r.weekStart}>
              <RecapCard recap={r} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
