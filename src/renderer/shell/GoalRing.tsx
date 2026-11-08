// The daily-goal ring in the top bar (spec §4). `progress` is main's `goalProgress` (0..1, more
// is clamped); `title` is the spec §3.14 tooltip.
import styles from './shell.module.css';

const R = 11;
const CIRCUMFERENCE = 2 * Math.PI * R;

export function GoalRing({ progress, title }: { progress: number; title: string }) {
  const p = Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 0));
  return (
    <span className={styles.ring} role="img" aria-label={title} title={title} data-progress={p}>
      <svg viewBox="0 0 28 28" width="28" height="28" aria-hidden="true" focusable="false">
        <circle className={styles.ringTrack} cx="14" cy="14" r={R} fill="none" strokeWidth="3" />
        <circle
          className={styles.ringFill}
          cx="14"
          cy="14"
          r={R}
          fill="none"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - p)}
          transform="rotate(-90 14 14)"
        />
      </svg>
    </span>
  );
}
