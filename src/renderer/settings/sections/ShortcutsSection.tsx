// Settings → Shortcuts (spec §3.7): the editable global hotkey, plus the in-app keys for reference.
// If main can't register the hotkey, `settings.set` rejects and its message shows under the field.
import { type KeyboardEvent, useId, useState } from 'react';
import { ipcErrorMessage } from '../../lib/ipcError';
import { SHORTCUTS } from '../../shell/useShortcuts';
import { Row } from '../controls';
import styles from '../settings.module.css';
import type { SectionProps } from './types';

const MODIFIER_KEYS = new Set(['Control', 'Alt', 'Shift', 'Meta']);

const NAMED_CODES: Record<string, string> = {
  Space: 'Space',
  Enter: 'Return',
  Tab: 'Tab',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Minus: '-',
  Equal: '=',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  NumpadAdd: 'numadd',
  NumpadSubtract: 'numsub',
  NumpadMultiply: 'nummult',
  NumpadDivide: 'numdiv',
  NumpadDecimal: 'numdec',
};

/** The accelerator name for a physical key, so Shift and keyboard layout don't change it. */
function keyFromCode(code: string): string | null {
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1] ?? null;
  const digit = /^Digit(\d)$/.exec(code);
  if (digit) return digit[1] ?? null;
  const numpad = /^Numpad(\d)$/.exec(code);
  if (numpad) return `num${numpad[1]}`;
  if (/^F\d{1,2}$/.test(code)) return code;
  return NAMED_CODES[code] ?? null;
}

/** An Electron accelerator from a key press, or null while only modifiers are down (or an unknown key). */
export function acceleratorFromEvent(
  e: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>,
): string | null {
  if (MODIFIER_KEYS.has(e.key)) return null;
  const key = keyFromCode(e.code);
  if (!key) return null;
  const parts: string[] = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  if (e.metaKey) parts.push('Super');
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
      setError(ipcErrorMessage(err) || "That shortcut couldn't be registered.");
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
        label="Start or pause the timer"
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
