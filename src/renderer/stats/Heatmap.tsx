// The study calendar (spec §3.5, appplan §4.7): 53 Monday-first week columns, five shades from
// main (SHADE_MINUTES in core is their one source) and a small dot on days that hit the daily
// goal. Hand-written SVG. One tab stop: the arrow keys walk the days (Up/Down a day, Left/Right a
// week) and the line under the grid reads the day out; hovering does the same.
import { type KeyboardEvent, useId, useState } from 'react';
import { SHADE_MINUTES } from '../../core/stats/heatmap';
import type { HeatmapCell } from '../../shared/types';
import { formatHm } from '../shell/format';
import { formatDate, formatDayMonth, monthOf } from './format';
import styles from './stats.module.css';

const CELL = 11;
const GAP = 3;
const STEP = CELL + GAP;
const LEFT = 30;
const TOP = 16;
const DAY_LABELS: [row: number, label: string][] = [
  [0, 'Mon'],
  [2, 'Wed'],
  [4, 'Fri'],
];
const SHADES = [styles.shade0, styles.shade1, styles.shade2, styles.shade3, styles.shade4] as const;

/** The <title> and tooltip text: "2 Nov 2026 · 1h 05m". */
export function cellLabel(cell: HeatmapCell): string {
  return `${formatDate(cell.dayKey)} · ${formatHm(cell.ms)}`;
}

/** Month names over the column where each month's first Monday falls, skipping crowded ones. */
function monthLabels(cells: HeatmapCell[], columns: number): { col: number; label: string }[] {
  const labels: { col: number; label: string }[] = [];
  for (let col = 0; col < columns; col++) {
    const monday = cells[col * 7];
    if (!monday) break;
    const month = monthOf(monday.dayKey);
    const previous = col === 0 ? undefined : cells[(col - 1) * 7];
    if (previous && monthOf(previous.dayKey) === month) continue;
    const last = labels[labels.length - 1];
    if (last && col - last.col < 3) labels.pop();
    labels.push({ col, label: month });
  }
  return labels;
}

/** "Less than 30 min" etc., from the one set of thresholds in core. */
const shadeNames = (): string[] => [
  'No focus time',
  `Under ${SHADE_MINUTES[1]} min`,
  `Under ${SHADE_MINUTES[2] / 60} h`,
  `Under ${SHADE_MINUTES[3] / 60} h`,
  `${SHADE_MINUTES[3] / 60} h or more`,
];

export function Heatmap({ cells }: { cells: HeatmapCell[] }) {
  const [active, setActive] = useState<number | null>(null);
  const tipId = useId();
  const columns = Math.ceil(cells.length / 7);
  const width = LEFT + columns * STEP - GAP;
  const height = TOP + 7 * STEP - GAP;
  const current = active === null ? undefined : cells[active];
  const first = cells[0];
  const last = cells[cells.length - 1];

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const moves: Record<string, number> = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -7, ArrowRight: 7 };
    let next: number | undefined;
    const from = active ?? cells.length - 1;
    if (e.key in moves) next = from + (moves[e.key] ?? 0);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = cells.length - 1;
    if (next === undefined) return;
    e.preventDefault();
    setActive(Math.min(cells.length - 1, Math.max(0, next)));
  };

  return (
    <div className={styles.heatmapFrame}>
      <div
        role="group"
        tabIndex={0}
        aria-label={`Study calendar${first && last ? `, ${formatDayMonth(first.dayKey)} to ${formatDate(last.dayKey)}` : ''}. Use the arrow keys to move between days.`}
        aria-describedby={tipId}
        onKeyDown={onKeyDown}
        onFocus={() => setActive((a) => a ?? cells.length - 1)}
        onBlur={() => setActive(null)}
      >
        <svg
          className={styles.heatmap}
          viewBox={`0 0 ${width} ${height}`}
          width={width}
          height={height}
          aria-hidden="true"
          onMouseLeave={() => setActive(null)}
        >
          {monthLabels(cells, columns).map(({ col, label }) => (
            <text key={`${col}-${label}`} className={styles.heatmapLabel} x={LEFT + col * STEP} y={TOP - 5}>
              {label}
            </text>
          ))}
          {DAY_LABELS.map(([row, label]) => (
            <text key={label} className={styles.heatmapLabel} x={0} y={TOP + row * STEP + CELL - 2}>
              {label}
            </text>
          ))}
          {cells.map((cell, i) => {
            const x = LEFT + Math.floor(i / 7) * STEP;
            const y = TOP + (i % 7) * STEP;
            return (
              <g key={cell.dayKey}>
                <rect
                  data-day={cell.dayKey}
                  data-shade={cell.shade}
                  className={`${styles.cell} ${SHADES[cell.shade]} ${i === active ? styles.cellActive : ''}`}
                  x={x}
                  y={y}
                  width={CELL}
                  height={CELL}
                  rx={2}
                  onMouseEnter={() => setActive(i)}
                >
                  <title>{cellLabel(cell)}</title>
                </rect>
                {cell.goalHit && (
                  <circle
                    data-goal-dot={cell.dayKey}
                    className={cell.shade >= 3 ? styles.goalDot : styles.goalDotLight}
                    cx={x + CELL / 2}
                    cy={y + CELL / 2}
                    r={2}
                  />
                )}
              </g>
            );
          })}
        </svg>
      </div>
      <div className={styles.heatmapFooter}>
        <span id={tipId} className={styles.tip} data-testid="heatmap-tip" aria-live="polite">
          {current ? `${cellLabel(current)}${current.goalHit ? ' · goal hit' : ''}` : 'Hover over a day, or focus the calendar and use the arrow keys.'}
        </span>
        <span className={styles.legend}>
          Less
          {SHADES.map((shade, i) => (
            <span key={shade} className={`${styles.legendSwatch} ${shade}`} title={shadeNames()[i]} />
          ))}
          More
          <span className={styles.legendGoal} aria-hidden="true" />
          Goal hit
        </span>
      </div>
    </div>
  );
}
