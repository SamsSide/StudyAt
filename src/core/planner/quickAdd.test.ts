import { describe, expect, it } from 'vitest';
import { SEED_SUBJECTS } from '../../shared/subjects';
import { parseQuickAdd } from './quickAdd';

const subjects = SEED_SUBJECTS.map((s, i) => ({ id: i + 1, name: s.name, archived: false }));

describe('parseQuickAdd', () => {
  it('parses the spec example', () => {
    expect(parseQuickAdd('Lecture 5 notes #lecture ~1h @2221', subjects))
      .toEqual({ title: 'Lecture 5 notes', tags: ['lecture'], estimateMin: 60, subjectId: 3 });
  });
  it.each([['~45m', 45], ['~1h', 60], ['~1h30m', 90], ['~90m', 90]])('estimate %s -> %d', (tok, min) => {
    expect(parseQuickAdd(`Read ${tok}`, subjects)).toMatchObject({ title: 'Read', estimateMin: min });
  });
  it('leaves an unmatched @text in the title', () => {
    expect(parseQuickAdd('Call @mum', subjects)).toEqual({ title: 'Call @mum', tags: [], estimateMin: null, subjectId: null });
  });
  it('matches @ case-insensitively on any part of the name', () => {
    expect(parseQuickAdd('Essay @paradigms', subjects).subjectId).toBe(3);
    expect(parseQuickAdd('Essay @PARADIGMS', subjects).subjectId).toBe(3);
  });
  it('lower-cases tags, keeps at most 8 and leaves bad ones in the title', () => {
    const r = parseQuickAdd('T #A #b #c #d #e #f #g #h #i #bad_tag', subjects);
    expect(r.tags).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
    expect(r.title).toBe('T #i #bad_tag');
  });
  it('keeps a duplicate tag once and removes it from the title', () => {
    const r = parseQuickAdd('T #a #A', subjects);
    expect(r.tags).toEqual(['a']);
    expect(r.title).toBe('T');
  });
  it('keeps an estimate outside 5-600 in the title', () => {
    expect(parseQuickAdd('Nap ~2m', subjects)).toMatchObject({ title: 'Nap ~2m', estimateMin: null });
    expect(parseQuickAdd('Marathon ~11h', subjects)).toMatchObject({ title: 'Marathon ~11h', estimateMin: null });
    expect(parseQuickAdd('Edge ~5m', subjects).estimateMin).toBe(5);
    expect(parseQuickAdd('Edge ~10h', subjects).estimateMin).toBe(600);
  });
  it('keeps malformed estimates in the title', () => {
    expect(parseQuickAdd('A ~ ~h ~30 ~1x', subjects)).toMatchObject({ title: 'A ~ ~h ~30 ~1x', estimateMin: null });
  });
  it('keeps a second @ match and a second estimate in the title', () => {
    const r = parseQuickAdd('x @2221 @2181 ~30m ~45m', subjects);
    expect(r).toMatchObject({ title: 'x @2181 ~45m', subjectId: 3, estimateMin: 30 });
  });
  it('skips archived subjects', () => {
    const withArchived = [{ id: 9, name: 'COMP2221 old', archived: true }, ...subjects];
    expect(parseQuickAdd('x @2221', withArchived).subjectId).toBe(3);
  });
  it('takes the first subject in the order given', () => {
    expect(parseQuickAdd('x @comp22', subjects).subjectId).toBe(2);
  });
  it('returns an empty title when only tokens were typed', () => {
    expect(parseQuickAdd('#lecture ~1h', subjects).title).toBe('');
  });
  it('collapses whitespace', () => {
    expect(parseQuickAdd('  a   b \t #t  c ', subjects)).toMatchObject({ title: 'a b c', tags: ['t'] });
  });
});
