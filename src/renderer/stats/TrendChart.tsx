// "Last 12 weeks" (spec §3.5, §4): total focus time per Monday-to-Sunday week, oldest first, this
// (partial) week last. The totals are main's `stats.trend()`.
import { useId } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { TrendPoint } from '../../shared/types';
import { formatHm } from '../shell/format';
import { ACCENT, AXIS_TICK, CHART_HEIGHT, GRID_STROKE, INITIAL_SIZE, prefersReducedMotion } from './chartTheme';
import { formatDayMonth, formatWeekRange, toHours } from './format';
import { LoadError } from './LoadError';
import { Skeleton } from './Skeleton';
import styles from './stats.module.css';
import { useStatsQuery } from './useStatsQuery';

const loadTrend = (): Promise<TrendPoint[]> => window.studyat.stats.trend();

interface Row {
  label: string;
  hours: number;
  point: TrendPoint;
}

export function TrendChart({ revision, className }: { revision: number; className?: string }) {
  const titleId = useId();
  const query = useStatsQuery(loadTrend, undefined, revision);
  const points = query.status === 'ready' ? query.data : null;
  const rows: Row[] = (points ?? []).map((point) => ({ label: formatDayMonth(point.weekStart), hours: toHours(point.ms), point }));
  const summary = `Last 12 weeks, week by week: ${rows.map((r) => `${r.label} ${formatHm(r.point.ms)}`).join(', ')}`;

  return (
    <section className={className} aria-labelledby={titleId} aria-busy={query.status === 'loading'}>
      <div className={styles.sectionHeader}>
        <h3 id={titleId} className={styles.sectionTitle}>
          Last 12 weeks
        </h3>
      </div>
      {query.status === 'loading' && <Skeleton kind="chart" />}
      {query.status === 'error' && <LoadError message="Couldn’t load the trend." onRetry={query.reload} />}
      {points && (
        <div className={styles.chart} role="img" aria-label={summary}>
          <ResponsiveContainer width="100%" height={CHART_HEIGHT} initialDimension={INITIAL_SIZE}>
            <AreaChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
              <defs>
                <linearGradient id="stats-trend-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={ACCENT} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={ACCENT} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke={GRID_STROKE} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tick={AXIS_TICK} interval="preserveStartEnd" minTickGap={16} />
              <YAxis tickLine={false} axisLine={false} tick={AXIS_TICK} allowDecimals={false} tickFormatter={(h: number) => `${h}h`} />
              <Tooltip
                isAnimationActive={false}
                cursor={{ stroke: GRID_STROKE }}
                content={({ active, payload }) => {
                  const row = payload?.[0]?.payload as Row | undefined;
                  return active && row ? (
                    <div className={styles.chartTooltip}>
                      <p>
                        <strong>{formatWeekRange(row.point.weekStart)}</strong> · {formatHm(row.point.ms)}
                      </p>
                    </div>
                  ) : null;
                }}
              />
              <Area
                type="monotone"
                dataKey="hours"
                stroke={ACCENT}
                strokeWidth={2}
                fill="url(#stats-trend-fill)"
                dot={{ r: 2.5, fill: ACCENT, strokeWidth: 0 }}
                activeDot={{ r: 4 }}
                isAnimationActive={!prefersReducedMotion()}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
