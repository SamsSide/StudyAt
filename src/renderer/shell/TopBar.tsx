// The top bar (spec §4): left, the streak (opens Stats), today's focus time and the goal ring;
// right, hide the interface (focus view, v1.1 spec §3.4), the mini-timer toggle, full screen and
// settings. Every number comes from main.
import { formatHm, goalTooltip } from './format';
import { GoalRing } from './GoalRing';
import { Icon } from './icons';
import styles from './shell.module.css';
import { useStudyStore } from './store';

export function TopBar() {
  const todayMs = useStudyStore((s) => s.timer.todayFocusMs);
  const overview = useStudyStore((s) => s.overview);
  const fullscreen = useStudyStore((s) => s.fullscreen);
  const miniShown = useStudyStore((s) => s.miniShown);
  const setOverlay = useStudyStore((s) => s.setOverlay);
  const toggleMini = useStudyStore((s) => s.toggleMini);
  const setFocusView = useStudyStore((s) => s.setFocusView);

  const streak = overview?.currentStreak ?? 0;

  return (
    <header className={`${styles.topBar} ${styles.fades}`}>
      <div className={`${styles.topGroup} ${styles.frosted}`}>
        <button
          type="button"
          className={`${styles.iconButton} ${styles.streak}`}
          onClick={() => setOverlay('stats')}
          aria-label={`Day streak: ${streak}`}
          title="Day streak"
        >
          <span aria-hidden="true">🔥</span>
          {streak}
        </button>
        <span className={styles.topDivider} aria-hidden="true" />
        <span className={styles.today}>
          <span className={styles.todayLabel}>Today</span>
          {formatHm(todayMs)}
        </span>
        {overview && (
          <GoalRing progress={overview.goalProgress} title={goalTooltip(todayMs, overview.goalMs)} />
        )}
      </div>
      <div className={`${styles.topGroup} ${styles.frosted}`}>
        <button
          type="button"
          className={styles.iconButton}
          onClick={() => setFocusView(true)}
          aria-label="Hide interface"
          title="Hide interface (H)"
        >
          <Icon name="eyeOff" />
        </button>
        <button
          type="button"
          className={styles.iconButton}
          onClick={() => void toggleMini()}
          aria-label={miniShown ? 'Hide mini timer' : 'Show mini timer'}
          aria-pressed={miniShown}
          title="Mini timer (M)"
        >
          <Icon name="mini" />
        </button>
        <button
          type="button"
          className={styles.iconButton}
          onClick={() => void window.studyat.app.toggleFullscreen()}
          aria-label={fullscreen ? 'Exit full screen' : 'Enter full screen'}
          title="Full screen (F)"
        >
          <Icon name={fullscreen ? 'exitFullscreen' : 'fullscreen'} />
        </button>
        <button
          type="button"
          className={styles.iconButton}
          onClick={() => setOverlay('settings')}
          aria-label="Settings"
          title="Settings"
        >
          <Icon name="settings" />
        </button>
      </div>
    </header>
  );
}
