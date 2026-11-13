// Deadlines (v1.2 spec §3.10): exams and coursework with a local wall-clock due time. Validation
// lives here; the repo stores what it is given. "Today" is the calendar date, not the study day:
// a deadline due earlier today is still upcoming (the widget shows "Due").
import { calendarDate } from '../../core/wallclock';
import { DEADLINE_NOTE_MAX, DEADLINE_TITLE_MAX } from '../../shared/limits';
import type { Deadline, DeadlineInput, DeadlineKind, DeadlinePatch, DeadlinesView } from '../../shared/types';
import type { Db } from '../db/db';
import { deadlinesRepo } from '../db/repos/deadlines';
import { subjectsRepo } from '../db/repos/subjects';
import { assertBool, assertDayKey, assertEnum, assertIntOrNull, assertStr, IpcValidationError } from './validate';

/** The past list shows this many. */
const PAST_LIMIT = 10;
const KINDS: readonly DeadlineKind[] = ['exam', 'coursework'];
const DUE_RE = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):[0-5]\d$/;

export interface DeadlinesServiceDeps {
  db: Db;
  now: () => number;
}

export type DeadlinesService = ReturnType<typeof deadlinesService>;

function assertDue(v: unknown): string {
  const s = assertStr(v, 'due', { max: 16 });
  const m = DUE_RE.exec(s);
  if (!m) throw new IpcValidationError('due must be a YYYY-MM-DDTHH:MM time');
  assertDayKey(m[1], 'due');
  // assertDayKey parses with Date.parse, which rolls 02-30 over to 03-02; round-trip the parts.
  const [y, mo, d] = m[1]!.split('-').map(Number) as [number, number, number];
  const dt = new Date(y, mo - 1, d, Number(m[2]), Number(s.slice(14)));
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) {
    throw new IpcValidationError('due is not a real date');
  }
  return s;
}

export function deadlinesService(deps: DeadlinesServiceDeps) {
  const repo = deadlinesRepo(deps.db);
  const subjects = subjectsRepo(deps.db);

  const assertSubject = (v: unknown): number | null => {
    const id = assertIntOrNull(v, 'subjectId');
    if (id !== null && !subjects.list().some((s) => s.id === id)) throw new IpcValidationError('No such subject');
    return id;
  };
  const title = (v: unknown): string => assertStr(v, 'title', { max: DEADLINE_TITLE_MAX, nonEmpty: true }).trim();

  const startOfToday = (): string => `${calendarDate(deps.now())}T00:00`;
  const isUpcoming = (d: Deadline, from: string): boolean => !d.done && d.due >= from;

  const list = (past: boolean): Deadline[] => {
    const from = startOfToday();
    const all = repo.all();
    if (!past) return all.filter((d) => isUpcoming(d, from));
    return all
      .filter((d) => !isUpcoming(d, from))
      .sort((a, b) => (a.due < b.due ? 1 : a.due > b.due ? -1 : b.id - a.id))
      .slice(0, PAST_LIMIT);
  };
  const view = (): DeadlinesView => ({ upcoming: list(false), past: list(true) });

  return {
    list,
    view,

    create(input: DeadlineInput): DeadlinesView {
      const row = {
        title: title(input.title),
        kind: assertEnum(input.kind, KINDS, 'kind'),
        subjectId: assertSubject(input.subjectId),
        due: assertDue(input.due),
        note: input.note === undefined ? '' : assertStr(input.note, 'note', { max: DEADLINE_NOTE_MAX }),
      };
      repo.create(row, deps.now());
      return view();
    },

    update(id: number, patch: DeadlinePatch): DeadlinesView {
      const clean: Parameters<typeof repo.update>[1] = {};
      if (patch.title !== undefined) clean.title = title(patch.title);
      if (patch.kind !== undefined) clean.kind = assertEnum(patch.kind, KINDS, 'kind');
      if (patch.subjectId !== undefined) clean.subjectId = assertSubject(patch.subjectId);
      if (patch.due !== undefined) clean.due = assertDue(patch.due);
      if (patch.note !== undefined) clean.note = assertStr(patch.note, 'note', { max: DEADLINE_NOTE_MAX });
      if (patch.done !== undefined) clean.done = assertBool(patch.done, 'done');
      if (!repo.update(id, clean, deps.now())) throw new IpcValidationError('No such deadline');
      return view();
    },

    remove(id: number): DeadlinesView {
      if (!repo.remove(id)) throw new IpcValidationError('No such deadline');
      return view();
    },
  };
}
