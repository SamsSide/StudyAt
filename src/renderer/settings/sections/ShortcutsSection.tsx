// Settings → Shortcuts (spec §3.7): the editable global hotkey, plus the in-app keys for reference.
// If main can't register the hotkey, `settings.set` rejects and its message shows under the field.
import { type KeyboardEvent, useId, useState } from 'react';
import { SHORTCUTS } from '../../shell/useShortcuts';
import { Row } from '../controls';
import styles from '../settings.module.css';
import type { SectionProps } from './types';

const MODIFIER_KEYS = new Set(['Control', 'Alt', 'Shift', 'Meta']);

/** An Electron accelerator from a key press, or null while only modifiers are down. */
export function acceleratorFromEvent(
  e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>,
): string | null {
  if (MODIFIER_KEYS.has(e.key)) return null;
  const parts: string[] = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  if (e.metaKey) parts.push('Super');
  const key =
    e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() : e.key.replace(/^Arrow/, '');
  return [...parts, key].join('+');
}

export function ShortcutsSection({ settings, updateOrThrow }: SectionProps) {
  const id = useId();
  const [error, setError] = useState('');
  const [shown, setShown] = useState(settings.globalHotkey);
  const [seen, setSeen] = useState(settings.globalHotkey);
  if (seen !== settings.globalHotkey) {
    setSeen(settings.globalHotkey);
    setShown(settings.globalHotkey);
  }

  const save = async (hotkey: string): Promise<void> => {
    setError('');
    setShown(hotkey);
    try {
      await updateOrThrow({ globalHotkey: hotkey });
    } catch (err) {
      console.error('Registering the global hotkey failed', err);
      setShown(settings.globalHotkey);
      setError(err instanceof Error ? err.message : "That shortcut couldn't be registered.");
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Tab' || e.key === 'Escape') return;
    e.preventDefault();
    if (e.key === 'Backspace' || e.key === 'Delete') {
      void save('');
      return;
    }
    const accelerator = acceleratorFromEvent(e);
    if (!accelerator) return;
    if (!(e.ctrlKey || e.altKey || e.metaKey)) {
      setError('Include Ctrl, Alt or Super so it works from any app.');
      return;
    }
    void save(accelerator);
  };

  return (
    <section aria-labelledby="settings-shortcuts">
      <h3 id="settings-shortcuts" className={styles.heading}>
        Shortcuts
      </h3>
      <Row
        label="Show or hide StudyAt"
        hint="Works from any app. Click the box and press the keys; Backspace turns it off."
        htmlFor={id}
      >
        <input
          id={id}
          className={`${styles.input} ${styles.wideInput}`}
          value={shown}
          placeholder="Off"
          readOnly
          spellCheck={false}
          aria-describedby={error ? `${id}-error` : undefined}
          onKeyDown={onKeyDown}
        />
      </Row>
      {error && (
        <p id={`${id}-error`} role="alert" className={styles.error}>
          {error}
        </p>
      )}

      <h4 className={styles.subheading}>Inside StudyAt</h4>
      <ul className={styles.list} aria-label="In-app shortcuts">
        {SHORTCUTS.map((s) => (
          <li key={s.keys} className={styles.listItem}>
            <span className={`${styles.code} ${styles.grow}`}>{s.keys}</span>
            <span>{s.action}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
