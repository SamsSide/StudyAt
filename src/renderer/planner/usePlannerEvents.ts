// What keeps the planner honest while it sits in the background (v1.2 spec §3.8): a reminder click
// opens the task, main's own changes and the end of a focus segment refetch, and so does each whole
// focus minute (the actuals on rows). Mounted once, in App.
import { useEffect } from 'react';
import { useStudyStore } from '../shell/store';
import { usePlannerStore } from './plannerStore';

export function usePlannerEvents(): void {
  useEffect(() => {
    const api = window.studyat;
    const reload = (): void => void usePlannerStore.getState().reload();
    let minute = Math.floor(useStudyStore.getState().timer.todayFocusMs / 60_000);
    const stops = [
      api.planner.onOpenTask((taskId) => {
        void useStudyStore.getState().patchWidget('tasks', { open: true });
        usePlannerStore.getState().openDetail(taskId);
        reload();
      }),
      api.planner.onChanged(reload),
      api.timer.onSegmentEnd(reload),
      api.timer.onState((state) => {
        const now = Math.floor(state.todayFocusMs / 60_000);
        if (now === minute) return;
        minute = now;
        reload();
      }),
    ];
    return () => {
      for (const stop of stops) stop();
    };
  }, []);
}
