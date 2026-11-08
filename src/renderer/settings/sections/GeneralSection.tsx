// Settings → General (spec §3.11): launch at start-up, the chrome auto-hide delay, mini timer.
import { NumberField, Toggle } from '../controls';
import styles from '../settings.module.css';
import type { SectionProps } from './types';

export function GeneralSection({ settings, update }: SectionProps) {
  return (
    <section aria-labelledby="settings-general">
      <h3 id="settings-general" className={styles.heading}>
        General
      </h3>
      <Toggle
        label="Launch at start-up"
        checked={settings.launchAtStartup}
        onChange={(v) => void update({ launchAtStartup: v })}
      />
      <NumberField
        label="Hide the controls after"
        hint="0 keeps them showing"
        value={settings.autoHideSeconds}
        min={0}
        max={60}
        unit="seconds"
        onCommit={(n) => update({ autoHideSeconds: n })}
      />
      <Toggle
        label="Show the mini timer when the window is hidden"
        checked={settings.miniWhenHidden}
        onChange={(v) => void update({ miniWhenHidden: v })}
      />
      <p className={styles.note}>StudyAt keeps running in the tray when you close the window.</p>
    </section>
  );
}
