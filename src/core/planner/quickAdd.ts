import { ESTIMATE_MAX, ESTIMATE_MIN, MAX_TAGS, normaliseTag } from '../../shared/planner';

export interface QuickAdd {
  title: string;
  tags: string[];
  estimateMin: number | null;
  subjectId: number | null;
}

const ESTIMATE_RE = /^~(?:(\d+)h)?(?:(\d+)m)?$/;

/** Minutes for a `~1h30m` token; null unless it is well formed and within 5-600. */
function parseEstimate(token: string): number | null {
  const m = ESTIMATE_RE.exec(token);
  if (!m || (m[1] === undefined && m[2] === undefined)) return null;
  const min = Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0);
  return min >= ESTIMATE_MIN && min <= ESTIMATE_MAX ? min : null;
}

/**
 * Spec §3.6: `#tag` → tag; `~45m` / `~1h` / `~1h30m` / `~90m` → estimate; `@text` → the first
 * subject (in the order given, archived skipped) whose name contains `text`, case-insensitive.
 * Recognised tokens leave the title; an unmatched `@text`, an invalid tag, a ninth tag, a second
 * `@` match and an estimate outside 5–600 min stay in it. Whitespace collapses to single spaces.
 */
export function parseQuickAdd(
  input: string,
  subjects: readonly { id: number; name: string; archived: boolean }[],
): QuickAdd {
  const tags: string[] = [];
  let estimateMin: number | null = null;
  let subjectId: number | null = null;
  const kept: string[] = [];

  for (const token of input.split(/\s+/).filter((t) => t !== '')) {
    if (token.startsWith('#')) {
      const tag = normaliseTag(token);
      if (tag !== null && tags.includes(tag)) continue;
      if (tag !== null && tags.length < MAX_TAGS) {
        tags.push(tag);
        continue;
      }
    } else if (token.startsWith('~') && estimateMin === null) {
      const min = parseEstimate(token);
      if (min !== null) {
        estimateMin = min;
        continue;
      }
    } else if (token.startsWith('@') && subjectId === null && token.length > 1) {
      const needle = token.slice(1).toLowerCase();
      const hit = subjects.find((s) => !s.archived && s.name.toLowerCase().includes(needle));
      if (hit) {
        subjectId = hit.id;
        continue;
      }
    }
    kept.push(token);
  }

  return { title: kept.join(' '), tags, estimateMin, subjectId };
}
