import { describe, expect, it } from 'vitest';
import {
  ESTIMATE_PRESETS,
  LIMIT_COPY,
  MAX_LISTS,
  MAX_POPPED_NOTES,
  MAX_STAT_WIDGETS,
  MAX_SUBTASKS,
  MAX_TAGS,
  normaliseTag,
} from './planner';

describe('planner constants', () => {
  it('normaliseTag lower-cases, drops a leading # and applies [a-z0-9-]{1,24}', () => {
    expect(normaliseTag('#Lecture')).toBe('lecture');
    expect(normaliseTag('past-paper')).toBe('past-paper');
    expect(normaliseTag('a'.repeat(25))).toBeNull();
    expect(normaliseTag('two words')).toBeNull();
    expect(normaliseTag('')).toBeNull();
  });
  it('holds the spec limits', () => {
    expect([MAX_LISTS, MAX_POPPED_NOTES, MAX_STAT_WIDGETS, MAX_TAGS, MAX_SUBTASKS]).toEqual([
      20, 12, 6, 8, 30,
    ]);
    expect(ESTIMATE_PRESETS).toEqual([15, 30, 45, 60, 90, 120, 180]);
    expect(LIMIT_COPY.notes).toBe('Up to 12 notes on the screen');
  });
});
