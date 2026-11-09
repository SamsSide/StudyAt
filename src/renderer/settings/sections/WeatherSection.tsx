// Settings → Weather (widgets addendum §3): a place search (Open-Meteo, through main) that asks
// 300 ms after typing stops, the chosen place with Clear, and the units as a segmented control.
// The place goes through `weather.setPlace`, which returns the merged settings for the store.
import { useEffect, useId, useRef, useState } from 'react';
import type { WeatherUnits } from '../../../shared/types';
import type { Place } from '../../../shared/widgets';
import { ipcErrorMessage } from '../../lib/ipcError';
import { useStudyStore } from '../../shell/store';
import { placeLabel } from '../../weather/format';
import { Row } from '../controls';
import styles from '../settings.module.css';
import type { SectionProps } from './types';

const DEBOUNCE_MS = 300;
const MIN_QUERY = 2;
const SEARCH_FAILED = "Couldn't search for places. Please try again.";
const SAVE_FAILED = "Couldn't save your location. Please try again.";

const UNITS: { value: WeatherUnits; label: string }[] = [
  { value: 'celsius', label: 'Celsius' },
  { value: 'fahrenheit', label: 'Fahrenheit' },
];

export function WeatherSection({ settings, update }: SectionProps) {
  const id = useId();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Place[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const q = query.trim();
    const mine = ++seq.current;
    if (q.length < MIN_QUERY) return undefined; // the change handler has already cleared the results
    const timer = setTimeout(() => {
      window.studyat.weather.searchPlaces(q).then(
        (places) => {
          if (mine !== seq.current) return; // a newer search is on its way
          setError('');
          setResults(places);
        },
        (err: unknown) => {
          if (mine !== seq.current) return;
          console.error('Place search failed', err);
          setResults(null);
          setError(ipcErrorMessage(err) || SEARCH_FAILED);
        },
      );
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const choose = async (place: Place | null): Promise<void> => {
    setBusy(true);
    setError('');
    try {
      const next = await window.studyat.weather.setPlace(place);
      useStudyStore.setState({ settings: next });
      setQuery('');
      setResults(null);
    } catch (err) {
      console.error('Saving the weather place failed', err);
      setError(ipcErrorMessage(err) || SAVE_FAILED);
    } finally {
      setBusy(false);
    }
  };

  const place = settings.weatherPlace;
  const searchId = `${id}-search`;

  return (
    <section aria-labelledby="settings-weather">
      <h3 id="settings-weather" className={styles.heading}>
        Weather
      </h3>
      <Row label="Location" hint={place ? placeLabel(place) : 'Not set'}>
        {place && (
          <button type="button" className={styles.button} disabled={busy} onClick={() => void choose(null)}>
            Clear
          </button>
        )}
      </Row>
      <Row label="Search for a place" htmlFor={searchId}>
        <input
          id={searchId}
          type="search"
          className={`${styles.input} ${styles.wideInput}`}
          value={query}
          placeholder="City or town"
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => {
            setQuery(e.target.value);
            if (e.target.value.trim().length < MIN_QUERY) setResults(null);
          }}
        />
      </Row>
      {results !== null &&
        (results.length > 0 ? (
          <ul className={styles.results} aria-label="Places">
            {results.map((p) => (
              <li key={`${p.latitude},${p.longitude}`}>
                <button
                  type="button"
                  className={styles.result}
                  disabled={busy}
                  onClick={() => void choose(p)}
                >
                  {placeLabel(p)}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.note}>No places found</p>
        ))}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <Row label="Units">
        <div className={styles.segmented} role="group" aria-label="Units">
          {UNITS.map((u) => (
            <button
              key={u.value}
              type="button"
              className={styles.segment}
              aria-pressed={settings.weatherUnits === u.value}
              onClick={() => {
                if (settings.weatherUnits !== u.value) void update({ weatherUnits: u.value });
              }}
            >
              {u.label}
            </button>
          ))}
        </div>
      </Row>
      <p className={styles.note}>Weather data by Open-Meteo.com</p>
    </section>
  );
}
