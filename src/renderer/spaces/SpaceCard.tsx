// One card in the Spaces grid (spec §3.8): thumb, name, heart, and the ⋯ menu. The panel keeps
// at most one menu open; it closes on Escape, an outside click or focus leaving it.
import { useEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react';
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

const KIND_ICON: Record<Space['kind'], string> = { video: '🎞', image: '🖼', youtube: '▶' };

/** The card's picture: its thumb, an image space's own file, or a tinted tile for its kind. */
function CardThumb({ space }: { space: Space }) {
  const src = space.thumb ?? (space.kind === 'image' && !space.missing ? mediaUrl(space.id) : null);
  const [failed, setFailed] = useState<string | null>(null);
  if (src && failed !== src) {
    return <img src={src} alt="" loading="lazy" decoding="async" onError={() => setFailed(src)} />;
  }
  return (
    <div data-testid="space-placeholder" data-kind={space.kind} className={styles.placeholder} aria-hidden="true">
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
      <button type="button" aria-label={`Use ${space.name}`} onClick={p.onSelect} className={styles.thumbBtn}>
        <div className={styles.thumb}>
          <CardThumb space={space} />
        </div>
      </button>
      {renaming ? (
        <input
          aria-label="Space name"
          className={styles.input}
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
      <div className={styles.cardActions}>
        <button
          type="button"
          className={styles.icon}
          aria-label={space.favourite ? `Unfavourite ${space.name}` : `Favourite ${space.name}`}
          aria-pressed={space.favourite}
          onClick={p.onFavourite}
        >
          {space.favourite ? '♥' : '♡'}
        </button>
        <button
          ref={trigger}
          type="button"
          className={styles.icon}
          aria-label={`Menu for ${space.name}`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => onMenu(!menuOpen)}
        >
          ⋯
        </button>
      </div>
      {menuOpen && (
        <ul ref={menu} role="menu" aria-label={`${space.name} actions`} className={styles.menu} onKeyDown={onMenuKey} onBlur={onMenuBlur}>
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
