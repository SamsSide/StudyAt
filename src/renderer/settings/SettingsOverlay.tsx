// The settings overlay body (spec §3.11): a section list and one section at a time. The shell's
// Overlay supplies the title, close button and focus trap. Every change saves at once through the
// store; main sanitises and returns the merged settings.
import { type KeyboardEvent, type ReactNode, useEffect, useState } from 'react';
import type { SettingsPatch } from '../../shared/types';
import { logIpcError } from '../lib/ipcError';
import { useStudyStore } from '../shell/store';
import { CalendarSection } from './sections/CalendarSection';
import { ChimesSection } from './sections/ChimesSection';
import { DataSection } from './sections/DataSection';
import { GeneralSection } from './sections/GeneralSection';
import { GoalsSection } from './sections/GoalsSection';
import { ShortcutsSection } from './sections/ShortcutsSection';
import { SpotifySection } from './sections/SpotifySection';
import { SubjectsSection } from './sections/SubjectsSection';
import { TimerSection } from './sections/TimerSection';
import { WeatherSection } from './sections/WeatherSection';
import type { SectionProps } from './sections/types';
import styles from './settings.module.css';

const SECTIONS = [
  'Timer',
  'Chimes',
  'Goals & streak',
  'Subjects',
  'Spotify',
  'Calendar',
  'Weather',
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
    case 'Calendar':
      return <CalendarSection />;
    case 'Weather':
      return <WeatherSection {...props} />;
    case 'Shortcuts':
      return <ShortcutsSection {...props} />;
    case 'Data':
      return <DataSection />;
    case 'General':
      return <GeneralSection {...props} />;
  }
};

const asSection = (name: string | null): SectionName | null => SECTIONS.find((s) => s === name) ?? null;

const tabId = (name: SectionName): string => `settings-tab-${name.replace(/\W+/g, '-').toLowerCase()}`;

export function SettingsOverlay() {
  const settings = useStudyStore((s) => s.settings);
  const updateSettings = useStudyStore((s) => s.updateSettings);
  // A deep link ("Open settings" in a widget) names the section to start on; the overlay is
  // mounted fresh when it opens, so reading it once here is enough, and then it is spent.
  const [active, setActive] = useState<SectionName>(
    () => asSection(useStudyStore.getState().settingsSection) ?? 'Timer',
  );
  useEffect(() => {
    useStudyStore.setState({ settingsSection: null });
  }, []);

  if (!settings) return null;

  const updateOrThrow = (patch: SettingsPatch): Promise<void> => updateSettings(patch);
  const update = async (patch: SettingsPatch): Promise<boolean> => {
    try {
      await updateSettings(patch);
      return true;
    } catch (err) {
      logIpcError('Saving settings failed', err);
      return false;
    }
  };

  // Arrow keys move between sections, Home and End jump to the ends, as a vertical tab list.
  const onNavKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    const last = SECTIONS.length - 1;
    let index = SECTIONS.indexOf(active);
    if (e.key === 'ArrowDown') index = (index + 1) % SECTIONS.length;
    else if (e.key === 'ArrowUp') index = (index - 1 + SECTIONS.length) % SECTIONS.length;
    else if (e.key === 'Home') index = 0;
    else if (e.key === 'End') index = last;
    else return;
    e.preventDefault();
    const next = SECTIONS[index] ?? active;
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
