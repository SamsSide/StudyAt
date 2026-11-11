import type { DeadlineKind } from '../shared/types';

export const DEADLINE_DEFAULT_TIME: Record<DeadlineKind, string> = { exam: '09:00', coursework: '12:00' };

/** ≥ 48 h "23d 4h"; < 48 h "31h 12m"; < 1 h "42m 08s"; due or past "Due" (spec §3.10). */
export function formatCountdown(dueMs: number, now: number): string {
  const diff = dueMs - now;
  if (Number.isNaN(diff)) return '—';
  if (diff <= 0) return 'Due';
  const mins = Math.floor(diff / 60_000);
  const hours = Math.floor(mins / 60);
  if (hours >= 48) return `${Math.floor(hours / 24)}d ${hours % 24}h`;
  if (hours >= 1) return `${hours}h ${mins % 60}m`;
  return `${mins}m ${String(Math.floor(diff / 1000) % 60).padStart(2, '0')}s`;
}
