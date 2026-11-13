// What fills each slot of the shell (spec §4 + widgets addendum): the two side panels, the seven
// widgets, the three full-window overlays and the space behind everything.
import { CalendarWidget } from './calendar/CalendarWidget';
import { DeadlinesWidget } from './deadlines/DeadlinesWidget';
import { NotesWidget } from './notes/NotesWidget';
import { QuoteWidget } from './quote/QuoteWidget';
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
import { WeatherWidget } from './weather/WeatherWidget';

/** The Sounds panel with the active space's audio slider; image spaces have no audio, so no slider. */
function BoundSoundsPanel() {
  const [, , canPlayAudio] = useSpaceAudio();
  return <SoundsPanel spaceAudio={canPlayAudio ? spaceAudio : undefined} />;
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
    calendar: CalendarWidget,
    weather: WeatherWidget,
    quote: QuoteWidget,
    notes: NotesWidget,
    deadlines: DeadlinesWidget,
  },
  overlays: { stats: StatsOverlay, settings: SettingsOverlay },
  background: Background,
};
