// Display helpers for the Weather widget and its settings (widgets addendum §3). Main reports
// Celsius; units are converted here, in the renderer.
import type { WeatherUnits } from '../../shared/types';
import type { Place } from '../../shared/widgets';

/** A whole-degree temperature in the chosen units. `|| 0` keeps a rounded -0 from showing as "-0". */
export const temperature = (celsius: number, units: WeatherUnits): number =>
  Math.round(units === 'fahrenheit' ? (celsius * 9) / 5 + 32 : celsius) || 0;

/** "Durham, England, United Kingdom"; a region that repeats the name is left out. */
export const placeLabel = (p: Place): string =>
  [p.name, p.admin1 !== p.name ? p.admin1 : null, p.country]
    .filter((part): part is string => !!part)
    .join(', ');

const SHORT_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Mon" for a `YYYY-MM-DD` forecast day, read as a calendar date (not shifted by the local zone). */
export const shortWeekday = (date: string): string => {
  const [y, m, d] = date.split('-').map(Number);
  return SHORT_WEEKDAYS[new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)).getUTCDay()] ?? '';
};
