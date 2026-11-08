// "Welcome back": asked when the PC was away past the grace period mid-focus (spec §3.4 rule 4,
// §3.14). Self-contained: it subscribes to main's prompt and closes when main sends null (the
// deadline passing counts as Discard in main). Discard is the focused default, so a stray Enter
// never counts away time as study. No Esc and no click-outside: the answer is deliberate.
import { useEffect, useRef, useState } from 'react';
import type { AwayPrompt as AwayPromptData } from '../../shared/types';
import styles from './timer.module.css';

const MINUTE = 60_000;

export function AwayPrompt() {
  const [prompt, setPrompt] = useState<AwayPromptData | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const discard = useRef<HTMLButtonElement>(null);
  const keep = useRef<HTMLButtonElement>(null);

  useEffect(() => window.studyat.timer.onAwayPrompt(setPrompt), []);

  const open = prompt !== null;
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement;
    discard.current?.focus();

    // While the question is open it owns the keyboard: no key reaches the in-app shortcuts (R, N, S
    // and the rest would act behind it). Caught on window in the capture phase, so it runs first
    // even when focus has slipped out of the dialog. Tab swaps between the two buttons; Enter and
    // Space keep their default, which presses the focused button.
    const onKey = (e: KeyboardEvent): void => {
      e.stopPropagation();
      const inside = e.target instanceof Node && dialog.current?.contains(e.target);
      if (e.key === 'Tab') {
        e.preventDefault();
        (inside && document.activeElement === keep.current ? discard : keep).current?.focus();
      } else if (!inside) {
        e.preventDefault();
        discard.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [open]);

  if (!prompt) return null;

  const minutes = Math.max(1, Math.round(prompt.awayMs / MINUTE));
  const answer = (a: 'keep' | 'discard'): void => {
    setPrompt(null);
    void window.studyat.timer.answerAway(a);
  };

  return (
    <div className={styles.scrim}>
      <div
        ref={dialog}
        className={styles.away}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="away-title"
        aria-describedby="away-body"
      >
        <h2 id="away-title" className={styles.awayTitle}>
          Welcome back
        </h2>
        <p id="away-body" className={styles.awayBody}>
          {`You were away for ${minutes} min. Keep that time as study?`}
        </p>
        <div className={styles.awayActions}>
          <button ref={keep} type="button" className={styles.secondary} onClick={() => answer('keep')}>
            Keep it
          </button>
          <button ref={discard} type="button" className={styles.primary} onClick={() => answer('discard')}>
            Discard
          </button>
        </div>
      </div>
    </div>
  );
}
