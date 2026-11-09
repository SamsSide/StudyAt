// The weekly recap (spec §3.5, §3.14): a finished Monday-to-Sunday week's total, the week before,
// days studied, best day, top subjects, longest session, streak at the week's end and goal days.
// Every figure is main's stored recap. A week with no study gets the kind empty-week line instead.
// `RecapPopup` is the once-only pop-up useRecapPopup shows on launch.
import { useEffect, useId, useLayoutEffect, useRef } from 'react';
import type { WeeklyRecap } from '../../shared/types';
import { formatHm } from '../shell/format';
import { useStudyStore } from '../shell/store';
import { subjectColour } from './chartTheme';
import { formatDayLabel, formatDays, recapTitle } from './format';
import styles from './stats.module.css';

/** Spec §3.14 verbatim, byte for byte (its straight apostrophe included). */
export const EMPTY_WEEK_COPY = "No focus time last week — that's okay. A fresh week starts now.";

function Fact({ term, children }: { term: string; children: string }) {
  return (
    <div>
      <dt>{term}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function RecapCard({
  recap,
  onClose,
  titleId,
}: {
  recap: WeeklyRecap;
  onClose?: () => void;
  titleId?: string;
}) {
  const subjects = useStudyStore((s) => s.subjects);
  const topId = useId();
  const empty = recap.totalMs === 0;

  return (
    <article className={styles.recap}>
      <h3 id={titleId} className={styles.recapTitle}>
        {recapTitle(recap.weekStart)}
      </h3>
      {empty ? (
        <p className={styles.recapEmpty}>{EMPTY_WEEK_COPY}</p>
      ) : (
        <>
          <p className={styles.recapTotal}>{formatHm(recap.totalMs)}</p>
          <dl className={styles.facts}>
            <Fact term="Week before">{formatHm(recap.prevTotalMs)}</Fact>
            <Fact term="Days studied">{`${recap.daysStudied} of 7`}</Fact>
            <Fact term="Best day">
              {recap.bestDay
                ? `${formatDayLabel(recap.bestDay.dayKey)} · ${formatHm(recap.bestDay.ms)}`
                : '—'}
            </Fact>
            <Fact term="Longest session">{formatHm(recap.longestSessionMs)}</Fact>
            <Fact term="Streak">{formatDays(recap.streakAtEnd)}</Fact>
            <Fact term="Goal hit">{formatDays(recap.goalDaysHit)}</Fact>
          </dl>
          {recap.topSubjects.length > 0 && (
            <>
              <p id={topId} className={styles.muted}>
                Top subjects
              </p>
              <ul className={styles.topSubjects} aria-labelledby={topId}>
                {recap.topSubjects.map((t) => (
                  <li key={t.subjectId ?? 'none'}>
                    <span
                      className={styles.dot}
                      style={{ background: subjectColour(t.subjectId, subjects) }}
                      aria-hidden="true"
                    />
                    <span>{t.name}</span>
                    <span>{formatHm(t.ms)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
      {onClose && (
        <div className={styles.recapActions}>
          <button type="button" className={styles.primary} onClick={onClose} data-recap-close>
            Got it
          </button>
        </div>
      )}
    </article>
  );
}

/**
 * The recap as a modal pop-up: focus starts on "Got it" and returns where it was; Esc or a click
 * on the backdrop closes it. While open it owns the keyboard, as the away prompt does: a
 * capture-phase listener on window runs first and stops every key, so no app shortcut (S, R,
 * Space and the rest) acts behind it. Enter and Space keep their default and press "Got it".
 */
export function RecapPopup({ recap, onClose }: { recap: WeeklyRecap; onClose: () => void }) {
  const titleId = useId();
  const dialog = useRef<HTMLDivElement>(null);
  // The key listener is added once; it reads the latest onClose through this ref.
  const close = useRef(onClose);
  useLayoutEffect(() => {
    close.current = onClose;
  });

  useEffect(() => {
    const previous = document.activeElement;
    const gotIt = (): HTMLButtonElement | null =>
      dialog.current?.querySelector<HTMLButtonElement>('[data-recap-close]') ?? null;
    gotIt()?.focus();

    const onKey = (e: KeyboardEvent): void => {
      e.stopPropagation();
      const inside = e.target instanceof Node && dialog.current?.contains(e.target);
      if (e.key === 'Escape') {
        e.preventDefault();
        close.current();
      } else if (e.key === 'Tab' || !inside) {
        // "Got it" is the only control: keep focus on it.
        e.preventDefault();
        gotIt()?.focus();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);

  return (
    <div
      className={styles.scrim}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div ref={dialog} className={styles.popup} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <RecapCard recap={recap} onClose={onClose} titleId={titleId} />
      </div>
    </div>
  );
}
