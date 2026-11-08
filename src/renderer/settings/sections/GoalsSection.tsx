// Settings → Goals & streak (spec §3.11): the daily goal, the minutes that keep a streak, and the
// hour a study day rolls over.
import { NumberField } from '../controls';
import styles from '../settings.module.css';
import type { SectionProps } from './types';

export function GoalsSection({ settings, update }: SectionProps) {
  return (
    <section aria-labelledby="settings-goals">
      <h3 id="settings-goals" className={styles.heading}>
        Goals &amp; streak
      </h3>
      <NumberField
        label="Daily goal"
        hint="The ring in the top bar fills towards this"
        value={settings.goalMinutes}
        min={1}
        max={1440}
        unit="min"
        onCommit={(n) => update({ goalMinutes: n })}
      />
      <NumberField
        label="Streak minimum"
        hint="A day counts towards your streak at this much focus time"
        value={settings.streakMinutes}
        min={1}
        max={1440}
        unit="min"
        onCommit={(n) => update({ streakMinutes: n })}
      />
      <NumberField
        label="Day starts at"
        hint="Study after midnight counts towards the day before, until this hour (0–23)"
        value={settings.rolloverHour}
        min={0}
        max={23}
        unit="o'clock"
        onCommit={(n) => update({ rolloverHour: n })}
      />
    </section>
  );
}
