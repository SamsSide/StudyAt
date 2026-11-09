import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { WeatherIcon as WeatherIconName } from '../../shared/weather';
import { WeatherIcon } from './WeatherIcon';

const ALL: WeatherIconName[] = [
  'clear-day',
  'clear-night',
  'partly-day',
  'partly-night',
  'cloudy',
  'fog',
  'drizzle',
  'rain',
  'snow',
  'showers',
  'thunder',
];

describe('WeatherIcon', () => {
  it.each(ALL)('draws %s', (icon) => {
    const { container } = render(<WeatherIcon icon={icon} />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('data-icon', icon);
    expect(svg?.childElementCount).toBeGreaterThan(0);
  });

  it('is decorative without a label and an image with one', () => {
    const { container } = render(<WeatherIcon icon="rain" />);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    render(<WeatherIcon icon="rain" label="Rain" />);
    expect(screen.getByRole('img', { name: 'Rain' })).toBeInTheDocument();
  });

  it('gives each moon its own mask, so two night icons never share one', () => {
    const { container } = render(
      <>
        <WeatherIcon icon="clear-night" />
        <WeatherIcon icon="partly-night" />
      </>,
    );
    const ids = [...container.querySelectorAll('mask')].map((m) => m.id);
    expect(new Set(ids).size).toBe(2);
  });
});
