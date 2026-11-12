// The four stats widget cards (v1.2 spec §3.12). Each draws data main has already worked out
// (`stats.card`, from the pure functions in src/core/stats/cards.ts), so the numbers have one
// tested source; the cards only format them. All of it is focus-timer time (appplan §5).
import type {
  EstimatesCardData,
  GoalCardData,
  StatRange,
  SubjectsCardData,
  TotalCardData,
} from '../../shared/types';
import { formatGoal, formatHm, goalTooltip } from '../shell/format';
import { GoalRing } from '../shell/GoalRing';
import { formatDayLabel, formatDelta } from '../stats/format';
import styles from './statWidgets.module.css';

/** What each range's change is measured against (spec §3.12: the same elapsed part of it). */
const VERSUS: Record<StatRange, string> = {
  today: 'vs yesterday',
  week: 'vs last week',
  month: 'vs last month',
};

/** "1.3×": a ratio main has already rounded to one decimal place. */
const times = (ratio: number): string => `${ratio.toFixed(1)}×`;

function Streak({ days }: { days: number }) {
  return <p className={styles.streak}>{`🔥 ${days}-day streak`}</p>;
}

/**
 * The range's total, and its change on the previous period. `liveMs` is the focus time accrued
 * since main answered, while a focus segment runs (0 otherwise), which `data` can't hold yet.
 */
export function TotalCard({ data, liveMs }: { data: TotalCardData; liveMs: number }) {
  return (
    <div className={styles.total}>
      <p className={styles.big}>{formatHm(data.totalMs + liveMs)}</p>
      <p className={styles.muted}>
        {data.deltaPct === null
          ? 'Nothing to compare with yet'
          : `${formatDelta(data.deltaPct)} ${VERSUS[data.range]}`}
      </p>
    </div>
  );
}

/** A subject name with its module code ("COMP2221") kept whole; the rest may be cut with an ellipsis. */
function BarName({ name }: { name: string }) {
  const m = /^(\S+)\s+(.+)$/.exec(name);
  if (!m || !/\d/.test(m[1] ?? '')) return <span className={styles.barRest}>{name}</span>;
  return (
    <>
      <span className={styles.barCode}>{m[1]}</span>
      <span className={styles.barRest}>{m[2]}</span>
    </>
  );
}

/** A bar per subject, largest first, "Other" last (main's order), in the subject's colour. */
export function SubjectsCard({ data }: { data: SubjectsCardData }) {
  if (data.bars.length === 0) return <p className={styles.empty}>No focus time in this range yet</p>;
  const largest = Math.max(1, ...data.bars.map((b) => b.ms));
  return (
    <ul className={styles.bars} aria-label="By subject">
      {data.bars.map((b) => (
        <li key={b.key} className={styles.barRow}>
          <span className={styles.barName} title={b.name}>
            <BarName name={b.name} />
          </span>
          <span className={styles.barValue}>{formatGoal(b.ms)}</span>
          <span className={styles.barTrack} aria-hidden="true">
            <span
              className={styles.barFill}
              style={{ width: `${(b.ms / largest) * 100}%`, background: b.colour }}
            />
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Today: the goal ring. Week and Month: the days the goal was hit, a dot per day. */
export function GoalCard({ data }: { data: GoalCardData }) {
  if (data.range === 'today') {
    const progress = data.goalMs > 0 ? data.todayMs / data.goalMs : 0;
    return (
      <div className={styles.goalToday}>
        <span className={styles.bigRing}>
          <GoalRing progress={progress} title={goalTooltip(data.todayMs, data.goalMs)} />
        </span>
        <div>
          <p className={styles.muted}>{goalTooltip(data.todayMs, data.goalMs)}</p>
          <Streak days={data.streak} />
        </div>
      </div>
    );
  }
  return (
    <div className={styles.goalRange}>
      <p className={styles.goalLine}>{`Goal hit ${data.hitDays} of ${data.elapsedDays} days`}</p>
      <ul className={styles.dots} aria-label="Goal by day" data-range={data.range}>
        {data.days.map((d) => {
          const state = d.future ? 'future' : d.hit ? 'hit' : 'missed';
          const said = d.future ? 'still to come' : d.hit ? 'goal hit' : 'goal missed';
          return (
            <li
              key={d.dayKey}
              className={styles.dot}
              data-state={state}
              aria-label={`${formatDayLabel(d.dayKey)}: ${said}`}
              title={`${formatDayLabel(d.dayKey)}: ${said}`}
            />
          );
        })}
      </ul>
      <Streak days={data.streak} />
    </div>
  );
}

/** Planned against focused for done, estimated tasks; the biggest over-runs; a ratio per subject. */
export function EstimatesCard({ data }: { data: EstimatesCardData }) {
  if (data.tasks === 0) return <p className={styles.empty}>No estimated tasks yet</p>;
  return (
    <div className={styles.estimates}>
      <p className={styles.muted}>
        {`Planned ${formatGoal(data.plannedMs)} · Focused ${formatGoal(data.focusedMs)}`}
      </p>
      {data.ratio !== null && (
        <p className={styles.ratio}>{`Tasks took ${times(data.ratio)} your estimates`}</p>
      )}
      {data.overruns.length > 0 && (
        <>
          <h4 className={styles.subhead}>Biggest over-runs</h4>
          <ul className={styles.lines}>
            {data.overruns.map((o) => (
              <li key={o.taskId} className={styles.line}>
                <span className={styles.lineName}>{o.title}</span>
                <span className={styles.lineValue}>
                  {`${formatGoal(o.actualMs)} of ${formatGoal(o.estimateMs)}`}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {data.bySubject.length > 0 && (
        <ul className={styles.lines} aria-label="By subject">
          {data.bySubject.map((s) => (
            <li key={s.subjectId ?? 'none'} className={styles.line}>
              {`${s.label} · ${times(s.ratio)}`}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
