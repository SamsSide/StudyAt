// Shared shapes for the Calendar and Weather widgets (widgets addendum §2, §3). Main fetches and
// parses; the renderer only ever sees these, never a calendar URL (addendum §2, §5).

/** A place picked from the Open-Meteo place search (addendum §3). */
export interface Place {
  name: string;
  latitude: number;
  longitude: number;
  country: string | null;
  admin1: string | null;
}

/** `ok` is fresh, `stale` is the last good result after a failed refresh. */
export type WidgetState = 'unconfigured' | 'ok' | 'stale' | 'error';

/** `weather.current()` (addendum §3). Temperatures are Celsius; units are converted in the renderer. */
export interface WeatherReport {
  state: WidgetState;
  place: Place | null;
  fetchedAt: number | null;
  current?: { tempC: number; code: number; isDay: boolean };
  /** Five days from the place's today; `date` is `YYYY-MM-DD` in the place's time zone. */
  daily?: { date: string; maxC: number; minC: number; code: number }[];
}

export interface CalendarEvent {
  /** Stable per occurrence: the same event on the same day keeps its id across refreshes. */
  id: string;
  title: string;
  start: number;
  end: number;
  allDay: boolean;
  calendar: string;
  colour: string;
  location: string | null;
}

/** `calendar.agenda()` (addendum §2): today 00:00 local to seven days on, sorted, at most 50. */
export interface CalendarAgenda {
  state: WidgetState;
  fetchedAt: number | null;
  events: CalendarEvent[];
}

/** `calendar.status()` / `calendar.setUrls()` (addendum §2). Never carries a URL. */
export interface CalendarStatus {
  configured: boolean;
  calendars: { name: string; colour: string }[];
}
