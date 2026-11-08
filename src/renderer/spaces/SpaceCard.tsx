// One card in the Spaces grid (spec §3.8): thumb, name, heart, and the ⋯ menu.
import { useState } from 'react';
import type { Space } from '../../shared/types';
import styles from './spaces.module.css';

export interface SpaceCardProps {
  space: Space;
  active: boolean;
  embedError: boolean;
  onSelect(): void;
  onFavourite(): void;
  onRename(name: string): void;
  onSettings(): void;
  onRemove(): void;
  onRelocate(): void;
}

export function SpaceCard(p: SpaceCardProps) {
  const { space } = p;
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(space.name);

  const commitRename = () => {
    setRenaming(false);
    const next = name.trim();
    if (next && next !== space.name) p.onRename(next);
    else setName(space.name);
  };
  const choose = (fn: () => void) => () => {
    setMenu(false);
    fn();
  };

  return (
    <li
      aria-current={p.active ? 'true' : undefined}
      className={styles.card}
    >
      <button
        type="button"
        aria-label={`Use ${space.name}`}
        onClick={p.onSelect}
        className={styles.thumbBtn}
      >
        <div className={styles.thumb}>
          {space.thumb && <img src={space.thumb} alt="" />}
        </div>
      </button>
      {renaming ? (
        <input
          aria-label="Space name"
          className={styles.input}
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => e.key === 'Enter' && commitRename()}
        />
      ) : (
        <div className={styles.name}>{space.name}</div>
      )}
      {space.missing && (
        <button type="button" className={styles.btn} onClick={p.onRelocate}>
          File moved — Relocate…
        </button>
      )}
      {p.embedError && <div className={styles.note}>This video can't be embedded</div>}
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
        <button type="button" className={styles.icon} aria-label={`Menu for ${space.name}`} aria-expanded={menu} onClick={() => setMenu(!menu)}>
          ⋯
        </button>
      </div>
      {menu && (
        <ul role="menu" className={styles.menu}>
          {!space.builtin && (
            <li role="none">
              <button role="menuitem" type="button" onClick={choose(() => setRenaming(true))}>
                Rename
              </button>
            </li>
          )}
          <li role="none">
            <button role="menuitem" type="button" onClick={choose(p.onSettings)}>
              Settings
            </button>
          </li>
          {!space.builtin && (
            <li role="none">
              <button role="menuitem" type="button" onClick={choose(p.onRemove)}>
                Remove
              </button>
            </li>
          )}
        </ul>
      )}
    </li>
  );
}
