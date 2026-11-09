// Settings → Calendar (widgets addendum §2): the three steps verbatim, up to five password-style
// fields for the private iCal addresses, and the calendars main found. Addresses are secrets: main
// keeps them encrypted and never sends them back, so the fields only ever hold what is being added,
// and they are emptied once saved. Saving replaces the stored list and clears main's cached agenda,
// so it happens only on an explicit Save, and only when the list differs from the last one saved here.
import { useEffect, useId, useState } from 'react';
import type { CalendarStatus } from '../../../shared/widgets';
import { ipcErrorMessage } from '../../lib/ipcError';
import { Row } from '../controls';
import styles from '../settings.module.css';

const MAX_CALENDARS = 5;
const PRIVACY_NOTE = 'This link is private — StudyAt keeps it encrypted on this PC.';
const SAVE_FAILED = "Couldn't save your calendars. Please try again.";

const cleaned = (urls: string[]): string[] => urls.map((u) => u.trim()).filter((u) => u !== '');
const sameList = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((u, i) => u === b[i]);

export function CalendarSection() {
  const id = useId();
  const [status, setStatus] = useState<CalendarStatus | null>(null);
  const [urls, setUrls] = useState<string[]>(['']);
  const [lastSaved, setLastSaved] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let live = true;
    window.studyat.calendar.status().then(
      (s) => live && setStatus(s),
      (err: unknown) => console.error('Calendar status failed', err),
    );
    return () => {
      live = false;
    };
  }, []);

  const next = cleaned(urls);
  const canSave = !busy && next.length > 0 && !(lastSaved && sameList(next, lastSaved));

  const send = async (list: string[]): Promise<void> => {
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      setStatus(await window.studyat.calendar.setUrls(list));
      setLastSaved(list);
      setUrls(['']);
      setSaved(list.length > 0);
    } catch (err) {
      console.error('Saving calendars failed', err);
      setError(ipcErrorMessage(err) || SAVE_FAILED);
    } finally {
      setBusy(false);
    }
  };

  const edit = (index: number, value: string): void => {
    setSaved(false);
    setUrls((list) => list.map((u, i) => (i === index ? value : u)));
  };

  // Removing the only field just empties it, so there is always somewhere to paste.
  const remove = (index: number): void =>
    setUrls((list) => (list.length === 1 ? [''] : list.filter((_, i) => i !== index)));

  const connected = status?.configured ? status.calendars : [];

  return (
    <section aria-labelledby="settings-calendar">
      <h3 id="settings-calendar" className={styles.heading}>
        Calendar
      </h3>
      <ol className={styles.steps}>
        <li>Open Google Calendar on the web and go to Settings.</li>
        <li>
          Under &apos;Settings for my calendars&apos;, choose your calendar, then &apos;Integrate
          calendar&apos;.
        </li>
        <li>Copy the &apos;Secret address in iCal format&apos; and paste it here.</li>
      </ol>

      <Row label="Calendars" hint={connected.length > 0 ? 'Shown in the Calendar widget' : 'Not set up'}>
        {connected.length > 0 && (
          <button type="button" className={styles.button} disabled={busy} onClick={() => void send([])}>
            Remove all calendars
          </button>
        )}
      </Row>
      {connected.length > 0 && (
        <ul className={styles.list} aria-label="Connected calendars">
          {connected.map((c, i) => (
            <li key={`${c.name}-${i}`} className={styles.listItem}>
              <span className={styles.dot} style={{ backgroundColor: c.colour }} aria-hidden="true" />
              <span className={styles.grow}>{c.name}</span>
            </li>
          ))}
        </ul>
      )}

      <h4 className={styles.subheading}>{connected.length > 0 ? 'Replace with' : 'Addresses'}</h4>
      <ul className={styles.list}>
        {urls.map((url, i) => {
          const fieldId = `${id}-url-${i}`;
          return (
            <li key={i} className={styles.listItem}>
              <label className={styles.visuallyHidden} htmlFor={fieldId}>
                Calendar address {i + 1}
              </label>
              <input
                id={fieldId}
                type="password"
                className={`${styles.input} ${styles.grow}`}
                value={url}
                placeholder="https://calendar.google.com/calendar/ical/…"
                spellCheck={false}
                autoComplete="off"
                onChange={(e) => edit(i, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && canSave) void send(next);
                }}
              />
              <button
                type="button"
                className={styles.button}
                aria-label={`Remove calendar address ${i + 1}`}
                onClick={() => remove(i)}
              >
                Remove
              </button>
            </li>
          );
        })}
      </ul>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.button}
          disabled={urls.length >= MAX_CALENDARS}
          onClick={() => setUrls((list) => [...list, ''])}
        >
          Add calendar
        </button>
        <button
          type="button"
          className={`${styles.button} ${styles.primary}`}
          disabled={!canSave}
          onClick={() => void send(next)}
        >
          Save
        </button>
      </div>
      <p className={styles.note}>{PRIVACY_NOTE}</p>
      {connected.length > 0 && (
        <p className={styles.note}>Saving replaces the calendars above, so paste every address you want.</p>
      )}
      {saved && (
        <p role="status" className={styles.note}>
          Saved.
        </p>
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </section>
  );
}
