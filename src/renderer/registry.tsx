// What fills each slot of the shell (spec §4): the two side panels, the three widgets, the two
// full-window overlays and the space behind everything.
import type { Registry } from './shell/Shell';
import { SettingsOverlay } from './settings/SettingsOverlay';
import { SoundsPanel } from './sounds/SoundsPanel';
import { SpaceBackground } from './spaces/SpaceBackground';
import { spaceAudio, useSpaceAudio } from './spaces/spaceAudio';
import { SpacesPanel } from './spaces/SpacesPanel';
import { SpotifyWidget } from './spotify/SpotifyWidget';
import { StatsOverlay } from './stats/StatsOverlay';
import { TasksWidget } from './tasks/TasksWidget';
import { TimerWidget } from './timer/TimerWidget';

/** The Sounds panel with the active space's audio slider; image spaces have no audio, so no slider. */
function BoundSoundsPanel() {
  const [, , canPlayAudio] = useSpaceAudio();
  return <SoundsPanel spaceAudio={canPlayAudio ? spaceAudio : undefined} />;
}

/** TEMPORARY (W2): stands in for the Calendar, Weather, Quote and Notes widgets until W3 builds them. */
function ComingSoon() {
  return <p style={{ margin: 0, opacity: 0.7 }}>Coming soon</p>;
}

function Background() {
  return (
    <div data-testid="app-background" style={{ position: 'absolute', inset: 0 }}>
      <SpaceBackground />
    </div>
  );
}

export const registry: Registry = {
  panels: { spaces: SpacesPanel, sounds: BoundSoundsPanel },
  widgets: {
    timer: TimerWidget,
    tasks: TasksWidget,
    spotify: SpotifyWidget,
    calendar: ComingSoon,
    weather: ComingSoon,
    quote: ComingSoon,
    notes: ComingSoon,
  },
  overlays: { stats: StatsOverlay, settings: SettingsOverlay },
  background: Background,
};
