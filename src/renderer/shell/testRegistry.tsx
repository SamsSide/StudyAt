// A registry of labelled stubs for shell tests: each slot renders a marker the tests can find.
import type { Registry } from './Shell';

const stub = (label: string) => {
  const Stub = () => <div data-testid={label}>{label}</div>;
  Stub.displayName = `Stub(${label})`;
  return Stub;
};

export const testRegistry = (): Registry => ({
  panels: { spaces: stub('spaces-panel'), sounds: stub('sounds-panel') },
  widgets: {
    timer: stub('timer-widget'),
    tasks: stub('tasks-widget'),
    spotify: stub('spotify-widget'),
    calendar: stub('calendar-widget'),
    weather: stub('weather-widget'),
    quote: stub('quote-widget'),
    notes: stub('notes-widget'),
    deadlines: stub('deadlines-widget'),
  },
  overlays: {
    stats: stub('stats-overlay'),
    settings: stub('settings-overlay'),
    tasks: stub('tasks-overlay'),
  },
  background: stub('background'),
});
