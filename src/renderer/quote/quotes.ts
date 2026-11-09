// The bundled quotations (widgets addendum §4): public-domain lines from authors who died before
// 1955, imported into the renderer bundle so the widget needs no IPC and works offline.
import { daysBetween } from '../../core/time';
import raw from '../../../assets/quotes.json';

export interface Quote {
  text: string;
  author: string;
}

export const QUOTES: readonly Quote[] = raw satisfies readonly Quote[];

/**
 * The quote of a study day: whole days since 1970-01-01, wrapped round the list, so it is the
 * same all day and moves on by one at the rollover.
 */
export function quoteIndexFor(dayKey: string, count: number): number {
  const days = daysBetween('1970-01-01', dayKey);
  return ((days % count) + count) % count;
}
