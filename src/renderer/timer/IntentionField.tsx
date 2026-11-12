// The session intention (v1.2 spec §3.11): a one-line field under the task picker in focus modes,
// "By the end I will…", saved on blur or Enter. Main owns the text; this shows `timer.intention`.
import { useState } from 'react';
import { isFocusMode } from '../../shared/modes';
import { INTENTION_MAX } from '../../shared/planner';
import { DEFAULT_SETTINGS } from '../../shared/settings';
import { useStudyStore } from '../shell/store';
import styles from './timer.module.css';

// `draft` is what is being typed; `sent` is the last text sent, so Enter followed by the blur it
// causes sends once.
type Edit = { draft: string | null; sent: string | null };
const CLEAN: Edit = { draft: null, sent: null };

export function IntentionField() {
  const mode = useStudyStore((s) => s.timer.mode);
  const intention = useStudyStore((s) => s.timer.intention);
  const enabled = useStudyStore((s) => s.settings?.sessionIntention ?? DEFAULT_SETTINGS.sessionIntention);
  const [edit, setEdit] = useState<Edit>(CLEAN);
  const visible = enabled && isFocusMode(mode);
  // The draft must not outlive the field, nor a newer text from main: both drop it.
  const [seen, setSeen] = useState({ visible, intention });
  if (seen.visible !== visible || seen.intention !== intention) {
    setSeen({ visible, intention });
    setEdit(CLEAN);
  }
  if (!visible) return null;

  const shown = edit.draft ?? intention ?? '';
  const commit = (raw: string, leaving: boolean): void => {
    const text = raw.trim();
    // Enter keeps the draft on show until main's push lands, so the box never flashes back.
    const draft = leaving ? null : edit.draft;
    if (text === (edit.sent ?? intention ?? '')) {
      setEdit({ ...edit, draft });
      return;
    }
    setEdit({ draft, sent: text });
    void window.studyat.timer.setIntention(text === '' ? null : text).catch(() => undefined);
  };

  return (
    <input
      type="text"
      className={styles.intention}
      aria-label="What I will do this focus"
      placeholder="By the end I will…"
      value={shown}
      onFocus={() => setEdit({ ...edit, sent: null })}
      // Capped in code points, not UTF-16 units, so an emoji counts as one.
      onChange={(e) => setEdit({ ...edit, draft: [...e.target.value].slice(0, INTENTION_MAX).join('') })}
      onBlur={(e) => commit(e.target.value, true)}
      onKeyDown={(e) => {
        // Stop here, so the in-app shortcuts (Space, R...) leave typing alone.
        e.stopPropagation();
        if (e.key === 'Enter') commit(e.currentTarget.value, false);
      }}
    />
  );
}
