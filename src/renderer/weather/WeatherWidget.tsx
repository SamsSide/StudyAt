// Weather widget body (widgets addendum §3): a Mac Weather-style tile. The place, a large current
// temperature, the condition and today's high and low, then a five-day row. Main fetches Open-Meteo
// and caches for 30 min, retrying a failed fetch on each ask, so this asks every 10 min while the
// window is shown, on mount, when the window regains focus and when the place changes, and no faster.
// Rendered inside the shell's WidgetFrame.
import { useCallback, useEffect, useRef, useState } from 'react';
import { wmoCondition } from '../../shared/weather';
import type { WeatherReport } from '../../shared/widgets';
import { useStudyStore } from '../shell/store';
import { usePolling } from '../spotify/usePolling';
import { shortWeekday, temperature } from './format';
import { WeatherIcon } from './WeatherIcon';
import styles from './WeatherWidget.module.css';

const POLL_MS = 10 * 60_000;

const UNAVAILABLE: WeatherReport = { state: 'error', place: null, fetchedAt: null };

const pad = (n: number): string => String(n).padStart(2, '0');
const clockTime = (ms: number): string => {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export function WeatherWidget() {
  // null until the first answer, so no state message flashes on mount.
  const [report, setReport] = useState<WeatherReport | null>(null);
  const units = useStudyStore((s) => s.settings?.weatherUnits ?? 'celsius');
  const place = useStudyStore((s) => s.settings?.weatherPlace ?? null);
  const placeKey = place ? `${place.latitude},${place.longitude}` : '';

  const poll = useCallback(async () => {
    let next: WeatherReport;
    try {
      next = await window.studyat.weather.current();
    } catch {
      next = UNAVAILABLE; // main never rejects; treat a broken bridge as unavailable
    }
    setReport(next);
  }, []);

  usePolling(poll, POLL_MS, true);

  useEffect(() => {
    const onFocus = () => void poll();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [poll]);

  // A new place from Settings: ask at once rather than at the next tick (the mount poll covers the first).
  const seenPlace = useRef(placeKey);
  useEffect(() => {
    if (seenPlace.current === placeKey) return;
    seenPlace.current = placeKey;
    void poll();
  }, [placeKey, poll]);

  if (report === null) return <div className={styles.root} aria-busy="true" />;

  if (report.state === 'unconfigured') {
    return (
      <div className={`${styles.root} ${styles.state}`}>
        <StateIcon />
        <p className={styles.message}>Choose your location in Settings</p>
        <button
          type="button"
          className={styles.textButton}
          onClick={() => useStudyStore.getState().setOverlay('settings')}
        >
          Open settings
        </button>
      </div>
    );
  }

  const current = report.current;
  if (!current) {
    return (
      <div className={`${styles.root} ${styles.state}`}>
        <StateIcon />
        <p className={styles.message} role="status">
          Weather unavailable
        </p>
      </div>
    );
  }

  const deg = (c: number): string => `${temperature(c, units)}°`;
  const condition = wmoCondition(current.code, current.isDay);
  const daily = (report.daily ?? []).slice(0, 5);
  const today = daily[0];
  const stale = report.state !== 'ok';

  return (
    <div className={styles.root}>
      <div className={styles.now}>
        <div className={styles.lead}>
          <p className={styles.place}>
            <span className={styles.placeName}>{report.place?.name ?? place?.name ?? ''}</span>
            <LocationGlyph />
          </p>
          <p className={styles.temp}>{deg(current.tempC)}</p>
        </div>
        <div className={styles.summary}>
          <WeatherIcon className={styles.bigIcon} icon={condition.icon} label={condition.label} />
          <p className={styles.condition}>{condition.label}</p>
          {today && (
            <p className={styles.highLow}>
              H:{deg(today.maxC)} L:{deg(today.minC)}
            </p>
          )}
        </div>
      </div>

      {daily.length > 0 && (
        <ul className={styles.days} aria-label="Five-day forecast">
          {daily.map((d) => {
            const c = wmoCondition(d.code, true);
            return (
              <li key={d.date} className={styles.dayCell}>
                <span className={styles.dayName} data-day>
                  {shortWeekday(d.date)}
                </span>
                <WeatherIcon className={styles.dayIcon} icon={c.icon} label={c.label} />
                <span className={styles.dayHigh}>{deg(d.maxC)}</span>
                <span className={styles.dayLow}>{deg(d.minC)}</span>
              </li>
            );
          })}
        </ul>
      )}

      <footer className={styles.footer}>
        {stale && report.fetchedAt !== null && (
          <span className={styles.updated} role="status">
            Updated {clockTime(report.fetchedAt)}
          </span>
        )}
        <span>Weather data by Open-Meteo.com</span>
      </footer>
    </div>
  );
}

function LocationGlyph() {
  return (
    <svg className={styles.locationGlyph} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M13.5 2.5 2.5 7l4.6 1.9L9 13.5z" fill="currentColor" />
    </svg>
  );
}

/** The quiet cloud shown above a state message. */
function StateIcon() {
  return (
    <span className={styles.stateIcon} aria-hidden="true">
      <WeatherIcon icon="partly-day" />
    </span>
  );
}
