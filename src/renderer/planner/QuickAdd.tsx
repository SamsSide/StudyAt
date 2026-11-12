// The add row at the foot of a day or list (v1.2 spec §3.6): type, press Enter. `#tag`, `~1h30m`
// and `@subject` are read out of the text by the shared parser; the rest is the title.
import { useState, type FormEvent } from 'react';
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
}

export function QuickAdd({ label, place, onCreated }: Props) {
  const [text, setText] = useState('');
  const subjects = useStudyStore((s) => s.subjects);
  const create = usePlannerStore((s) => s.create);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    const parsed = parseQuickAdd(text, subjects);
    if (parsed.title === '') return;
    const input: TaskInput = { title: parsed.title, ...(typeof place === 'function' ? place() : place) };
    if (parsed.tags.length > 0) input.tags = parsed.tags;
    if (parsed.estimateMin !== null) input.estimateMin = parsed.estimateMin;
    if (parsed.subjectId !== null) input.subjectId = parsed.subjectId;
    const made = await create(input);
    if (!made) return; // keep the text; the store has shown its notice
    setText('');
    onCreated?.(made);
  };

  return (
    <form className={styles.addRow} onSubmit={(e) => void submit(e)}>
      <input
        className={styles.addInput}
        aria-label={label}
        placeholder={`${label} · #tag ~45m @subject`}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
    </form>
  );
}
