// The session intention (v1.2 spec §3.11): a one-line field under the task picker in focus modes,
// "By the end I will…", saved on blur or Enter. Main owns the text; this shows `timer.intention`.
import { useRef, useState } from 'react';
import { isFocusMode } from '../../shared/modes';
import { INTENTION_MAX } from '../../shared/planner';
import { DEFAULT_SETTINGS } from '../../shared/settings';
import { useStudyStore } from '../shell/store';
import styles from './timer.module.css';

export function IntentionField() {
  const mode = useStudyStore((s) => s.timer.mode);
  const intention = useStudyStore((s) => s.timer.intention);
  const enabled = useStudyStore((s) => s.settings?.sessionIntention ?? DEFAULT_SETTINGS.sessionIntention);
  const [draft, setDraft] = useState<string | null>(null);
  // The last text sent, so Enter followed by the blur it causes sends once.
  const sent = useRef<string | null>(null);
  if (!enabled || !isFocusMode(mode)) return null;

  const shown = draft ?? intention ?? '';
  const commit = (raw: string, leaving: boolean): void => {
    const text = raw.trim();
    // Enter keeps the draft on show until main's push lands, so the box never flashes back.
    if (leaving) setDraft(null);
    if (text === (sent.current ?? intention ?? '')) return;
    sent.current = text;
    void window.studyat.timer.setIntention(text === '' ? null : text).catch(() => undefined);
  };

  return (
    <input
      type="text"
      className={styles.intention}
      aria-label="What I will do this focus"
      placeholder="By the end I will…"
      maxLength={INTENTION_MAX}
      value={shown}
      onFocus={() => {
        sent.current = null;
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => commit(e.target.value, true)}
      onKeyDown={(e) => {
        // Stop here, so the in-app shortcuts (Space, R...) leave typing alone.
        e.stopPropagation();
        if (e.key === 'Enter') commit(e.currentTarget.value, false);
      }}
    />
  );
}
