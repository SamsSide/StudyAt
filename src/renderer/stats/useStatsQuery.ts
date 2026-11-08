// Loads one Stats section from main and reloads it when its argument (a range, a week) or the
// overlay's revision changes (a session was edited or deleted). `load` should be a module-level
// function so it is stable, and `arg` a primitive. A slower earlier answer never overwrites a
// newer one.
import { useEffect, useState } from 'react';

export type Query<T> = { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: T };

export function useStatsQuery<T, A>(load: (arg: A) => Promise<T>, arg: A, revision: number): Query<T> {
  const [query, setQuery] = useState<Query<T>>({ status: 'loading' });

  useEffect(() => {
    let current = true;
    load(arg).then(
      (data) => {
        if (current) setQuery({ status: 'ready', data });
      },
      () => {
        if (current) setQuery({ status: 'error' });
      },
    );
    return () => {
      current = false;
    };
  }, [load, arg, revision]);

  return query;
}
