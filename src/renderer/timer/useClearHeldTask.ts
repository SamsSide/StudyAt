// Spec §3.3: the timer keeps a ticked-off or deleted task until the segment ends; then it goes.
// Mounted once from the shell, so it works whether or not the timer widget is open.
import { useEffect } from 'react';
import { useStudyStore } from '../shell/store';

export function useClearHeldTask(): void {
  useEffect(
    () =>
      window.studyat.timer.onSegmentEnd(() => {
        const held = useStudyStore.getState().timer.taskId;
        if (held === null) return;
        window.studyat.tasks
          .list()
          .then((tasks) => {
            const task = tasks.find((t) => t.id === held);
            if (!task || task.done) void window.studyat.timer.setTask(null);
          })
          .catch(() => undefined);
      }),
    [],
  );
}
