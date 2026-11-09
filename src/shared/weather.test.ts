import { describe, expect, it } from 'vitest';
import { wmoCondition } from './weather';

describe('wmoCondition', () => {
  it('gives clear and partly cloudy skies day and night icons', () => {
    expect(wmoCondition(0, true)).toEqual({ label: 'Clear', icon: 'clear-day' });
    expect(wmoCondition(0, false)).toEqual({ label: 'Clear', icon: 'clear-night' });
    expect(wmoCondition(1, true)).toEqual({ label: 'Mostly clear', icon: 'partly-day' });
    expect(wmoCondition(2, false)).toEqual({ label: 'Partly cloudy', icon: 'partly-night' });
  });

  it('maps each WMO group to its own icon whatever the time of day', () => {
    expect(wmoCondition(3, false)).toEqual({ label: 'Overcast', icon: 'cloudy' });
    expect(wmoCondition(45, true)).toEqual({ label: 'Fog', icon: 'fog' });
    expect(wmoCondition(48, true).icon).toBe('fog');
    expect(wmoCondition(53, true)).toEqual({ label: 'Drizzle', icon: 'drizzle' });
    expect(wmoCondition(57, true).icon).toBe('drizzle');
    expect(wmoCondition(63, true)).toEqual({ label: 'Rain', icon: 'rain' });
    expect(wmoCondition(65, false)).toEqual({ label: 'Heavy rain', icon: 'rain' });
    expect(wmoCondition(73, true)).toEqual({ label: 'Snow', icon: 'snow' });
    expect(wmoCondition(86, true).icon).toBe('snow');
    expect(wmoCondition(81, true)).toEqual({ label: 'Showers', icon: 'showers' });
    expect(wmoCondition(95, false)).toEqual({ label: 'Thunderstorm', icon: 'thunder' });
    expect(wmoCondition(99, true).icon).toBe('thunder');
  });

  it('reads an unknown code as cloud', () => {
    expect(wmoCondition(42, true)).toEqual({ label: 'Cloudy', icon: 'cloudy' });
  });
});
