// A quiet placeholder that holds a Stats section's place while main answers, so the overlay
// doesn't jump as sections arrive (spec §4). One fixed-height panel per kind, sized to what it
// stands in for, with a soft shimmer that stops under prefers-reduced-motion. Screen readers hear
// the section's aria-busy instead, so the panel itself is hidden from them.
import styles from './stats.module.css';

export type SkeletonKind = 'tiles' | 'calendar' | 'chart' | 'list' | 'table';

const KIND_CLASS: Record<SkeletonKind, string | undefined> = {
  tiles: styles.skeletonTiles,
  calendar: styles.skeletonCalendar,
  chart: styles.skeletonChart,
  list: styles.skeletonList,
  table: styles.skeletonTable,
};

export function Skeleton({ kind }: { kind: SkeletonKind }) {
  return (
    <div className={`${styles.skeleton} ${KIND_CLASS[kind] ?? ''}`} data-skeleton={kind} aria-hidden="true" />
  );
}
