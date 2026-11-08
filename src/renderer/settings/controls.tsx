// Small form controls shared by the settings sections: a labelled row, a toggle and a number field
// that commits a clamped whole number on blur or Enter (ranges from spec §3.11).
import { type ReactNode, useId, useState } from 'react';
import styles from './settings.module.css';

export const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n));

export function Row({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.row}>
      <div className={styles.rowText}>
        <label className={styles.label} htmlFor={htmlFor}>
          {label}
        </label>
        {hint && <span className={styles.hint}>{hint}</span>}
      </div>
      <div className={styles.controls}>{children}</div>
    </div>
  );
}

export function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  const id = useId();
  return (
    <Row label={label} hint={hint} htmlFor={id}>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        className={styles.toggle}
        onClick={() => onChange(!checked)}
      />
    </Row>
  );
}

export function NumberField({
  label,
  hint,
  value,
  min,
  max,
  unit,
  onCommit,
}: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  unit?: string;
  /** Saves the number; resolves false when it couldn't be saved (the field then reverts). */
  onCommit: (next: number) => Promise<boolean> | void;
}) {
  const id = useId();
  const [failed, setFailed] = useState(false);
  const [draft, setDraft] = useState(String(value));
  // Follow the saved value when it changes from outside (adjusting state during render).
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setDraft(String(value));
  }

  const commit = async (): Promise<void> => {
    const parsed = Number(draft);
    if (draft.trim() === '' || !Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    const next = clamp(Math.round(parsed), min, max);
    setDraft(String(next));
    if (next === value) return;
    setFailed(false);
    if ((await onCommit(next)) === false) {
      setDraft(String(value));
      setFailed(true);
    }
  };

  return (
    <Row label={label} hint={hint} htmlFor={id}>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        className={`${styles.input} ${styles.numberInput}`}
        min={min}
        max={max}
        value={draft}
        aria-describedby={failed ? `${id}-error` : undefined}
        onChange={(e) => {
          setFailed(false);
          setDraft(e.target.value);
        }}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void commit();
        }}
      />
      {unit && <span className={styles.hint}>{unit}</span>}
      {failed && (
        <span id={`${id}-error`} role="alert" className={styles.error}>
          Couldn&apos;t save that. Please try again.
        </span>
      )}
    </Row>
  );
}
