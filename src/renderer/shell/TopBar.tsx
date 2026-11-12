// The top bar (spec §4): left, the streak (opens Stats), today's focus time and the goal ring;
// right, pause or play the background (v1.2 spec §3.4), hide the interface (focus view, v1.1 spec §3.4), the mini-timer toggle, full screen and
// settings. Every number comes from main.
import { backgroundPlayable, useOnline, useReducedMotion } from '../spaces/SpaceBackground';
import { useSpacesStore } from '../spaces/spacesStore';
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

  const space = useSpacesStore((s) => s.spaces.find((x) => x.id === s.activeId) ?? null);
  const embedError = useSpacesStore((s) => (s.activeId === null ? undefined : s.embedErrors[s.activeId]));
  const backgroundPaused = useSpacesStore((s) => s.backgroundPaused);
  const toggleBackground = useSpacesStore((s) => s.toggleBackground);
  const online = useOnline();
  // Under reduced motion the footer's play button is the one control: it starts the still, and this
  // one would contradict it until then.
  const reduced = useReducedMotion();
  const showBackground = space !== null && !reduced && backgroundPlayable(space, embedError, online);

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
        {showBackground && (
          <button
            type="button"
            className={styles.iconButton}
            onClick={toggleBackground}
            aria-label={backgroundPaused ? 'Play background' : 'Pause background'}
            title="Pause or play the background (V)"
          >
            <Icon name={backgroundPaused ? 'play' : 'pause'} />
          </button>
        )}
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
