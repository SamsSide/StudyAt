// Shared look for the Stats charts (spec §4 visual direction) and the subject colour lookup: chart
// colours are the subjects' own, untagged time is NO_SUBJECT_COLOUR grey (spec §3.5).
import { NO_SUBJECT_COLOUR, NO_SUBJECT_KEY, NO_SUBJECT_NAME } from '../../core/stats/totals';
import type { Subject } from '../../shared/types';

export const AXIS_TICK = { fill: '#a9afbd', fontSize: 12 } as const;
export const GRID_STROKE = 'rgba(255, 255, 255, 0.08)';
export const CURSOR_FILL = 'rgba(255, 255, 255, 0.05)';
export const ACCENT = '#7c9cff';
export const CHART_HEIGHT = 200;
/** What ResponsiveContainer draws before it has measured its box. */
export const INITIAL_SIZE = { width: 480, height: CHART_HEIGHT } as const;

export function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export interface SubjectLook {
  key: string;
  name: string;
  colour: string;
  sort: number;
}

/**
 * Name and colour for a `bySubject` key (`String(subjectId)`, or NO_SUBJECT_KEY). A subject main
 * knows but the store doesn't yet falls back to the untagged grey rather than disappearing.
 */
export function subjectLook(key: string, subjects: Subject[]): SubjectLook {
  if (key === NO_SUBJECT_KEY) return { key, name: NO_SUBJECT_NAME, colour: NO_SUBJECT_COLOUR, sort: Infinity };
  const subject = subjects.find((s) => String(s.id) === key);
  return subject
    ? { key, name: subject.name, colour: subject.colour, sort: subject.sort }
    : { key, name: 'Subject', colour: NO_SUBJECT_COLOUR, sort: Number.MAX_SAFE_INTEGER };
}

/** The colour for a subject id (null is untagged). */
export function subjectColour(subjectId: number | null, subjects: Subject[]): string {
  return subjectLook(subjectId === null ? NO_SUBJECT_KEY : String(subjectId), subjects).colour;
}
