// Stats widgets (v1.2 spec §3.12): up to six stat cards pinned on the study space. A new one
// cascades like a popped note; the repo clamps position and scale.
import { cascadeAt } from '../../core/cascade';
import { LIMIT_COPY, MAX_STAT_WIDGETS } from '../../shared/planner';
import type { StatCard, StatRange, StatWidget, StatWidgetPatch } from '../../shared/types';
import type { Db } from '../db/db';
import { statWidgetsRepo } from '../db/repos/statWidgets';
import { assertBool, assertEnum, IpcValidationError } from './validate';

export const STAT_CARDS: readonly StatCard[] = ['total', 'subjects', 'goal', 'estimates'];
export const STAT_RANGES: readonly StatRange[] = ['today', 'week', 'month'];

export interface StatWidgetsServiceDeps {
  db: Db;
  now: () => number;
}

export type StatWidgetsService = ReturnType<typeof statWidgetsService>;

/** Non-finite numbers never reach the repo (NaN would be stored as NULL). */
function finite(v: unknown, what: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new IpcValidationError(`${what} must be a number`);
  return v;
}

export function statWidgetsService(deps: StatWidgetsServiceDeps) {
  const repo = statWidgetsRepo(deps.db);

  return {
    list: (): StatWidget[] => repo.list(),

    /** A Total time · This week card at the next cascade step. */
    add(): StatWidget {
      const count = repo.count();
      if (count >= MAX_STAT_WIDGETS) throw new IpcValidationError(LIMIT_COPY.statWidgets);
      const { x, y } = cascadeAt(count);
      return repo.create({ card: 'total', range: 'week', x, y }, deps.now());
    },

    update(id: number, patch: StatWidgetPatch): StatWidget | null {
      const clean: StatWidgetPatch = {};
      if (patch.card !== undefined) clean.card = assertEnum(patch.card, STAT_CARDS, 'card');
      if (patch.range !== undefined) clean.range = assertEnum(patch.range, STAT_RANGES, 'range');
      if (patch.x !== undefined) clean.x = finite(patch.x, 'x');
      if (patch.y !== undefined) clean.y = finite(patch.y, 'y');
      if (patch.scale !== undefined) clean.scale = finite(patch.scale, 'scale');
      if (patch.bare !== undefined) clean.bare = assertBool(patch.bare, 'bare');
      return repo.update(id, clean);
    },

    remove(id: number): void {
      repo.remove(id);
    },
  };
}
