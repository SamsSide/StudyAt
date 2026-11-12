// The add row at the foot of a day or list (v1.2 spec §3.6): type, press Enter. `#tag`, `~1h30m`
// and `@subject` are read out of the text by the shared parser; the rest is the title.
import { useImperativeHandle, useRef, useState, type FormEvent, type KeyboardEvent, type Ref } from 'react';
import { parseQuickAdd } from '../../core/planner/quickAdd';
import type { PlannerTask, TaskInput } from '../../shared/types';
import { useStudyStore } from '../shell/store';
import { usePlannerStore } from './plannerStore';
import styles from './planner.module.css';

type Place = { day: string } | { listId: number };

interface Props {
  label: string;
  /** A function is resolved at submit time (the Day view's "today" can roll over while open). */
  place: Place | (() => Place);
  onCreated?(t: PlannerTask): void;
  /** Overrides the widget's syntax hint. */
  placeholder?: string;
  /** For a click on a blank line to focus the input. */
  inputRef?: Ref<HTMLInputElement>;
  /** `'line'` is a board column's bare add line: no placeholder, and Esc clears and leaves it. */
  variant?: 'widget' | 'line';
}

export function QuickAdd({ label, place, onCreated, placeholder, inputRef, variant = 'widget' }: Props) {
  const [text, setText] = useState('');
  const own = useRef<HTMLInputElement>(null);
  useImperativeHandle(inputRef, () => own.current as HTMLInputElement);
  const pending = useRef(false);
  const subjects = useStudyStore((s) => s.subjects);
  const create = usePlannerStore((s) => s.create);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (pending.current) return; // a second Enter while the first is still being created
    const parsed = parseQuickAdd(text, subjects);
    if (parsed.title === '') return;
    const input: TaskInput = { title: parsed.title, ...(typeof place === 'function' ? place() : place) };
    if (parsed.tags.length > 0) input.tags = parsed.tags;
    if (parsed.estimateMin !== null) input.estimateMin = parsed.estimateMin;
    if (parsed.subjectId !== null) input.subjectId = parsed.subjectId;
    pending.current = true;
    try {
      const made = await create(input);
      if (!made) return; // keep the text so nothing typed is lost; the store has only logged the failure
      setText('');
      onCreated?.(made);
    } finally {
      pending.current = false;
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (variant !== 'line' || e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation(); // the board stays open
    setText('');
    own.current?.blur();
  };

  return (
    <form className={styles.addRow} onSubmit={(e) => void submit(e)}>
      <input
        className={styles.addInput}
        aria-label={label}
        data-variant={variant}
        ref={own}
        {...(variant === 'line' ? {} : { placeholder: placeholder ?? `${label} · #tag ~45m @subject` })}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
      />
    </form>
  );
}
