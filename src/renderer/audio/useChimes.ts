// Plays chimes from main's timer events (spec §3.9). Mount once, in App. Chimes are triggered by the
// events rather than by timers in the renderer, so they still play while the window is hidden.
import { useEffect } from 'react';
import { isFocusMode } from '../../shared/modes';
import type { ChimeId, PublicSettings, SegmentEnd, TimerState } from '../../shared/types';
import { audioEngine, CHIME_REPEAT_GAP } from './engine';

/** The media-protocol URL of a custom chime (`file:<soundId>`), or undefined for a built-in. */
export const chimeUrl = (id: ChimeId): string | undefined =>
  id.startsWith('file:') ? `studyat-media://chime/${id.slice('file:'.length)}` : undefined;

const LAST_MINUTE_MS = 60_000;
const PIP_SECONDS = 3;
const PREVIEW_GAP_MS = 1000;

/** Settings → Chimes preview (spec §3.5): pip, pip, pip, then the focus-end chime, 1 s apart. Returns a cancel. */
export function playCountdownPreview(s: PublicSettings): () => void {
  const timers: ReturnType<typeof setTimeout>[] = [];
  for (let i = 0; i < PIP_SECONDS; i++) {
    timers.push(setTimeout(() => audioEngine.pip(s.chimeVolume), i * PREVIEW_GAP_MS));
  }
  timers.push(
    setTimeout(() => {
      void audioEngine
        .playChime(s.chimeFocusEnd, {
          volume: s.chimeVolume,
          repeat: 1,
          customUrl: chimeUrl(s.chimeFocusEnd),
        })
        .catch(() => undefined);
    }, PIP_SECONDS * PREVIEW_GAP_MS),
  );
  return () => timers.forEach(clearTimeout);
}

export function useChimes(): void {
  useEffect(() => {
    const api = window.studyat;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    let disposed = false;
    let settings: PublicSettings | null = null;
    let prev: TimerState | null = null;
    let lastTickSecond = -1;

    const refresh = async (): Promise<PublicSettings | null> => {
      try {
        const s = await api.settings.get();
        if (!disposed) settings = s;
      } catch {
        /* keep the last settings */
      }
      return settings;
    };

    /** `repeat` plays, 1.2 s apart; each is its own playChime call. */
    const playRepeated = (id: ChimeId, s: PublicSettings): void => {
      const repeat = Math.min(3, Math.max(1, Math.round(s.chimeRepeat)));
      const once = (): void => {
        void audioEngine
          .playChime(id, {
            volume: s.chimeVolume,
            repeat: 1,
            customUrl: chimeUrl(id),
          })
          .catch(() => undefined);
      };
      once();
      for (let i = 1; i < repeat; i++) {
        const t = setTimeout(
          () => {
            timers.delete(t);
            once();
          },
          i * CHIME_REPEAT_GAP * 1000,
        );
        timers.add(t);
      }
    };

    const onSegmentEnd = (e: SegmentEnd): void => {
      void refresh().then((s) => {
        if (disposed || !s) return;
        playRepeated(isFocusMode(e.mode) ? s.chimeFocusEnd : s.chimeBreakEnd, s);
      });
    };

    const onState = (s: TimerState): void => {
      const before = prev;
      prev = s;
      const running = s.status === 'running';

      // Countdown pip (spec §3.5): a running segment of the same mode crossing 3, 2, 1 in consecutive
      // displayed seconds. A jump, a pause, Reset or Skip never satisfies "exactly one second more".
      const second = Math.ceil(s.remainingMs / 1000);
      const pipsOn = settings?.countdownPips === true;
      const crossed =
        running &&
        before !== null &&
        before.status === 'running' &&
        before.mode === s.mode &&
        second >= 1 &&
        second <= PIP_SECONDS &&
        Math.ceil(before.remainingMs / 1000) === second + 1;
      if (pipsOn && crossed && settings) audioEngine.pip(settings.chimeVolume);

      // Soft tick, once per remaining second, in the final minute of a focus segment (Pomodoro or
      // Countdown). With pips on, the last three seconds belong to the pips: never both.
      if (running && isFocusMode(s.mode) && s.remainingMs > 0 && s.remainingMs <= LAST_MINUTE_MS) {
        if (second !== lastTickSecond) {
          lastTickSecond = second;
          if (settings?.tickLastMinute && !(pipsOn && second <= PIP_SECONDS))
            audioEngine.tick(settings.chimeVolume);
        }
      } else {
        lastTickSecond = -1;
      }

      // Start chime: a focus segment moving from idle (or from another mode) to running; resuming from
      // a pause is not a start.
      const started =
        before !== null &&
        running &&
        isFocusMode(s.mode) &&
        (before.status === 'idle' || before.mode !== s.mode);
      if (started) {
        void refresh().then((fresh) => {
          if (disposed || !fresh?.chimeOnStart) return;
          void audioEngine
            .playChime('woodblock', { volume: fresh.chimeVolume, repeat: 1 })
            .catch(() => undefined);
        });
      } else if (before === null || before.status !== s.status || before.mode !== s.mode) {
        void refresh();
      }
    };

    void refresh();
    const offEnd = api.timer.onSegmentEnd(onSegmentEnd);
    const offState = api.timer.onState(onState);
    return () => {
      disposed = true;
      offEnd();
      offState();
      for (const t of timers) clearTimeout(t);
      timers.clear();
    };
  }, []);
}
