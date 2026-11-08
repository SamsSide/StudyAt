// The Stats overlay's content (spec §3.5, §4): tiles, the study calendar, "This week", "Last 12
// weeks", "By subject", "Sessions" and "Weekly recaps", in that order. The shell's Overlay gives
// it the "Stats" title and close button. Every number is main's; when a session's subject is
// changed or a session deleted, the revision bumps and every section (and the top bar) reloads.
import { useId, useState } from 'react';
import type { HeatmapCell, StatsOverview } from '../../shared/types';
import { useStudyStore } from '../shell/store';
import { Heatmap } from './Heatmap';
import { RecapList } from './RecapList';
import { SessionsTable } from './SessionsTable';
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
      <section className={styles.full} aria-label="Totals">
        {overview.status === 'ready' && <Tiles overview={overview.data} />}
        {overview.status === 'error' && <p className={styles.empty}>Couldn’t load your totals.</p>}
      </section>

      <section className={`${styles.section} ${styles.full}`} aria-labelledby={calendarId}>
        <div className={styles.sectionHeader}>
          <h3 id={calendarId} className={styles.sectionTitle}>
            Study calendar
          </h3>
        </div>
        {heatmap.status === 'ready' && <Heatmap cells={heatmap.data} />}
        {heatmap.status === 'error' && <p className={styles.empty}>Couldn’t load the calendar.</p>}
      </section>

      <section className={`${styles.section} ${styles.half}`}>
        <WeekChart revision={revision} />
      </section>
      <section className={`${styles.section} ${styles.half}`}>
        <TrendChart revision={revision} />
      </section>

      <section className={`${styles.section} ${styles.third}`}>
        <SubjectBreakdown revision={revision} />
      </section>
      <section className={`${styles.section} ${styles.twoThirds}`}>
        <SessionsTable revision={revision} onChanged={onChanged} />
      </section>

      <section className={`${styles.section} ${styles.full}`}>
        <RecapList revision={revision} />
      </section>
    </div>
  );
}
