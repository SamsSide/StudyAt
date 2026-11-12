// The Tasks widget body (v1.2 spec §3.7): tabs, a filter, a status line and the view. The shell's
// WidgetFrame supplies the glass, the title and the drag header. Day and Week rows drag between days.
import { useId } from 'react';
import { DayView } from './DayView';
import { PlannerDnd } from './dnd';
import { FilterButton } from './FilterButton';
import { ListsView } from './ListsView';
import { usePlannerStore, type PlannerTab } from './plannerStore';
import { WeekView } from './WeekView';
import styles from './planner.module.css';

const TABS: readonly { id: PlannerTab; label: string }[] = [
  { id: 'day', label: 'Day' },
  { id: 'week', label: 'Week' },
  { id: 'lists', label: 'Lists' },
];

export function PlannerWidget() {
  const tab = usePlannerStore((s) => s.tab);
  const setTab = usePlannerStore((s) => s.setTab);
  const notice = usePlannerStore((s) => s.notice);
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
        <FilterButton />
      </div>
      <p role="status" aria-label="Task notice" className={styles.notice}>
        {notice}
      </p>
      <div role="tabpanel" id={panelId} aria-labelledby={`${panelId}-${tab}`}>
        <PlannerDnd>
          {tab === 'lists' ? <ListsView /> : tab === 'week' ? <WeekView /> : <DayView />}
        </PlannerDnd>
      </div>
    </div>
  );
}
