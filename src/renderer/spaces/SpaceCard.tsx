// One card in the Spaces grid (spec §3.8): thumb, name, heart, and the ⋯ menu. The panel keeps
// at most one menu open; it closes on Escape, an outside click or focus leaving it.
import { useEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type ReactElement } from 'react';
import type { Space } from '../../shared/types';
import styles from './spaces.module.css';
import { mediaUrl, type VideoError } from './spacesStore';

export interface SpaceCardProps {
  space: Space;
  active: boolean;
  videoError?: VideoError;
  menuOpen: boolean;
  onMenu(open: boolean): void;
  onSelect(): void;
  onFavourite(): void;
  onRename(name: string): void;
  onSettings(): void;
  onRemove(): void;
  onRelocate(): void;
}

// Our own line icons: 16-unit grid, stroke follows the text colour.
const svg = { viewBox: '0 0 16 16', width: 16, height: 16, 'aria-hidden': true, focusable: false } as const;
const line = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.4,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

function HeartIcon({ filled }: { filled: boolean }) {
  return (
    <svg {...svg}>
      <path
        {...line}
        fill={filled ? 'currentColor' : 'none'}
        d="M8 13.2S2.5 9.9 2.5 6.1A2.9 2.9 0 0 1 8 4.6a2.9 2.9 0 0 1 5.5 1.5C13.5 9.9 8 13.2 8 13.2Z"
      />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg {...svg}>
      <circle cx="3.5" cy="8" r="1.3" fill="currentColor" />
      <circle cx="8" cy="8" r="1.3" fill="currentColor" />
      <circle cx="12.5" cy="8" r="1.3" fill="currentColor" />
    </svg>
  );
}

const KIND_ICON: Record<Space['kind'], ReactElement> = {
  video: (
    <svg {...svg} width={22} height={22}>
      <rect {...line} x="2" y="3.5" width="12" height="9" rx="2" />
      <path {...line} d="M6.8 6.2v3.6L9.8 8Z" />
    </svg>
  ),
  image: (
    <svg {...svg} width={22} height={22}>
      <rect {...line} x="2" y="3" width="12" height="10" rx="2" />
      <path {...line} d="m2.5 11 3.2-3.2 2.6 2.6 1.8-1.8 3.4 3.4" />
      <circle cx="10.8" cy="6" r="1" fill="currentColor" />
    </svg>
  ),
  youtube: (
    <svg {...svg} width={22} height={22}>
      <rect {...line} x="1.8" y="3.5" width="12.4" height="9" rx="3" />
      <path d="M6.8 6.1v3.8L10 8Z" fill="currentColor" />
    </svg>
  ),
};

/**
 * The card's picture: its thumb, then an image space's own file, then a tinted tile for its kind.
 * Each source that fails to load hands over to the next.
 */
function CardThumb({ space }: { space: Space }) {
  const sources = [space.thumb, space.kind === 'image' && !space.missing ? mediaUrl(space.id) : null].filter(
    (s): s is string => !!s,
  );
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  const src = sources.find((s) => !failed.has(s));
  if (src) {
    return (
      <img
        key={src}
        src={src}
        alt=""
        loading="lazy"
        decoding="async"
        onError={() => setFailed((prev) => new Set(prev).add(src))}
      />
    );
  }
  return (
    <div
      data-testid="space-placeholder"
      data-kind={space.kind}
      className={styles.placeholder}
      aria-hidden="true"
    >
      {KIND_ICON[space.kind]}
    </div>
  );
}

export function SpaceCard(p: SpaceCardProps) {
  const { space, menuOpen, onMenu } = p;
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(space.name);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLUListElement>(null);
  // Set once a rename is saved or cancelled, so the input's closing blur doesn't save it again.
  const renameDone = useRef(false);

  const items = () => Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);

  // Opening moves focus to the first item.
  useEffect(() => {
    if (menuOpen) menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [menuOpen]);

  // A press anywhere outside the menu and ⋯ closes it.
  useEffect(() => {
    if (!menuOpen) return;
    const outside = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (t && (menu.current?.contains(t) || trigger.current?.contains(t))) return;
      onMenu(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [menuOpen, onMenu]);

  const closeMenu = () => {
    onMenu(false);
    trigger.current?.focus();
  };

  const onMenuKey = (e: KeyboardEvent<HTMLUListElement>) => {
    const all = items();
    const at = all.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') {
      // Handled here, so the shell doesn't also close the panel.
      e.preventDefault();
      e.stopPropagation();
      closeMenu();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      all[(at + step + all.length) % all.length]?.focus();
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      (e.key === 'Home' ? all[0] : all[all.length - 1])?.focus();
    }
  };

  // Focus leaving the menu (Tab, or a click elsewhere) closes it; moving to ⋯ is left to ⋯'s toggle.
  const onMenuBlur = (e: FocusEvent<HTMLUListElement>) => {
    const next = e.relatedTarget as Node | null;
    if (next && (menu.current?.contains(next) || trigger.current?.contains(next))) return;
    onMenu(false);
  };

  // Starts from the name as it is now, not as it was when the card first rendered.
  const startRename = () => {
    renameDone.current = false;
    setName(space.name);
    setRenaming(true);
  };
  const commitRename = () => {
    if (renameDone.current) return;
    renameDone.current = true;
    setRenaming(false);
    const next = name.trim();
    if (next && next !== space.name) p.onRename(next);
  };
  const onRenameKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      commitRename();
      trigger.current?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      renameDone.current = true;
      setRenaming(false);
      trigger.current?.focus();
    }
  };

  const choose = (fn: () => void) => {
    onMenu(false);
    fn();
  };

  return (
    <li aria-current={p.active ? 'true' : undefined} className={styles.card}>
      {/* The heart and ⋯ float on the picture's corners as glass chips (real-app finding F12), so a
          card is a picture and a name and three rows fit the panel at 1280×800. They sit beside
          the select button, not inside it: a button can't hold buttons. */}
      <div className={styles.cardMedia}>
        <button
          type="button"
          aria-label={`Use ${space.name}`}
          onClick={p.onSelect}
          className={styles.thumbBtn}
        >
          <div className={styles.thumb}>
            <CardThumb space={space} />
          </div>
        </button>
        <button
          type="button"
          className={`${styles.chip} ${styles.chipFav}`}
          aria-label={space.favourite ? `Unfavourite ${space.name}` : `Favourite ${space.name}`}
          aria-pressed={space.favourite}
          onClick={p.onFavourite}
        >
          <HeartIcon filled={space.favourite} />
        </button>
        <button
          ref={trigger}
          type="button"
          className={`${styles.chip} ${styles.chipMenu}`}
          aria-label={`Menu for ${space.name}`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => onMenu(!menuOpen)}
        >
          <MoreIcon />
        </button>
      </div>
      {renaming ? (
        <input
          aria-label="Space name"
          className={`${styles.input} ${styles.renameInput}`}
          autoFocus
          maxLength={120}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitRename}
          onKeyDown={onRenameKey}
        />
      ) : (
        <div className={styles.name} title={space.name}>
          {space.name}
        </div>
      )}
      {space.missing && (
        <button type="button" className={styles.btn} onClick={p.onRelocate}>
          File moved — Relocate…
        </button>
      )}
      {p.videoError === 'embed' && <div className={styles.note}>This video can't be embedded</div>}
      {p.videoError === 'play' && <div className={styles.note}>This video can't be played</div>}
      {menuOpen && (
        <ul
          ref={menu}
          role="menu"
          aria-label={`${space.name} actions`}
          className={styles.menu}
          onKeyDown={onMenuKey}
          onBlur={onMenuBlur}
        >
          {!space.builtin && (
            <li role="none">
              <button role="menuitem" type="button" tabIndex={-1} onClick={() => choose(startRename)}>
                Rename
              </button>
            </li>
          )}
          <li role="none">
            <button role="menuitem" type="button" tabIndex={-1} onClick={() => choose(p.onSettings)}>
              Settings
            </button>
          </li>
          {!space.builtin && (
            <li role="none">
              <button role="menuitem" type="button" tabIndex={-1} onClick={() => choose(p.onRemove)}>
                Remove
              </button>
            </li>
          )}
        </ul>
      )}
    </li>
  );
}
