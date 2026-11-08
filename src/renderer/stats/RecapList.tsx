// "Weekly recaps" (spec §4): every stored recap, newest week first.
import type { WeeklyRecap } from '../../shared/types';
import { RecapCard } from './RecapCard';
import styles from './stats.module.css';
import { useStatsQuery } from './useStatsQuery';

const loadRecaps = (): Promise<WeeklyRecap[]> => window.studyat.recaps.list();

export function RecapList({ revision }: { revision: number }) {
  const query = useStatsQuery(loadRecaps, undefined, revision);
  const recaps = query.status === 'ready' ? [...query.data].sort((a, b) => b.weekStart.localeCompare(a.weekStart)) : null;

  return (
    <>
      <div className={styles.sectionHeader}>
        <h3 className={styles.sectionTitle}>Weekly recaps</h3>
      </div>
      {query.status === 'error' && <p className={styles.empty}>Couldn’t load your recaps.</p>}
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
    </>
  );
}
