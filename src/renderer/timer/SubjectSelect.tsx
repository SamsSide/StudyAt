// The subject picker (spec §4): "No subject" plus the live subjects, each with its colour dot. A
// select-only combobox (WAI-ARIA APG pattern) rather than a native select, so the list can show
// the dots and match the frosted look instead of opening OS-styled on Windows. Focus stays on the
// combobox; the active option is pointed at with aria-activedescendant. An archived subject stays
// listed only while it is the one selected.
import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';
import { useStudyStore } from '../shell/store';
import styles from './timer.module.css';

type Choice = { id: number | null; name: string; colour: string | null };

const NO_SUBJECT: Choice = { id: null, name: 'No subject', colour: null };
/** Room the list needs below the box before it opens upwards instead. */
const LIST_ROOM = 260;
/** Type-ahead forgets what was typed after this pause. */
const TYPE_AHEAD_MS = 600;
const PAGE = 5;

function Dot({ colour }: { colour: string | null }) {
  return (
    <span className={styles.dot} style={colour ? { background: colour } : undefined} aria-hidden="true" data-dot />
  );
}

export function SubjectSelect() {
  const subjects = useStudyStore((s) => s.subjects);
  const subjectId = useStudyStore((s) => s.timer.subjectId);
  const choices: Choice[] = [NO_SUBJECT, ...subjects.filter((s) => !s.archived || s.id === subjectId)];
  const selected = Math.max(0, choices.findIndex((c) => c.id === subjectId));

  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(selected);
  const [upwards, setUpwards] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const typed = useRef({ text: '', timer: 0 });
  const id = useId();
  const labelId = `${id}-label`;
  const listId = `${id}-list`;
  const optionId = (i: number): string => `${id}-option-${i}`;

  useEffect(() => () => window.clearTimeout(typed.current.timer), []);

  // Keep the active option in view as the arrows move through a long list.
  useEffect(() => {
    if (!open) return;
    document.getElementById(optionId(active))?.scrollIntoView?.({ block: 'nearest' });
  });

  const show = (at: number): void => {
    const rect = box.current?.getBoundingClientRect();
    setUpwards(rect !== undefined && rect.bottom + LIST_ROOM > window.innerHeight);
    setActive(at);
    setOpen(true);
  };
  const close = (): void => {
    setOpen(false);
    typed.current.text = '';
  };
  const pick = (i: number): void => {
    close();
    const choice = choices[i];
    if (choice && choice.id !== subjectId) void window.studyat.timer.setSubject(choice.id);
  };
  const clamp = (i: number): number => Math.min(choices.length - 1, Math.max(0, i));

  // Moves to the next option whose name starts with what was just typed (case-insensitive).
  const typeAhead = (key: string): void => {
    const t = typed.current;
    window.clearTimeout(t.timer);
    t.text += key.toLowerCase();
    t.timer = window.setTimeout(() => (t.text = ''), TYPE_AHEAD_MS);
    const from = open ? active : selected;
    // A repeated single letter cycles; a longer prefix stays on the current match if it still fits.
    const start = t.text.length === 1 ? from + 1 : from;
    for (let n = 0; n < choices.length; n++) {
      const i = (start + n) % choices.length;
      if (choices[i]!.name.toLowerCase().startsWith(t.text)) {
        if (open) setActive(i);
        else show(i);
        return;
      }
    }
    if (!open) show(from);
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.ctrlKey || e.metaKey) return;
    const { key } = e;
    if (!open) {
      if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Enter' || key === ' ') show(selected);
      else if (key === 'Home') show(0);
      else if (key === 'End') show(choices.length - 1);
      else if (key.length === 1 && !e.altKey) typeAhead(key);
      else return;
    } else if (key === 'ArrowDown') setActive(clamp(active + 1));
    else if (key === 'ArrowUp' && e.altKey) pick(active);
    else if (key === 'ArrowUp') setActive(clamp(active - 1));
    else if (key === 'Home') setActive(0);
    else if (key === 'End') setActive(choices.length - 1);
    else if (key === 'PageDown') setActive(clamp(active + PAGE));
    else if (key === 'PageUp') setActive(clamp(active - PAGE));
    else if (key === 'Enter' || (key === ' ' && typed.current.text === '')) pick(active);
    else if (key === 'Escape') close();
    else if (key === 'Tab') {
      pick(active);
      return; // let Tab move focus on as usual
    } else if (key.length === 1 && !e.altKey) typeAhead(key);
    else return;
    // Handled here, so the in-app shortcuts (Space, R, Esc...) leave it alone.
    e.preventDefault();
  };

  const current = choices[selected]!;

  return (
    <div className={styles.subject}>
      <span id={labelId} className={styles.visuallyHidden}>
        Subject
      </span>
      <div
        ref={box}
        className={styles.combo}
        role="combobox"
        tabIndex={0}
        aria-labelledby={labelId}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? optionId(active) : undefined}
        title={current.name}
        onClick={() => (open ? close() : show(selected))}
        onKeyDown={onKey}
        onBlur={close}
      >
        <Dot colour={current.colour} />
        <span className={styles.comboText}>{current.name}</span>
        <svg className={styles.chevron} viewBox="0 0 12 12" aria-hidden="true">
          <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </div>
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-labelledby={labelId}
          className={`${styles.listbox} ${upwards ? styles.upwards : ''}`}
          tabIndex={-1}
        >
          {choices.map((c, i) => (
            <li
              key={c.id ?? 'none'}
              id={optionId(i)}
              role="option"
              aria-selected={i === selected}
              className={`${styles.option} ${i === active ? styles.activeOption : ''}`}
              // Keep focus on the combobox, so choosing doesn't blur and close it first.
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(i)}
            >
              <Dot colour={c.colour} />
              <span className={styles.optionText}>{c.name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
