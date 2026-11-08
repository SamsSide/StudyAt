// A full-window overlay (spec §4): frosted backdrop, a titled dialog, Esc or the close button
// closes it (Esc is handled by useShortcuts so the top overlay closes before the panel). Focus
// moves into the dialog, Tab stays inside it, and focus returns where it was on close.
import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef } from 'react';
import { Icon } from './icons';
import styles from './shell.module.css';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Overlay({
  title,
  onClose,
  narrow = false,
  children,
}: {
  title: string;
  onClose: () => void;
  narrow?: boolean;
  children: ReactNode;
}) {
  const titleId = useId();
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.focus();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);

  const trapTab = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'Tab' || !dialog.current) return;
    const items = [...dialog.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;
    if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className={styles.scrim}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialog}
        className={`${styles.dialog} ${styles.frosted} ${narrow ? styles.dialogNarrow : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={trapTab}
      >
        <div className={styles.header}>
          <h2 id={titleId} className={styles.title}>
            {title}
          </h2>
          <button
            type="button"
            className={`${styles.iconButton} ${styles.small}`}
            onClick={onClose}
            aria-label={`Close ${title}`}
            title="Close (Esc)"
          >
            <Icon name="close" />
          </button>
        </div>
        <div className={styles.body}>{children}</div>
      </div>
    </div>
  );
}
