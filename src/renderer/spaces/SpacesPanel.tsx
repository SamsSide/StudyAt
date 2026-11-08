// The Spaces side panel (spec §3.8): tabs, search, grid of cards, add files, add YouTube.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { parseYouTubeId } from '../../core/youtube';
import type { Space } from '../../shared/types';
import { SpaceCard } from './SpaceCard';
import { SpaceSettings } from './SpaceSettings';
import styles from './spaces.module.css';
import { mediaUrl, useSpacesStore } from './spacesStore';
import { captureThumbnail } from './thumbnail';

export const TABS = ['All', 'Videos', 'Images', 'YouTube', 'Favourites'] as const;
type Tab = (typeof TABS)[number];

const inTab = (s: Space, tab: Tab): boolean =>
  tab === 'All' ||
  (tab === 'Videos' && s.kind === 'video') ||
  (tab === 'Images' && s.kind === 'image') ||
  (tab === 'YouTube' && s.kind === 'youtube') ||
  (tab === 'Favourites' && s.favourite);

export function SpacesPanel() {
  const spaces = useSpacesStore((s) => s.spaces);
  const activeId = useSpacesStore((s) => s.activeId);
  const loaded = useSpacesStore((s) => s.loaded);
  const embedErrors = useSpacesStore((s) => s.embedErrors);
  const { load, apply, reload, setActive, update } = useSpacesStore.getState();
  const [tab, setTab] = useState<Tab>('All');
  const [query, setQuery] = useState('');
  const [url, setUrl] = useState('');
  const [urlError, setUrlError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settingsId, setSettingsId] = useState<number | null>(null);
  const [menuId, setMenuId] = useState<number | null>(null);

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return spaces.filter((s) => inTab(s, tab) && (!q || s.name.toLowerCase().includes(q)));
  }, [spaces, tab, query]);

  // One menu open at a time: opening a card's menu replaces any other; a card can only close its own.
  const onMenu = useCallback(
    (id: number, open: boolean) => setMenuId((cur) => (open ? id : cur === id ? null : cur)),
    [],
  );

  const api = window.studyat.spaces;

  /** Runs a call to main; on failure shows `message` and re-reads the list so nothing is stale. */
  const attempt = async <T,>(call: () => Promise<T>, message: string): Promise<T | undefined> => {
    setError(null);
    try {
      return await call();
    } catch {
      setError(message);
      await reload();
      return undefined;
    }
  };

  const addFiles = async () => {
    const before = new Set(spaces.map((s) => s.id));
    const next = await attempt(() => api.addFiles(), "Couldn't add those files. Try again.");
    if (!next) return;
    apply(next);
    // New videos arrive without a thumb: capture one each and save it (spec §3.8).
    for (const s of next) {
      if (before.has(s.id) || s.kind !== 'video' || s.thumb) continue;
      try {
        await update(s.id, { thumb: await captureThumbnail(mediaUrl(s.id)) });
      } catch {
        // No thumbnail is fine; the card shows a placeholder tile.
      }
    }
  };

  const addYouTube = async () => {
    if (!parseYouTubeId(url)) {
      setUrlError("That doesn't look like a YouTube link.");
      return;
    }
    setUrlError(null);
    try {
      apply(await api.addYouTube(url.trim()));
      setUrl('');
    } catch {
      // The link stays in the box so Sam can retry.
      setUrlError("Couldn't add that video. Try again.");
      await reload();
    }
  };

  const remove = async (id: number) => {
    const next = await attempt(() => api.remove(id), "Couldn't remove that space. Try again.");
    if (!next) return;
    apply(next);
    // Removing the space on screen would leave an empty background: fall back to a built-in one.
    if (useSpacesStore.getState().activeId === id) {
      const fallback = next.find((s) => s.builtin) ?? next[0];
      if (fallback) await attempt(() => setActive(fallback.id), "Couldn't switch spaces. Try again.");
    }
  };

  const relocate = async (id: number) => {
    const next = await attempt(() => api.relocate(id), "Couldn't relocate that file. Try again.");
    if (next) apply(next);
  };

  const settingsSpace = spaces.find((s) => s.id === settingsId);
  if (settingsSpace) return <SpaceSettings space={settingsSpace} onClose={() => setSettingsId(null)} />;

  return (
    <div className={styles.panel}>
      <div role="tablist" aria-label="Space kinds" className={styles.tabs}>
        {TABS.map((t) => (
          <button key={t} role="tab" type="button" className={styles.tab} aria-selected={t === tab} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>
      <input
        type="search"
        className={styles.input}
        aria-label="Search spaces"
        placeholder="Search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className={styles.row}>
        <button type="button" className={styles.btn} onClick={() => void addFiles()}>
          Add files…
        </button>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void addYouTube();
        }}
        className={styles.row}
      >
        <input
          aria-label="YouTube link"
          className={styles.input}
          placeholder="Paste a YouTube link"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setUrlError(null);
          }}
        />
        <button type="submit" className={`${styles.btn} ${styles.primary}`}>
          Add YouTube
        </button>
      </form>
      {urlError && (
        <div role="alert" className={styles.error}>
          {urlError}
        </div>
      )}
      {error && (
        <div role="alert" className={styles.error}>
          {error}
        </div>
      )}
      {shown.length === 0 ? (
        loaded && <p className={styles.empty}>No spaces match.</p>
      ) : (
        <ul className={styles.grid}>
          {shown.map((s) => (
            <SpaceCard
              key={s.id}
              space={s}
              active={s.id === activeId}
              videoError={embedErrors[s.id]}
              menuOpen={menuId === s.id}
              onMenu={(open) => onMenu(s.id, open)}
              onSelect={() => void attempt(() => setActive(s.id), "Couldn't switch spaces. Try again.")}
              onFavourite={() => void update(s.id, { favourite: !s.favourite })}
              onRename={(name) => void update(s.id, { name })}
              onSettings={() => setSettingsId(s.id)}
              onRemove={() => void remove(s.id)}
              onRelocate={() => void relocate(s.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
