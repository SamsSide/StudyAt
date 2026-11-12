// A full-window overlay (spec §4): frosted backdrop, a titled dialog, Esc or the close button
// closes it (Esc is handled by useShortcuts so the top overlay closes before the panel). Focus
// moves into the dialog, Tab stays inside it, and focus returns where it was on close.
import { createContext, type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { Icon } from './icons';
import styles from './shell.module.css';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Where a pop-up inside an overlay portals to, or null outside one (then `document.body` serves).
 * It is the dialog's last child, so a portalled panel stays inside the `aria-modal` tree (Tab and
 * screen readers keep it) while escaping the scrolling body. The dialog's backdrop filter makes it
 * the containing block for `position: fixed`, so the host fills the dialog's padding box and a
 * panel inside places itself relative to the host's rect.
 */
export const OverlayPortal = createContext<HTMLElement | null>(null);

export function Overlay({
  title,
  onClose,
  narrow = false,
  full = false,
  children,
}: {
  title: string;
  onClose: () => void;
  narrow?: boolean;
  /** The whole window less a 24 px inset (the Tasks board, v1.2 spec §3.7); the others keep their size. */
  full?: boolean;
  children: ReactNode;
}) {
  const titleId = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const [portalHost, setPortalHost] = useState<HTMLDivElement | null>(null);

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
      className={`${styles.scrim} ${full ? styles.scrimFull : ''}`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialog}
        className={`${styles.dialog} ${styles.frosted} ${narrow ? styles.dialogNarrow : ''} ${full ? styles.dialogFull : ''}`}
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
        <div className={styles.body}>
          <OverlayPortal.Provider value={portalHost}>{children}</OverlayPortal.Provider>
        </div>
        <div ref={setPortalHost} className={styles.portalHost} />
      </div>
    </div>
  );
}
