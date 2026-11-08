// Settings → Subjects (spec §3.12): add with a colour (the six seed colours or a free hex), rename
// inline, recolour, archive. Archived subjects are listed but cannot come back in v1, because
// `subjects.update` takes no `archived` field. Sessions keep their subject either way.
import { useId, useState } from 'react';
import { SEED_SUBJECTS } from '../../../shared/subjects';
import type { Subject } from '../../../shared/types';
import { useStudyStore } from '../../shell/store';
import styles from '../settings.module.css';

const PALETTE: readonly string[] = SEED_SUBJECTS.map((s) => s.colour);
const HEX = /^#[0-9a-f]{6}$/i;

function ColourPicker({
  value,
  describe,
  onPick,
}: {
  value: string;
  describe: string;
  onPick: (colour: string) => void;
}) {
  const [hex, setHex] = useState(value);
  const commitHex = (): void => {
    if (HEX.test(hex)) {
      if (hex.toLowerCase() !== value.toLowerCase()) onPick(hex.toLowerCase());
    } else {
      setHex(value);
    }
  };
  return (
    <div className={styles.swatches}>
      {PALETTE.map((colour) => (
        <button
          key={colour}
          type="button"
          className={styles.swatch}
          style={{ background: colour }}
          aria-label={`${describe} ${colour}`}
          aria-pressed={colour.toLowerCase() === value.toLowerCase()}
          onClick={() => {
            setHex(colour);
            onPick(colour);
          }}
        />
      ))}
      <input
        className={`${styles.input} ${styles.hexInput}`}
        aria-label={`${describe} hex`}
        value={hex}
        maxLength={7}
        spellCheck={false}
        onChange={(e) => setHex(e.target.value)}
        onBlur={commitHex}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commitHex();
        }}
      />
    </div>
  );
}

function SubjectRow({ subject, onError }: { subject: Subject; onError: (message: string) => void }) {
  const refresh = useStudyStore((s) => s.refreshSubjects);
  const [name, setName] = useState(subject.name);

  const run = async (work: () => Promise<unknown>): Promise<void> => {
    try {
      await work();
      await refresh();
    } catch (err) {
      console.error('Updating a subject failed', err);
      onError("That change couldn't be saved.");
    }
  };

  const commitName = (): void => {
    const trimmed = name.trim();
    if (trimmed === '') {
      setName(subject.name);
    } else if (trimmed !== subject.name) {
      void run(() => window.studyat.subjects.update(subject.id, { name: trimmed }));
    }
  };

  return (
    <li className={styles.listItem}>
      <span className={styles.dot} style={{ background: subject.colour }} aria-hidden="true" />
      <input
        className={`${styles.input} ${styles.grow}`}
        aria-label={`Name of ${subject.name}`}
        value={name}
        maxLength={80}
        onChange={(e) => setName(e.target.value)}
        onBlur={commitName}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commitName();
        }}
      />
      <ColourPicker
        value={subject.colour}
        describe={`Colour for ${subject.name}`}
        onPick={(colour) => void run(() => window.studyat.subjects.update(subject.id, { colour }))}
      />
      <button
        type="button"
        className={styles.button}
        aria-label={`Archive ${subject.name}`}
        onClick={() => void run(() => window.studyat.subjects.archive(subject.id))}
      >
        Archive
      </button>
    </li>
  );
}

export function SubjectsSection() {
  const subjects = useStudyStore((s) => s.subjects);
  const refresh = useStudyStore((s) => s.refreshSubjects);
  const nameId = useId();
  const [newName, setNewName] = useState('');
  const [newColour, setNewColour] = useState(PALETTE[0] ?? '#7c9cff');
  const [error, setError] = useState('');

  const active = subjects.filter((s) => !s.archived);
  const archived = subjects.filter((s) => s.archived);

  const add = async (): Promise<void> => {
    const trimmed = newName.trim();
    if (trimmed === '') return;
    try {
      await window.studyat.subjects.create({
        name: trimmed,
        colour: newColour,
      });
      await refresh();
      setNewName('');
      setError('');
    } catch (err) {
      console.error('Adding a subject failed', err);
      setError("That subject couldn't be added.");
    }
  };

  return (
    <section aria-labelledby="settings-subjects">
      <h3 id="settings-subjects" className={styles.heading}>
        Subjects
      </h3>
      <form
        className={styles.listItem}
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <label htmlFor={nameId} className={styles.hint}>
          New subject
        </label>
        <input
          id={nameId}
          className={`${styles.input} ${styles.grow}`}
          value={newName}
          maxLength={80}
          placeholder="e.g. Linear Algebra"
          onChange={(e) => setNewName(e.target.value)}
        />
        <ColourPicker value={newColour} describe="New subject colour" onPick={setNewColour} />
        <button
          type="submit"
          className={`${styles.button} ${styles.primary}`}
          disabled={newName.trim() === ''}
        >
          Add
        </button>
      </form>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}

      <ul className={styles.list} aria-label="Subjects">
        {active.map((s) => (
          <SubjectRow key={`${s.id}:${s.name}:${s.colour}`} subject={s} onError={setError} />
        ))}
      </ul>
      {active.length === 0 && <p className={styles.note}>No subjects yet. Add one above.</p>}

      {archived.length > 0 && (
        <>
          <h4 className={styles.subheading}>Archived</h4>
          <ul className={styles.list} aria-label="Archived subjects">
            {archived.map((s) => (
              <li key={s.id} className={styles.listItem}>
                <span className={styles.dot} style={{ background: s.colour }} aria-hidden="true" />
                <span className={styles.grow}>{s.name}</span>
              </li>
            ))}
          </ul>
          <p className={styles.note}>
            Archived subjects keep their study time but can&apos;t be picked for new sessions.
          </p>
        </>
      )}
    </section>
  );
}
