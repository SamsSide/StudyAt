// Tag chips with remove buttons and an input (v1.2 spec §3.6): Enter adds through the shared
// normaliser; at MAX_TAGS the input is disabled with the limit copy as its tooltip.
import { useState, type KeyboardEvent } from 'react';
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
      add();
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
        placeholder="#tag"
        value={text}
        disabled={full}
        title={full ? LIMIT_COPY.tags : undefined}
        onChange={(e) => {
          setText(e.target.value);
          setInvalid(false);
        }}
        onKeyDown={onKeyDown}
      />
      {invalid && (
        <p role="alert" className={styles.hint}>
          Tags use letters, numbers and hyphens, up to 24.
        </p>
      )}
    </div>
  );
}
