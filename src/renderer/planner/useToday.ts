// The planner's "today", kept current while the widget stays open: a slow tick re-reads the clock,
// so the label, the loaded day and quick add follow the study-day rollover (appplan §6).
import { useEffect, useState } from 'react';
import { plannerToday } from './format';

const TICK_MS = 30_000;

export function useToday(rolloverHour: number): string {
  const [today, setToday] = useState(() => plannerToday(rolloverHour));
  useEffect(() => {
    const sync = (): void => setToday(plannerToday(rolloverHour));
    sync();
    const id = setInterval(sync, TICK_MS);
    return () => clearInterval(id);
  }, [rolloverHour]);
  return today;
}
