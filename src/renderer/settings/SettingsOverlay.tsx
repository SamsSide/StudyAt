// The settings overlay body (spec §3.11): a section list and one section at a time. The shell's
// Overlay supplies the title, close button and focus trap. Every change saves at once through the
// store; main sanitises and returns the merged settings.
import { type KeyboardEvent, type ReactNode, useState } from 'react';
import type { SettingsPatch } from '../../shared/types';
import { useStudyStore } from '../shell/store';
import { ChimesSection } from './sections/ChimesSection';
import { DataSection } from './sections/DataSection';
import { GeneralSection } from './sections/GeneralSection';
import { GoalsSection } from './sections/GoalsSection';
import { ShortcutsSection } from './sections/ShortcutsSection';
import { SpotifySection } from './sections/SpotifySection';
import { SubjectsSection } from './sections/SubjectsSection';
import { TimerSection } from './sections/TimerSection';
import type { SectionProps } from './sections/types';
import styles from './settings.module.css';

const SECTIONS = [
  'Timer',
  'Chimes',
  'Goals & streak',
  'Subjects',
  'Spotify',
  'Shortcuts',
  'Data',
  'General',
] as const;
type SectionName = (typeof SECTIONS)[number];

const render = (name: SectionName, props: SectionProps): ReactNode => {
  switch (name) {
    case 'Timer':
      return <TimerSection {...props} />;
    case 'Chimes':
      return <ChimesSection {...props} />;
    case 'Goals & streak':
      return <GoalsSection {...props} />;
    case 'Subjects':
      return <SubjectsSection />;
    case 'Spotify':
      return <SpotifySection {...props} />;
    case 'Shortcuts':
      return <ShortcutsSection {...props} />;
    case 'Data':
      return <DataSection />;
    case 'General':
      return <GeneralSection {...props} />;
  }
};

const tabId = (name: SectionName): string => `settings-tab-${name.replace(/\W+/g, '-').toLowerCase()}`;

export function SettingsOverlay() {
  const settings = useStudyStore((s) => s.settings);
  const updateSettings = useStudyStore((s) => s.updateSettings);
  const [active, setActive] = useState<SectionName>('Timer');

  if (!settings) return null;

  const updateOrThrow = (patch: SettingsPatch): Promise<void> => updateSettings(patch);
  const update = async (patch: SettingsPatch): Promise<void> => {
    try {
      await updateSettings(patch);
    } catch (err) {
      console.error('Saving settings failed', err);
    }
  };

  // Arrow keys move between sections, as a vertical tab list.
  const onNavKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const step = e.key === 'ArrowDown' ? 1 : -1;
    const next = SECTIONS[(SECTIONS.indexOf(active) + step + SECTIONS.length) % SECTIONS.length] ?? active;
    setActive(next);
    document.getElementById(tabId(next))?.focus();
  };

  return (
    <div className={styles.layout}>
      <div
        className={styles.nav}
        role="tablist"
        aria-label="Settings sections"
        aria-orientation="vertical"
        onKeyDown={onNavKey}
      >
        {SECTIONS.map((name) => (
          <button
            key={name}
            id={tabId(name)}
            type="button"
            role="tab"
            aria-selected={name === active}
            aria-controls="settings-panel"
            tabIndex={name === active ? 0 : -1}
            className={styles.navItem}
            onClick={() => setActive(name)}
          >
            {name}
          </button>
        ))}
      </div>
      <div id="settings-panel" role="tabpanel" aria-labelledby={tabId(active)} className={styles.content}>
        {render(active, { settings, update, updateOrThrow })}
      </div>
    </div>
  );
}
