// Tag chips with remove buttons and an input (v1.2 spec §3.6): Enter adds through the shared
// normaliser; at MAX_TAGS the input is aria-disabled (so it keeps focus) and a hint says why.
import { useId, useState, type KeyboardEvent } from 'react';
import { LIMIT_COPY, MAX_TAGS, normaliseTag } from '../../shared/planner';
import styles from './detail.module.css';

interface Props {
  tags: string[];
  onChange(tags: string[]): void;
  label: string;
}

export function TagInput({ tags, onChange, label }: Props) {
  const [text, setText] = useState('');
  const [invalid, setInvalid] = useState(false);
  const full = tags.length >= MAX_TAGS;
  const hintId = useId();
  const invalidId = useId();

  const add = (): void => {
    if (text.trim() === '') return;
    const tag = normaliseTag(text.trim());
    if (tag === null) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setText('');
    if (!tags.includes(tag)) onChange([...tags, tag]);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!full) add();
    }
  };

  return (
    <div className={styles.tags}>
      <ul className={styles.tagList} aria-label="Chosen tags">
        {tags.map((tag) => (
          <li key={tag} className={styles.tagChip}>
            #{tag}
            <button
              type="button"
              className={styles.tagRemove}
              aria-label={`Remove tag ${tag}`}
              onClick={() => onChange(tags.filter((t) => t !== tag))}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <input
        className={styles.input}
        aria-label={label}
        aria-invalid={invalid || undefined}
        aria-disabled={full || undefined}
        aria-describedby={
          [full ? hintId : null, invalid ? invalidId : null].filter(Boolean).join(' ') || undefined
        }
        placeholder="#tag"
        value={text}
        readOnly={full}
        onChange={(e) => {
          if (full) return;
          setText(e.target.value);
          setInvalid(false);
        }}
        onKeyDown={onKeyDown}
      />
      {full && (
        <p id={hintId} className={styles.hint}>
          {LIMIT_COPY.tags}
        </p>
      )}
      {invalid && (
        <p id={invalidId} role="alert" className={styles.hint}>
          Tags use letters, numbers and hyphens, up to 24 characters.
        </p>
      )}
    </div>
  );
}
