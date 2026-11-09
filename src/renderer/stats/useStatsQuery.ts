// Loads one Stats section from main and reloads it when its argument (a range, a week) or the
// overlay's revision changes (a session was edited or deleted). `load` should be a module-level
// function so it is stable, and `arg` a primitive. A slower earlier answer never overwrites a
// newer one. Data is only ever shown for the argument it was loaded for: while a new range or
// week loads the query is 'loading', not the old answer. A revision reload keeps the current
// answer on screen until the fresh one lands, so an edit doesn't flash the section empty.
import { useCallback, useEffect, useState } from 'react';
import { logIpcError } from '../lib/ipcError';

export type Query<T> = { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: T };

/** A Query plus `reload()`, which asks main again for the same argument (the "Try again" button). */
export type StatsQuery<T> = Query<T> & { reload: () => void };

export function useStatsQuery<T, A>(load: (arg: A) => Promise<T>, arg: A, revision: number): StatsQuery<T> {
  const [answer, setAnswer] = useState<{ arg: A; query: Query<T> }>({ arg, query: { status: 'loading' } });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    load(arg).then(
      (data) => {
        if (current) setAnswer({ arg, query: { status: 'ready', data } });
      },
      (err: unknown) => {
        logIpcError('Loading a stats section failed', err);
        if (current) setAnswer({ arg, query: { status: 'error' } });
      },
    );
    return () => {
      current = false;
    };
  }, [load, arg, revision, attempt]);

  const reload = useCallback((): void => {
    setAnswer((a) => ({ arg: a.arg, query: { status: 'loading' } }));
    setAttempt((n) => n + 1);
  }, []);

  const query: Query<T> = Object.is(answer.arg, arg) ? answer.query : { status: 'loading' };
  return { ...query, reload };
}
