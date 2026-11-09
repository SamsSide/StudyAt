// Settings → Timer (spec §3.11): segment lengths, long-break cadence, auto-start, idle threshold.
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
      <NumberField
        label="Away check after"
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
