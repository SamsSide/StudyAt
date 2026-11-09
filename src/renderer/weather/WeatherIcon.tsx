// The Weather widget's own condition icons (widgets addendum §3): simple filled shapes on a 32-unit
// grid in soft natural colours — a warm sun, a pale moon, white cloud, blue rain. Drawn here; no
// Apple or third-party artwork.
import { type ReactNode, useId } from 'react';
import type { WeatherIcon as WeatherIconName } from '../../shared/weather';

const SUN = '#ffd45c';
const MOON = '#e9edf7';
const CLOUD = '#f2f4f8';
const CLOUD_BACK = '#aeb6c4';
const STORM_CLOUD = '#c9cfda';
const RAIN = '#6fb8ff';
const DRIZZLE = '#9fd0ff';

/** A cloud resting on y = 25, about 16 units wide. */
const CLOUD_PATH = 'M10 25h13a5.5 5.5 0 0 0 .6-10.97A7.5 7.5 0 0 0 9.3 16.1 4.5 4.5 0 0 0 10 25z';

function Sun({ cx, cy, r }: { cx: number; cy: number; r: number }) {
  const rays = Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 4;
    const [inner, outer] = [r * 1.55, r * 2.05];
    return (
      <line
        key={i}
        x1={cx + Math.cos(a) * inner}
        y1={cy + Math.sin(a) * inner}
        x2={cx + Math.cos(a) * outer}
        y2={cy + Math.sin(a) * outer}
      />
    );
  });
  return (
    <g>
      <g stroke={SUN} strokeWidth={r * 0.36} strokeLinecap="round">
        {rays}
      </g>
      <circle cx={cx} cy={cy} r={r} fill={SUN} />
    </g>
  );
}

/** A crescent: a disc with an offset disc masked out. */
function Moon({ cx, cy, r, maskId }: { cx: number; cy: number; r: number; maskId: string }) {
  return (
    <g>
      <mask id={maskId}>
        <rect width="32" height="32" fill="white" />
        <circle cx={cx + r * 0.55} cy={cy - r * 0.45} r={r * 0.85} fill="black" />
      </mask>
      <circle cx={cx} cy={cy} r={r} fill={MOON} mask={`url(#${maskId})`} />
    </g>
  );
}

const Cloud = ({ fill = CLOUD, transform }: { fill?: string; transform?: string }) => (
  <path d={CLOUD_PATH} fill={fill} transform={transform} />
);

/** Raised cloud with something falling from it. */
const RAISED = 'translate(0 -5)';

const streaks = (colour: string, width: number, length: number) => (
  <g stroke={colour} strokeWidth={width} strokeLinecap="round">
    {[11.5, 16.5, 21.5].map((x) => (
      <line key={x} x1={x} y1={23} x2={x - length * 0.4} y2={23 + length} />
    ))}
  </g>
);

function art(icon: WeatherIconName, maskId: string): ReactNode {
  switch (icon) {
    case 'clear-day':
      return <Sun cx={16} cy={16} r={6.5} />;
    case 'clear-night':
      return <Moon cx={16} cy={16} r={9} maskId={maskId} />;
    case 'partly-day':
      return (
        <>
          <Sun cx={11.5} cy={11} r={4.5} />
          <Cloud transform="translate(2 2)" />
        </>
      );
    case 'partly-night':
      return (
        <>
          <Moon cx={11.5} cy={11} r={6} maskId={maskId} />
          <Cloud transform="translate(2 2)" />
        </>
      );
    case 'cloudy':
      return (
        <>
          <Cloud fill={CLOUD_BACK} transform="translate(5 -4) scale(0.85)" />
          <Cloud transform="translate(-1 1)" />
        </>
      );
    case 'fog':
      return (
        <>
          <Cloud transform={RAISED} />
          <g stroke={CLOUD_BACK} strokeWidth="2" strokeLinecap="round">
            <line x1="8" y1="24" x2="24" y2="24" />
            <line x1="11" y1="28" x2="27" y2="28" />
          </g>
        </>
      );
    case 'drizzle':
      return (
        <>
          <Cloud transform={RAISED} />
          {streaks(DRIZZLE, 1.8, 2.5)}
        </>
      );
    case 'rain':
      return (
        <>
          <Cloud transform={RAISED} />
          {streaks(RAIN, 2, 5)}
        </>
      );
    case 'showers':
      return (
        <>
          <Sun cx={11} cy={8} r={4} />
          <Cloud transform="translate(1 -4)" />
          {streaks(RAIN, 2, 5)}
        </>
      );
    case 'snow':
      return (
        <>
          <Cloud transform={RAISED} />
          <g fill={CLOUD}>
            {[
              [11, 24],
              [16.5, 27],
              [22, 24],
              [13.5, 29.5],
              [19.5, 29.5],
            ].map(([x, y]) => (
              <circle key={`${x}-${y}`} cx={x} cy={y} r={1.6} />
            ))}
          </g>
        </>
      );
    case 'thunder':
      return (
        <>
          <Cloud fill={STORM_CLOUD} transform={RAISED} />
          <path d="M17.5 20.5 12.5 26.5h3.5l-1.5 4.5 6-7h-3.5l1.5-3.5z" fill={SUN} />
        </>
      );
  }
}

export interface WeatherIconProps {
  icon: WeatherIconName;
  /** The condition, read out by screen readers; without it the icon is decorative. */
  label?: string;
  className?: string;
}

export function WeatherIcon({ icon, label, className }: WeatherIconProps) {
  const maskId = `moon-${useId().replace(/:/g, '')}`;
  return (
    <svg
      className={className}
      viewBox="0 0 32 32"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      data-icon={icon}
    >
      {art(icon, maskId)}
    </svg>
  );
}
