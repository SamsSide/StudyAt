// Settings → Data (spec §3.11): exports, the backups list with "Restore…", the data folder.
// Restore goes straight to main, whose native dialog is the one confirmation (spec §3.6); the app restarts after.
// A failure shows a fixed line; main's reason (a path, an fs code) goes to the log only (ruling R38).
import { useEffect, useState } from 'react';
import type { BackupInfo } from '../../../shared/types';
import { logIpcError } from '../../lib/ipcError';
import styles from '../settings.module.css';

const formatSize = (bytes: number): string =>
  bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

const formatWhen = (ms: number): string =>
  new Date(ms).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

const DAILY = /^daily-(\d{4})-(\d{2})-(\d{2})\.sqlite$/;

/** A daily backup is one per day, so it shows its date only ("8 Nov 2026", F11), taken from its
 *  name; a pre-migration or pre-restore backup keeps its time too. */
const formatBackupWhen = (b: BackupInfo): string => {
  const daily = DAILY.exec(b.name);
  if (!daily) return formatWhen(b.createdAt);
  const [, y, m, d] = daily;
  return new Date(Number(y), Number(m) - 1, Number(d)).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
};

export function DataSection() {
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    window.studyat.data.listBackups().then(
      (list) => live && setBackups(list),
      (err: unknown) => {
        logIpcError('Listing backups failed', err);
        if (live) setError("Couldn't list your backups.");
      },
    );
    return () => {
      live = false;
    };
  }, []);

  const run = async (work: () => Promise<unknown>, failure: string, done?: string): Promise<void> => {
    setError('');
    setNotice('');
    try {
      const result = await work();
      if (done && result !== false) setNotice(done);
    } catch (err) {
      logIpcError(failure, err);
      setError(failure);
    }
  };

  const restore = async (name: string): Promise<void> => {
    await run(() => window.studyat.data.restoreBackup(name), "Couldn't restore that backup.");
  };

  return (
    <section aria-labelledby="settings-data">
      <h3 id="settings-data" className={styles.heading}>
        Data
      </h3>
      <p className={styles.note}>Everything stays on this PC. Export a copy whenever you like.</p>
      <div className={styles.listItem}>
        <button
          type="button"
          className={styles.button}
          onClick={() =>
            void run(() => window.studyat.data.exportJson(), "Couldn't export JSON.", 'Exported.')
          }
        >
          Export JSON
        </button>
        <button
          type="button"
          className={styles.button}
          onClick={() => void run(() => window.studyat.data.exportCsv(), "Couldn't export CSV.", 'Exported.')}
        >
          Export CSV
        </button>
        <button
          type="button"
          className={styles.button}
          onClick={() =>
            void run(() => window.studyat.data.openDataFolder(), "Couldn't open the data folder.")
          }
        >
          Open data folder
        </button>
      </div>
      {notice && (
        <p role="status" className={styles.note}>
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}

      <h4 className={styles.subheading}>Backups</h4>
      {backups.length === 0 ? (
        <p className={styles.note}>No backups yet. StudyAt makes one the first time you open it each day.</p>
      ) : (
        <ul className={styles.list} aria-label="Backups">
          {backups.map((b) => (
            <li key={b.name} className={styles.listItem}>
              <span className={styles.grow}>
                <span className={styles.label}>{b.name}</span>
                <br />
                <span className={styles.hint}>
                  {formatBackupWhen(b)} · {formatSize(b.size)}
                </span>
              </span>
              <button
                type="button"
                className={styles.button}
                aria-label={`Restore ${b.name}`}
                onClick={() => void restore(b.name)}
              >
                Restore…
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
