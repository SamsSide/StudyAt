// The "Add image…" dialog (v1.1 spec §3.6), opened from the Widgets popover: "Choose file…" (main
// shows the file dialog) or a link and "Add" (main downloads it once and keeps a copy). Main's
// answer is either the new image, which closes the dialog, or `{ error }`, shown verbatim in an
// alert; a cancelled file dialog answers an empty error and changes nothing. Modal like the other
// overlays: Esc closes it and nothing behind it, and no shortcut reaches the app underneath.
import { type FormEvent, type KeyboardEvent, useId, useState } from 'react';
import type { ImageAddResult } from '../../shared/types';
import { Overlay } from '../shell/Overlay';
import styles from './images.module.css';
import { useImagesStore } from './imagesStore';

export function AddImageDialog() {
  const adding = useImagesStore((s) => s.adding);
  return adding ? <AddImage /> : null;
}

function AddImage() {
  const setAdding = useImagesStore((s) => s.setAdding);
  const addFile = useImagesStore((s) => s.addFile);
  const addUrl = useImagesStore((s) => s.addUrl);
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const linkId = useId();

  const close = (): void => setAdding(false);

  const run = async (call: () => Promise<ImageAddResult>): Promise<void> => {
    setBusy(true);
    setError('');
    const result = await call();
    setBusy(false);
    if ('id' in result) close();
    else if (result.error) setError(result.error);
  };

  const onSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    const link = url.trim();
    if (link && !busy) void run(() => addUrl(link));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
    // Modal: no key reaches the shell's shortcuts behind it.
    e.stopPropagation();
  };

  return (
    <div onKeyDown={onKeyDown}>
      <Overlay title="Add image" onClose={close} narrow>
        <div className={styles.add}>
          <div>
            <button
              type="button"
              className={styles.textButton}
              disabled={busy}
              onClick={() => void run(addFile)}
            >
              Choose file…
            </button>
          </div>
          {/* noValidate: our own checks and copy answer a bad link, not Chromium's US-English bubble. */}
          <form className={styles.link} onSubmit={onSubmit} noValidate>
            <label className={styles.label} htmlFor={linkId}>
              Link
            </label>
            <div className={styles.row}>
              <input
                id={linkId}
                className={styles.input}
                type="url"
                inputMode="url"
                placeholder="https://…"
                autoComplete="off"
                spellCheck={false}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
              <button type="submit" className={styles.primaryButton} disabled={busy || url.trim() === ''}>
                Add
              </button>
            </div>
          </form>
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
        </div>
      </Overlay>
    </div>
  );
}
