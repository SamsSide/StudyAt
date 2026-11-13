// The main window (spec §4): the shell with every panel, widget and overlay plugged in, plus the
// parts that must work whatever is open — the away prompt (appplan §5), the chimes (§3.9), the
// weekly recap pop-up (§3.5) and the saved soundscape (§3.9 "levels restored on launch").
import { useEffect } from 'react';
import { audioEngine } from './audio/engine';
import { useChimes } from './audio/useChimes';
import { registry } from './registry';
import { Shell } from './shell/Shell';
import { restoreSoundscape } from './sounds/soundscape';
import { useAppBridge } from './appBridge';
import { useRecapPopup } from './stats/useRecapPopup';
import { AwayPrompt } from './timer/AwayPrompt';

export function App() {
  useChimes();
  useAppBridge();
  const recap = useRecapPopup();

  useEffect(() => {
    // Start the saved soundscape straight away; the AudioContext may start suspended
    // (autoplay policy) and resumes on the first click or key press.
    void restoreSoundscape().catch(() => undefined);
    const resume = (): void => {
      void audioEngine.resume();
    };
    window.addEventListener('pointerdown', resume, { once: true, capture: true });
    window.addEventListener('keydown', resume, { once: true, capture: true });
    return () => {
      window.removeEventListener('pointerdown', resume, true);
      window.removeEventListener('keydown', resume, true);
    };
  }, []);

  return (
    <>
      <Shell registry={registry} />
      <div data-testid="away-prompt-host">
        <AwayPrompt />
      </div>
      {recap}
    </>
  );
}
