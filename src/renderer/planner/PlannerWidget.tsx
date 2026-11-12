// The Tasks widget body (v1.2 spec §3.7): tabs, a filter, a status line and the view. The shell's
// WidgetFrame supplies the glass, the title and the drag header. Week arrives with the board.
import { useId, useState } from 'react';
import { useStudyStore } from '../shell/store';
import { DayView } from './DayView';
import { ListsView } from './ListsView';
import { usePlannerStore, type PlannerTab } from './plannerStore';
import styles from './planner.module.css';

const TABS: readonly { id: PlannerTab; label: string }[] = [
  { id: 'day', label: 'Day' },
  { id: 'lists', label: 'Lists' },
];

function FilterBar() {
  const subjects = useStudyStore((s) => s.subjects);
  const filter = usePlannerStore((s) => s.filter);
  const setFilter = usePlannerStore((s) => s.setFilter);
  const tags = usePlannerStore((s) => {
    const all = new Set<string>();
    for (const t of Object.values(s.tasks)) for (const tag of t.tags) all.add(tag);
    return [...all].sort().join(' ');
  });
  return (
    <div className={styles.filterBar}>
      <select
        className={styles.select}
        aria-label="Filter by subject"
        value={filter.subjectId ?? ''}
        onChange={(e) =>
          setFilter({ ...filter, subjectId: e.target.value === '' ? null : Number(e.target.value) })
        }
      >
        <option value="">Any subject</option>
        {subjects
          .filter((s) => !s.archived)
          .map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
      </select>
      <select
        className={styles.select}
        aria-label="Filter by tag"
        value={filter.tag ?? ''}
        onChange={(e) => setFilter({ ...filter, tag: e.target.value === '' ? null : e.target.value })}
      >
        <option value="">Any tag</option>
        {tags === ''
          ? null
          : tags.split(' ').map((t) => (
              <option key={t} value={t}>
                #{t}
              </option>
            ))}
      </select>
    </div>
  );
}

export function PlannerWidget() {
  const tab = usePlannerStore((s) => s.tab);
  const setTab = usePlannerStore((s) => s.setTab);
  const notice = usePlannerStore((s) => s.notice);
  const filtered = usePlannerStore((s) => s.filter.subjectId !== null || s.filter.tag !== null);
  const [filterOpen, setFilterOpen] = useState(false);
  const panelId = useId();

  return (
    <div className={styles.widget}>
      <div className={styles.head}>
        <div role="tablist" aria-label="Tasks view" className={styles.tabs}>
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`${panelId}-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={panelId}
              className={styles.tab}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className={styles.textButton}
          aria-expanded={filterOpen}
          data-active={filtered ? 'true' : undefined}
          onClick={() => setFilterOpen((o) => !o)}
        >
          Filter
        </button>
      </div>
      {filterOpen && <FilterBar />}
      <p role="status" className={styles.notice}>
        {notice}
      </p>
      <div role="tabpanel" id={panelId} aria-labelledby={`${panelId}-${tab}`}>
        {tab === 'lists' ? <ListsView /> : <DayView />}
      </div>
    </div>
  );
}
