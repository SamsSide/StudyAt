// WMO weather codes (as Open-Meteo reports them) to British condition text and one of the widget's
// own icons (widgets addendum §3). Pure, so main and the renderer read the same words.

export type WeatherIcon =
  | 'clear-day'
  | 'clear-night'
  | 'partly-day'
  | 'partly-night'
  | 'cloudy'
  | 'fog'
  | 'drizzle'
  | 'rain'
  | 'snow'
  | 'showers'
  | 'thunder';

export interface WeatherCondition {
  label: string;
  icon: WeatherIcon;
}

type Kind = WeatherIcon | 'clear' | 'partly';

const CODES: Record<number, [string, Kind]> = {
  0: ['Clear', 'clear'],
  1: ['Mostly clear', 'partly'],
  2: ['Partly cloudy', 'partly'],
  3: ['Overcast', 'cloudy'],
  45: ['Fog', 'fog'],
  48: ['Freezing fog', 'fog'],
  51: ['Light drizzle', 'drizzle'],
  53: ['Drizzle', 'drizzle'],
  55: ['Heavy drizzle', 'drizzle'],
  56: ['Freezing drizzle', 'drizzle'],
  57: ['Freezing drizzle', 'drizzle'],
  61: ['Light rain', 'rain'],
  63: ['Rain', 'rain'],
  65: ['Heavy rain', 'rain'],
  66: ['Freezing rain', 'rain'],
  67: ['Freezing rain', 'rain'],
  71: ['Light snow', 'snow'],
  73: ['Snow', 'snow'],
  75: ['Heavy snow', 'snow'],
  77: ['Snow grains', 'snow'],
  80: ['Light showers', 'showers'],
  81: ['Showers', 'showers'],
  82: ['Heavy showers', 'showers'],
  85: ['Snow showers', 'snow'],
  86: ['Heavy snow showers', 'snow'],
  95: ['Thunderstorm', 'thunder'],
  96: ['Thunderstorm with hail', 'thunder'],
  99: ['Thunderstorm with hail', 'thunder'],
};

/** An unknown code reads as plain cloud rather than guessing at rain or sun. */
export function wmoCondition(code: number, isDay: boolean): WeatherCondition {
  const [label, kind] = CODES[code] ?? ['Cloudy', 'cloudy'];
  if (kind === 'clear') return { label, icon: isDay ? 'clear-day' : 'clear-night' };
  if (kind === 'partly') return { label, icon: isDay ? 'partly-day' : 'partly-night' };
  return { label, icon: kind };
}
