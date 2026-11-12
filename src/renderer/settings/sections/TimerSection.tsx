// Settings → Timer (spec §3.11): segment lengths, long-break cadence, auto-start, Countdown length, away prompt and idle threshold.
import { NumberField, Toggle } from '../controls';
import styles from '../settings.module.css';
import type { SectionProps } from './types';

export function TimerSection({ settings, update }: SectionProps) {
  return (
    <section aria-labelledby="settings-timer">
      <h3 id="settings-timer" className={styles.heading}>
        Timer
      </h3>
      <NumberField
        label="Focus length"
        value={settings.focusMinutes}
        min={1}
        max={180}
        unit="min"
        onCommit={(n) => update({ focusMinutes: n })}
      />
      <NumberField
        label="Short break"
        value={settings.shortMinutes}
        min={1}
        max={180}
        unit="min"
        onCommit={(n) => update({ shortMinutes: n })}
      />
      <NumberField
        label="Long break"
        value={settings.longMinutes}
        min={1}
        max={180}
        unit="min"
        onCommit={(n) => update({ longMinutes: n })}
      />
      <NumberField
        label="Long break every"
        hint="Focus sessions before a long break"
        value={settings.longEvery}
        min={1}
        max={12}
        onCommit={(n) => update({ longEvery: n })}
      />
      <NumberField
        label="Countdown length"
        hint="One focus block, set on the timer's Countdown tab"
        value={settings.countdownMinutes}
        min={1}
        max={240}
        unit="min"
        onCommit={(n) => update({ countdownMinutes: n })}
      />
      <Toggle
        label="Start breaks automatically"
        checked={settings.autoStartBreaks}
        onChange={(v) => update({ autoStartBreaks: v })}
      />
      <Toggle
        label="Start focus automatically"
        checked={settings.autoStartFocus}
        onChange={(v) => update({ autoStartFocus: v })}
      />
      <Toggle
        label="Ask what I'll do each focus"
        hint="A line under the task picker, and a quick question when the focus ends"
        checked={settings.sessionIntention}
        onChange={(v) => update({ sessionIntention: v })}
      />
      <Toggle
        label="Ask if I've been away"
        hint="Off: time while you're away from the keyboard still counts. Locking or sleeping the PC still pauses the timer."
        checked={settings.awayPrompt}
        onChange={(v) => update({ awayPrompt: v })}
      />
      <NumberField
        label="Away check after"
        disabled={!settings.awayPrompt}
        hint="While the timer runs, ask whether to keep time after this much inactivity"
        value={settings.idleMinutes}
        min={2}
        max={60}
        unit="min"
        onCommit={(n) => update({ idleMinutes: n })}
      />
    </section>
  );
}
