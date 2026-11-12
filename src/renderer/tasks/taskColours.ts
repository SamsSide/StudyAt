import type { TaskColour } from '../../shared/types';

/** The six colours in picker order; yellow is the default (spec §3.10). They serve notes and planner rows. */
export const TASK_COLOURS: readonly { id: TaskColour; label: string }[] = [
  { id: 'yellow', label: 'Yellow' },
  { id: 'pink', label: 'Pink' },
  { id: 'blue', label: 'Blue' },
  { id: 'green', label: 'Green' },
  { id: 'purple', label: 'Purple' },
  { id: 'grey', label: 'Grey' },
];

export const DEFAULT_TASK_COLOUR: TaskColour = 'yellow';

/** Spec §3.10: task text is at most 500 characters. */
export const MAX_TASK_LENGTH = 500;

export const clampTaskText = (text: string): string => text.trim().slice(0, MAX_TASK_LENGTH);
