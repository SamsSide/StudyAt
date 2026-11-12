// Planner limits, copy and tag rules shared by main and the renderer (v1.2 spec §3, §5).
export const TASK_TITLE_MAX = 500;
export const TASK_NOTE_MAX = 5000;
export const ESTIMATE_MIN = 5;
export const ESTIMATE_MAX = 600;
export const ESTIMATE_PRESETS = [15, 30, 45, 60, 90, 120, 180] as const;
export const TAG_RE = /^[a-z0-9-]{1,24}$/;
export const MAX_TAGS = 8;
export const MAX_SUBTASKS = 30;
export const SUBTASK_TEXT_MAX = 200;
export const LIST_NAME_MAX = 60;
export const MAX_LISTS = 20;
export const REPEAT_EVERY_MIN = 2;
export const REPEAT_EVERY_MAX = 30;
export const REMINDER_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
/** The subject-less list every install starts with; migration v4 seeds the same literal. */
export const INBOX_LIST_NAME = 'Inbox';
export const MAX_POPPED_NOTES = 12;
export const MAX_STAT_WIDGETS = 6;
export const DEADLINE_TITLE_MAX = 120;
export const DEADLINE_NOTE_MAX = 5000;
export const INTENTION_MAX = 140;
export const REVISION_TAG = 'revision';
export const REVISION_PREFIX = 'Revise: ';
export const REVISION_DAYS_MAX = 90;
export const LIMIT_COPY = {
  notes: 'Up to 12 notes on the screen',
  lists: 'Up to 20 lists',
  statWidgets: 'Up to 6 stats widgets',
  tags: 'Up to 8 tags',
  subtasks: 'Up to 30 subtasks',
} as const;
export const TASK_GONE = 'That task no longer exists.';
export const NEXT_FOCUS_NOTE = 'Task set for your next focus.';

/** Lower-cases `raw` (a leading `#` dropped); null unless it matches TAG_RE. */
export function normaliseTag(raw: string): string | null {
  const tag = raw.replace(/^#/, '').toLowerCase();
  return TAG_RE.test(tag) ? tag : null;
}
