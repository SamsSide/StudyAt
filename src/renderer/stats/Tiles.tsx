// The Stats header tiles (spec §3.5): today, this week with its change on last week ("—" when
// last week was 0), the current and longest streak, and all-time time. Every number comes from
// main's overview; nothing is summed here.
import type { ReactNode } from 'react';
import type { StatsOverview } from '../../shared/types';
import { formatHm } from '../shell/format';
import { formatDelta } from './format';
import styles from './stats.module.css';

function Tile({ label, value, note }: { label: string; value: string; note?: ReactNode }) {
  return (
    <div className={styles.tile} data-tile>
      <dt>{label}</dt>
      <dd>
        <span className={styles.tileValue}>{value}</span>
        {note}
      </dd>
    </div>
  );
}

export function Tiles({ overview }: { overview: StatsOverview }) {
  const pct = overview.weekDeltaPct;
  const trendClass = pct === null || pct === 0 ? '' : pct > 0 ? styles.up : styles.down;

  return (
    <dl className={styles.tiles}>
      <Tile label="Today" value={formatHm(overview.todayMs)} />
      <Tile
        label="This week"
        value={formatHm(overview.weekMs)}
        note={
          <span className={styles.tileNote}>
            <span className={trendClass}>{formatDelta(pct)}</span> vs last week
          </span>
        }
      />
      <Tile
        label="Day streak"
        value={String(overview.currentStreak)}
        note={
          <span className={styles.tileNote}>{overview.currentStreak === 1 ? 'day' : 'days'} in a row</span>
        }
      />
      <Tile
        label="Longest streak"
        value={String(overview.longestStreak)}
        note={<span className={styles.tileNote}>{overview.longestStreak === 1 ? 'day' : 'days'}</span>}
      />
      <Tile label="All time" value={formatHm(overview.allTimeMs)} />
    </dl>
  );
}
