// Limits and copy shared by main and the renderer (simple-tasks spec §3.3).
export const MAX_POPPED_NOTES = 12;
export const MAX_STAT_WIDGETS = 6;
export const DEADLINE_TITLE_MAX = 120;
export const DEADLINE_NOTE_MAX = 5000;
export const INTENTION_MAX = 140;
export const TASK_GONE = 'That task no longer exists.';
export const NEXT_FOCUS_NOTE = 'Task set for your next focus.';
export const LIMIT_COPY = {
  notes: 'Up to 12 notes on the screen',
  statWidgets: 'Up to 6 stats widgets',
} as const;
