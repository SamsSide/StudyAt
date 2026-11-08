// "This week" (spec §3.5, §4): Monday-to-Sunday bars of focus time, stacked by subject in the
// subjects' colours with untagged time grey and on top. ‹ › step a week at a time through
// `stats.week(weekStart)`; › stops at the current week, which is whatever `stats.week()` with no
// argument answers. Day totals and per-subject splits are main's; this only draws them.
import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { addDays } from '../../core/time';
import type { DayTotal, WeekBars } from '../../shared/types';
import { formatHm } from '../shell/format';
import { useStudyStore } from '../shell/store';
import {
  AXIS_TICK,
  CHART_HEIGHT,
  CURSOR_FILL,
  GRID_STROKE,
  INITIAL_SIZE,
  prefersReducedMotion,
  type SubjectLook,
  subjectLook,
} from './chartTheme';
import { formatDayLabel, formatWeekRange, formatWeekday, toHours } from './format';
import styles from './stats.module.css';
import { useStatsQuery } from './useStatsQuery';

const loadWeek = (weekStart: string | undefined): Promise<WeekBars> => window.studyat.stats.week(weekStart);

type Row = { label: string; day: DayTotal } & Record<string, number | string | DayTotal>;

/** Every subject with time this week, in the subjects' own order, untagged last. */
function seriesFor(bars: WeekBars, look: (key: string) => SubjectLook): SubjectLook[] {
  const keys = new Set<string>();
  for (const day of bars.days) {
    for (const [key, ms] of Object.entries(day.bySubject)) if (ms > 0) keys.add(key);
  }
  return [...keys].map(look).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
}

function DayTooltip({ day, series }: { day: DayTotal; series: SubjectLook[] }) {
  return (
    <div className={styles.chartTooltip}>
      <p>
        <strong>{formatDayLabel(day.dayKey)}</strong> · {formatHm(day.ms)}
      </p>
      {series
        .filter((s) => (day.bySubject[s.key] ?? 0) > 0)
        .map((s) => (
          <p key={s.key} className={styles.chartTooltipRow}>
            <span className={styles.dot} style={{ background: s.colour }} />
            <span>{s.name}</span>
            <span>{formatHm(day.bySubject[s.key] ?? 0)}</span>
          </p>
        ))}
    </div>
  );
}

export function WeekChart({ revision }: { revision: number }) {
  const subjects = useStudyStore((s) => s.subjects);
  // undefined asks main for the current week.
  const [requested, setRequested] = useState<string | undefined>(undefined);
  const [currentWeek, setCurrentWeek] = useState<string | null>(null);
  const query = useStatsQuery(loadWeek, requested, revision);

  const bars = query.status === 'ready' ? query.data : null;
  if (bars && requested === undefined && currentWeek !== bars.weekStart) setCurrentWeek(bars.weekStart);

  const shown = bars?.weekStart;
  const atCurrent = shown === undefined || shown === currentWeek;
  const step = (days: number): void => {
    if (!shown) return;
    const next = addDays(shown, days);
    setRequested(next === currentWeek ? currentWeek : next);
  };

  const series = bars ? seriesFor(bars, (key) => subjectLook(key, subjects)) : [];
  const rows: Row[] = (bars?.days ?? []).map((day) => {
    const row: Row = { label: formatWeekday(day.dayKey), day };
    for (const s of series) row[s.key] = toHours(day.bySubject[s.key] ?? 0);
    return row;
  });
  const summary = bars
    ? `Focus time, ${formatWeekRange(bars.weekStart)}: ${bars.days.map((d) => `${formatWeekday(d.dayKey)} ${formatHm(d.ms)}`).join(', ')}`
    : '';
  const animate = !prefersReducedMotion();

  return (
    <>
      <div className={styles.sectionHeader}>
        <h3 className={styles.sectionTitle}>This week</h3>
        <div className={styles.weekNav}>
          <button type="button" className={styles.iconButton} aria-label="Previous week" disabled={!shown} onClick={() => step(-7)}>
            ‹
          </button>
          <span aria-live="polite">{shown ? formatWeekRange(shown) : ''}</span>
          <button type="button" className={styles.iconButton} aria-label="Next week" disabled={atCurrent} onClick={() => step(7)}>
            ›
          </button>
        </div>
      </div>
      {query.status === 'error' && <p className={styles.empty}>Couldn’t load this week.</p>}
      {bars && (
        <>
          <div className={styles.chart} role="img" aria-label={summary}>
            <ResponsiveContainer width="100%" height={CHART_HEIGHT} initialDimension={INITIAL_SIZE}>
              <BarChart data={rows} margin={{ top: 8, right: 4, bottom: 0, left: -18 }}>
                <CartesianGrid vertical={false} stroke={GRID_STROKE} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tick={AXIS_TICK} />
                <YAxis tickLine={false} axisLine={false} tick={AXIS_TICK} allowDecimals={false} tickFormatter={(h: number) => `${h}h`} />
                <Tooltip
                  cursor={{ fill: CURSOR_FILL }}
                  isAnimationActive={false}
                  content={({ active, payload }) => {
                    const row = payload?.[0]?.payload as Row | undefined;
                    return active && row ? <DayTooltip day={row.day} series={series} /> : null;
                  }}
                />
                {series.map((s) => (
                  <Bar key={s.key} dataKey={s.key} name={s.name} stackId="week" fill={s.colour} isAnimationActive={animate} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
          {series.length > 0 ? (
            <ul className={styles.chartLegend} aria-label="Subjects this week">
              {series.map((s) => (
                <li key={s.key}>
                  <span className={styles.dot} style={{ background: s.colour }} data-colour={s.colour} aria-hidden="true" />
                  {s.name}
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.muted}>{atCurrent ? 'No focus time this week yet.' : 'No focus time that week.'}</p>
          )}
        </>
      )}
    </>
  );
}
