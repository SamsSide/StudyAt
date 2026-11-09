// The Stats overlay's content (spec §3.5, §4): tiles, the study calendar, "This week", "Last 12
// weeks", "By subject", "Sessions" and "Weekly recaps", in that order. The shell's Overlay gives
// it the "Stats" title and close button. Every number is main's; when a session's subject is
// changed or a session deleted, the revision bumps and every section (and the top bar) reloads.
// Each section holds its place with a skeleton while it first loads, so the layout doesn't jump.
import { useId, useState } from 'react';
import type { HeatmapCell, StatsOverview } from '../../shared/types';
import { useStudyStore } from '../shell/store';
import { Heatmap } from './Heatmap';
import { LoadError } from './LoadError';
import { RecapList } from './RecapList';
import { SessionsTable } from './SessionsTable';
import { Skeleton } from './Skeleton';
import styles from './stats.module.css';
import { SubjectBreakdown } from './SubjectBreakdown';
import { Tiles } from './Tiles';
import { TrendChart } from './TrendChart';
import { useStatsQuery } from './useStatsQuery';
import { WeekChart } from './WeekChart';

const loadOverview = (): Promise<StatsOverview> => window.studyat.stats.overview();
const loadHeatmap = (): Promise<HeatmapCell[]> => window.studyat.stats.heatmap();

export function StatsOverlay() {
  const [revision, setRevision] = useState(0);
  const overview = useStatsQuery(loadOverview, undefined, revision);
  const heatmap = useStatsQuery(loadHeatmap, undefined, revision);
  const calendarId = useId();

  const onChanged = (): void => {
    setRevision((r) => r + 1);
    useStudyStore
      .getState()
      .refreshOverview()
      .catch(() => undefined);
  };

  return (
    <div className={styles.overlay}>
      <section className={styles.full} aria-label="Totals" aria-busy={overview.status === 'loading'}>
        {overview.status === 'loading' && <Skeleton kind="tiles" />}
        {overview.status === 'ready' && <Tiles overview={overview.data} />}
        {overview.status === 'error' && (
          <LoadError message="Couldn’t load your totals." onRetry={overview.reload} />
        )}
      </section>

      <section
        className={`${styles.section} ${styles.full}`}
        aria-labelledby={calendarId}
        aria-busy={heatmap.status === 'loading'}
      >
        <div className={styles.sectionHeader}>
          <h3 id={calendarId} className={styles.sectionTitle}>
            Study calendar
          </h3>
        </div>
        {heatmap.status === 'loading' && <Skeleton kind="calendar" />}
        {heatmap.status === 'ready' && <Heatmap cells={heatmap.data} />}
        {heatmap.status === 'error' && (
          <LoadError message="Couldn’t load the calendar." onRetry={heatmap.reload} />
        )}
      </section>

      <WeekChart revision={revision} className={`${styles.section} ${styles.half}`} />
      <TrendChart revision={revision} className={`${styles.section} ${styles.half}`} />

      <SubjectBreakdown revision={revision} className={`${styles.section} ${styles.third}`} />
      <SessionsTable
        revision={revision}
        onChanged={onChanged}
        className={`${styles.section} ${styles.twoThirds}`}
      />

      <RecapList revision={revision} className={`${styles.section} ${styles.full}`} />
    </div>
  );
}
