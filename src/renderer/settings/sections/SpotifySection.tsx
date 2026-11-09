// Settings → Spotify (spec §3.10, §3.14): the four setup steps verbatim, the Client ID field and
// connect / disconnect. A busy callback port gets the §7 copy.
import { useEffect, useId, useState } from 'react';
import type { SpotifyStatus } from '../../../shared/types';
import { ipcErrorMessage } from '../../lib/ipcError';
import { Row } from '../controls';
import styles from '../settings.module.css';
import type { SectionProps } from './types';

export const REDIRECT_URI = 'http://127.0.0.1:43821/callback';
export const PORT_IN_USE_COPY = 'Port 43821 is in use — close the other app and retry';
const NEEDS_CLIENT_ID_COPY = 'Paste your Client ID to connect.';

export function SpotifySection({ settings, update }: SectionProps) {
  const id = useId();
  const [clientId, setClientId] = useState(settings.spotifyClientId);
  const [status, setStatus] = useState<SpotifyStatus | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [seen, setSeen] = useState(settings.spotifyClientId);
  if (seen !== settings.spotifyClientId) {
    setSeen(settings.spotifyClientId);
    setClientId(settings.spotifyClientId);
  }
  useEffect(() => {
    let live = true;
    window.studyat.spotify.status().then(
      (s) => live && setStatus(s),
      (err: unknown) => console.error('Spotify status failed', err),
    );
    return () => {
      live = false;
    };
  }, [settings.spotifyClientId]);

  const saveClientId = (): void => {
    const trimmed = clientId.trim();
    setClientId(trimmed);
    if (trimmed !== settings.spotifyClientId) void update({ spotifyClientId: trimmed });
  };

  const connect = async (): Promise<void> => {
    setBusy(true);
    setError('');
    try {
      setStatus(await window.studyat.spotify.connect());
    } catch (err) {
      console.error('Spotify connect failed', err);
      const text = ipcErrorMessage(err);
      setError(
        text.includes('Port 43821 is in use')
          ? PORT_IN_USE_COPY
          : "Couldn't connect to Spotify. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async (): Promise<void> => {
    setBusy(true);
    setError('');
    try {
      setStatus(await window.studyat.spotify.disconnect());
    } catch (err) {
      console.error('Spotify disconnect failed', err);
      setError("Couldn't disconnect. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const connected = status?.connected ?? false;
  const needsClientId = !connected && clientId.trim() === '';
  const helpId = `${id}-help`;

  return (
    <section aria-labelledby="settings-spotify">
      <h3 id="settings-spotify" className={styles.heading}>
        Spotify
      </h3>
      <ol className={styles.steps}>
        <li>Go to developer.spotify.com/dashboard and log in.</li>
        <li>Create an app. Any name works, e.g. StudyAt.</li>
        <li>
          Add this Redirect URI: <span className={styles.code}>{REDIRECT_URI}</span>
        </li>
        <li>Tick &apos;Web API&apos;, save, then copy the Client ID here.</li>
      </ol>
      <Row label="Client ID" htmlFor={id}>
        <input
          id={id}
          className={`${styles.input} ${styles.wideInput}`}
          value={clientId}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => setClientId(e.target.value)}
          onBlur={saveClientId}
          onKeyDown={(e) => {
            if (e.key === 'Enter') saveClientId();
          }}
        />
      </Row>
      <Row label="Status" hint={connected ? 'Connected to Spotify' : 'Not connected'}>
        {connected ? (
          <button type="button" className={styles.button} disabled={busy} onClick={() => void disconnect()}>
            Disconnect
          </button>
        ) : (
          <button
            type="button"
            className={`${styles.button} ${styles.primary}`}
            disabled={busy || needsClientId}
            aria-describedby={needsClientId ? helpId : undefined}
            onClick={() => void connect()}
          >
            Connect
          </button>
        )}
      </Row>
      {needsClientId && (
        <p id={helpId} className={styles.note}>
          {NEEDS_CLIENT_ID_COPY}
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
