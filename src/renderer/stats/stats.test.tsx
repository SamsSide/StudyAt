import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  HeatmapCell,
  Session,
  StatsOverview,
  SubjectTotal,
  WeekBars,
  WeeklyRecap,
} from '../../shared/types';
import { NO_SUBJECT_KEY } from '../../core/stats/totals';
import { addDays } from '../../core/time';
import { useWindowVisibility } from '../spaces/windowVisibility';
import { resetStudyStore, useStudyStore } from '../shell/store';
import { installMockApi, mockApi, seedSubjects, type MockApi } from '../test/mockApi';
import { formatDayMonth, formatDelta, recapTitle } from './format';
import { Heatmap } from './Heatmap';
import { RecapCard } from './RecapCard';
import { RecapList } from './RecapList';
import { SessionsTable } from './SessionsTable';
import { StatsOverlay } from './StatsOverlay';
import { SubjectBreakdown } from './SubjectBreakdown';
import { Tiles } from './Tiles';
import { TrendChart } from './TrendChart';
import { useRecapPopup } from './useRecapPopup';
import { WeekChart } from './WeekChart';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

let api: MockApi;
const SUBJECT_1 = 'COMP2181 Theory of Computation';
const SUBJECT_2 = 'COMP2211 Networks and Systems';

const overview = (o: Partial<StatsOverview> = {}): StatsOverview => ({
  todayMs: 2 * HOUR + 5 * MINUTE,
  weekMs: 10 * HOUR,
  lastWeekMs: 8 * HOUR,
  weekDeltaPct: 25,
  currentStreak: 6,
  longestStreak: 14,
  allTimeMs: 123 * HOUR + 4 * MINUTE,
  goalMs: 3 * HOUR,
  goalProgress: 0.69,
  ...o,
});

const week = (weekStart: string, bySubject: Record<string, number>[] = []): WeekBars => ({
  weekStart,
  days: Array.from({ length: 7 }, (_, i) => {
    const subjects = bySubject[i] ?? {};
    return {
      dayKey: addDays(weekStart, i),
      ms: Object.values(subjects).reduce((a, b) => a + b, 0),
      bySubject: subjects,
    };
  }),
});

/** 53 Monday-first weeks ending the week of 2 Nov 2026, as main serves them. */
const heatmapCells = (): HeatmapCell[] => {
  const first = addDays('2026-11-02', -7 * 52);
  return Array.from({ length: 371 }, (_, i) => {
    const dayKey = addDays(first, i);
    const ms = dayKey === '2026-11-02' ? HOUR + 5 * MINUTE : dayKey === '2026-11-03' ? 4 * HOUR : 0;
    return {
      dayKey,
      ms,
      shade: (ms === 0 ? 0 : ms < 2 * HOUR ? 3 : 4) as HeatmapCell['shade'],
      goalHit: ms >= 3 * HOUR,
      streakDay: ms >= 25 * MINUTE,
    };
  });
};

const session = (s: Partial<Session> = {}): Session => ({
  id: 1,
  pomodoroId: 'p1',
  subjectId: 1,
  startedAt: new Date(2026, 10, 2, 14, 0).getTime(),
  endedAt: new Date(2026, 10, 2, 15, 5).getTime(),
  checkpointAt: new Date(2026, 10, 2, 15, 5).getTime(),
  focusMs: HOUR + 5 * MINUTE,
  discardedMs: 0,
  dayKey: '2026-11-02',
  status: 'done',
  taskId: null,
  taskText: null,
  ...s,
});

const recap = (r: Partial<WeeklyRecap> = {}): WeeklyRecap => ({
  weekStart: '2026-11-02',
  totalMs: 12 * HOUR + 30 * MINUTE,
  prevTotalMs: 10 * HOUR,
  daysStudied: 5,
  bestDay: { dayKey: '2026-11-04', ms: 3 * HOUR + 10 * MINUTE },
  topSubjects: [
    { subjectId: 1, name: 'Maths', ms: 5 * HOUR },
    { subjectId: null, name: 'No subject', ms: HOUR },
  ],
  longestSessionMs: 50 * MINUTE,
  streakAtEnd: 9,
  goalDaysHit: 2,
  ...r,
});

const emptyRecap = (): WeeklyRecap =>
  recap({ totalMs: 0, daysStudied: 0, bestDay: null, topSubjects: [], longestSessionMs: 0, goalDaysHit: 0 });

beforeEach(() => {
  api = mockApi();
  installMockApi(api);
  resetStudyStore();
  useStudyStore.setState({ subjects: seedSubjects() });
});

describe('format', () => {
  it('formats day and month like "2 Nov"', () => {
    expect(formatDayMonth('2026-11-02')).toBe('2 Nov');
    expect(formatDayMonth('2026-09-30')).toBe('30 Sep');
  });

  it('formats the week delta with a true minus sign, or — when there is nothing to compare', () => {
    expect(formatDelta(25)).toBe('+25%');
    expect(formatDelta(-10)).toBe('−10%');
    expect(formatDelta(0)).toBe('+0%');
    expect(formatDelta(null)).toBe('—');
  });

  it('titles a recap "Your week: 2 Nov–8 Nov"', () => {
    expect(recapTitle('2026-11-02')).toBe('Your week: 2 Nov–8 Nov');
    expect(recapTitle('2026-12-28')).toBe('Your week: 28 Dec–3 Jan');
  });
});

describe('Tiles', () => {
  it('shows today, week with +25% vs last week, streak labelled "Day streak", longest, all-time', () => {
    render(<Tiles overview={overview()} />);
    const tile = (label: string) => screen.getByText(label).closest('[data-tile]') as HTMLElement;
    expect(tile('Today')).toHaveTextContent('2h 05m');
    expect(tile('This week')).toHaveTextContent('10h 00m');
    expect(tile('This week')).toHaveTextContent('+25% vs last week');
    expect(tile('Day streak')).toHaveTextContent('6');
    expect(tile('Longest streak')).toHaveTextContent('14');
    expect(tile('All time')).toHaveTextContent('123h 04m');
  });

  it('week delta shows — when null', () => {
    render(<Tiles overview={overview({ lastWeekMs: 0, weekDeltaPct: null })} />);
    const week = screen.getByText('This week').closest('[data-tile]') as HTMLElement;
    expect(week).toHaveTextContent('— vs last week');
    expect(week).not.toHaveTextContent('%');
  });

  it('shows a fall with a true minus sign', () => {
    render(<Tiles overview={overview({ weekDeltaPct: -10 })} />);
    expect(screen.getByText('This week').closest('[data-tile]')).toHaveTextContent('−10% vs last week');
  });
});

describe('Heatmap', () => {
  it('renders 371 cells with shade classes and goal dots', () => {
    const { container } = render(<Heatmap cells={heatmapCells()} />);
    const cells = container.querySelectorAll('[data-day]');
    expect(cells).toHaveLength(371);
    expect(container.querySelector('[data-day="2026-11-02"]')).toHaveAttribute('data-shade', '3');
    expect(container.querySelector('[data-day="2026-11-03"]')).toHaveAttribute('data-shade', '4');
    expect(container.querySelector('[data-day="2026-11-04"]')).toHaveAttribute('data-shade', '0');
    for (const shade of [0, 3, 4]) {
      expect(container.querySelector(`[data-shade="${shade}"]`)?.getAttribute('class')).toMatch(
        new RegExp(`shade${shade}`),
      );
    }
    const dots = container.querySelectorAll('[data-goal-dot]');
    expect(dots).toHaveLength(1);
    expect(dots[0]).toHaveAttribute('data-goal-dot', '2026-11-03');
  });

  it('lays the weeks out Monday-first, one column per week', () => {
    const { container } = render(<Heatmap cells={heatmapCells()} />);
    const monday = container.querySelector('[data-day="2026-11-02"]');
    const sunday = container.querySelector('[data-day="2026-11-08"]');
    const nextColumn = container.querySelector('[data-day="2026-10-26"]');
    expect(monday?.getAttribute('x')).toBe(sunday?.getAttribute('x'));
    expect(Number(monday?.getAttribute('y'))).toBeLessThan(Number(sunday?.getAttribute('y')));
    expect(Number(nextColumn?.getAttribute('x'))).toBeLessThan(Number(monday?.getAttribute('x')));
  });

  it('hovering a cell shows date and h/m', () => {
    const { container } = render(<Heatmap cells={heatmapCells()} />);
    const cell = container.querySelector('[data-day="2026-11-02"]') as Element;
    expect(cell.querySelector('title')).toHaveTextContent('2 Nov 2026 · 1h 05m');
    fireEvent.mouseEnter(cell);
    expect(screen.getByTestId('heatmap-tip')).toHaveTextContent('2 Nov 2026 · 1h 05m');
  });

  it('arrow keys walk the days from the keyboard', async () => {
    render(<Heatmap cells={heatmapCells()} />);
    const grid = screen.getByRole('group', { name: /study calendar/i });
    grid.focus();
    // Focus starts on the latest day; Left moves a week back, Up a day back.
    await userEvent.keyboard('{ArrowUp}');
    expect(screen.getByTestId('heatmap-tip')).toHaveTextContent('7 Nov 2026 · 0h 00m');
    await userEvent.keyboard('{ArrowLeft}');
    expect(screen.getByTestId('heatmap-tip')).toHaveTextContent('31 Oct 2026');
  });

  it('names every legend shade for screen readers, not only in a tooltip', () => {
    render(<Heatmap cells={heatmapCells()} />);
    for (const name of ['No focus time', 'Under 30 min', 'Under 1 h', 'Under 2 h', '2 h or more']) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
  });
});

describe('WeekChart', () => {
  it('week chart ‹ › calls stats.week with previous/next Monday', async () => {
    const weekFn = vi.fn((weekStart?: string) => Promise.resolve(week(weekStart ?? '2026-11-02')));
    api = mockApi({ stats: { week: weekFn } });
    installMockApi(api);
    render(<WeekChart revision={0} />);
    await screen.findByText('2 Nov–8 Nov');
    expect(weekFn).toHaveBeenLastCalledWith(undefined);
    const next = screen.getByRole('button', { name: 'Next week' });
    expect(next).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'Previous week' }));
    expect(weekFn).toHaveBeenLastCalledWith('2026-10-26');
    await screen.findByText('26 Oct–1 Nov');
    expect(next).toBeEnabled();

    await userEvent.click(next);
    expect(weekFn).toHaveBeenLastCalledWith('2026-11-02');
    await screen.findByText('2 Nov–8 Nov');
    expect(next).toBeDisabled();
  });

  it('› still reaches the new current week after a week rollover while the overlay is open', async () => {
    let current = '2026-11-02';
    const weekFn = vi.fn((weekStart?: string) => Promise.resolve(week(weekStart ?? current)));
    api = mockApi({ stats: { week: weekFn } });
    installMockApi(api);
    const { rerender } = render(<WeekChart revision={0} />);
    await screen.findByText('2 Nov–8 Nov');
    await userEvent.click(screen.getByRole('button', { name: 'Previous week' }));
    await screen.findByRole('img', { name: /^Focus time, 26 Oct–1 Nov/ });

    // Monday 04:00 passes; a session edit bumps the revision.
    current = '2026-11-09';
    rerender(<WeekChart revision={1} />);
    const next = screen.getByRole('button', { name: 'Next week' });
    await userEvent.click(next);
    await screen.findByRole('img', { name: /^Focus time, 2 Nov–8 Nov/ });
    await waitFor(() => expect(next).toBeEnabled());
    await userEvent.click(next);
    await screen.findByRole('img', { name: /^Focus time, 9 Nov–15 Nov/ });
    await waitFor(() => expect(next).toBeDisabled());
  });

  it('stacks one series per subject, untagged in grey and last', async () => {
    const bars = week('2026-11-02', [{ [NO_SUBJECT_KEY]: HOUR, '1': 2 * HOUR }, { '2': HOUR }]);
    api = mockApi({ stats: { week: vi.fn(() => Promise.resolve(bars)) } });
    installMockApi(api);
    render(<WeekChart revision={0} />);
    const legend = await screen.findByRole('list', { name: 'Subjects this week' });
    const items = within(legend).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual([SUBJECT_1, SUBJECT_2, 'No subject']);
    expect(items[2]?.querySelector('[data-colour]')).toHaveAttribute('data-colour', '#8a8f98');
  });

  it('steps from the week asked for, so two quick ‹ clicks go back two weeks, and never shows the old week meanwhile', async () => {
    const weekFn = vi.fn((weekStart?: string) =>
      weekStart === undefined ? Promise.resolve(week('2026-11-02')) : new Promise<WeekBars>(() => {}),
    );
    api = mockApi({ stats: { week: weekFn } });
    installMockApi(api);
    const { container } = render(<WeekChart revision={0} />);
    await screen.findByRole('img', { name: /^Focus time, 2 Nov–8 Nov/ });
    const previous = screen.getByRole('button', { name: 'Previous week' });
    await userEvent.click(previous);
    await userEvent.click(previous);
    expect(weekFn).toHaveBeenLastCalledWith('2026-10-19');
    expect(screen.getByText('19 Oct–25 Oct')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /^Focus time/ })).not.toBeInTheDocument();
    expect(container.querySelector('[data-skeleton]')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next week' })).toBeEnabled();
  });

  it('after a week fails to load, ‹ › and Try again still work', async () => {
    let fail = true;
    const weekFn = vi.fn((weekStart?: string) => {
      if (weekStart === '2026-10-26' && fail) {
        fail = false;
        return Promise.reject(new Error('offline'));
      }
      return Promise.resolve(week(weekStart ?? '2026-11-02'));
    });
    api = mockApi({ stats: { week: weekFn } });
    installMockApi(api);
    render(<WeekChart revision={0} />);
    await screen.findByText('2 Nov–8 Nov');
    await userEvent.click(screen.getByRole('button', { name: 'Previous week' }));
    expect(await screen.findByText('Couldn’t load this week.')).toBeInTheDocument();
    expect(screen.getByText('26 Oct–1 Nov')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous week' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Next week' })).toBeEnabled();

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(weekFn).toHaveBeenLastCalledWith('2026-10-26');
    await screen.findByRole('img', { name: /^Focus time, 26 Oct–1 Nov/ });
    expect(screen.queryByText('Couldn’t load this week.')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Next week' }));
    await screen.findByRole('img', { name: /^Focus time, 2 Nov–8 Nov/ });
    expect(screen.getByRole('button', { name: 'Next week' })).toBeDisabled();
  });
});

describe('TrendChart', () => {
  it('summarises the last 12 weeks for screen readers', async () => {
    const points = Array.from({ length: 12 }, (_, i) => ({
      weekStart: addDays('2026-08-17', 7 * i),
      ms: i * HOUR,
    }));
    api = mockApi({ stats: { trend: vi.fn(() => Promise.resolve(points)) } });
    installMockApi(api);
    render(<TrendChart revision={0} />);
    const chart = await screen.findByRole('img', { name: /^Last 12 weeks/ });
    expect(chart.getAttribute('aria-label')).toMatch(
      /^Last 12 weeks, week by week: 17 Aug 0h 00m, 24 Aug 1h 00m, .*, 2 Nov 11h 00m$/,
    );
  });
});

describe('SubjectBreakdown', () => {
  it("subject range toggle calls bySubject('month')", async () => {
    const totals: SubjectTotal[] = [
      { subjectId: 1, name: 'Maths', colour: '#7c9cff', ms: 3 * HOUR },
      { subjectId: null, name: 'No subject', colour: '#8a8f98', ms: 30 * MINUTE },
    ];
    const bySubject = vi.fn(() => Promise.resolve(totals));
    api = mockApi({ stats: { bySubject } });
    installMockApi(api);
    render(<SubjectBreakdown revision={0} />);
    expect(await screen.findByText('3h 00m')).toBeInTheDocument();
    expect(bySubject).toHaveBeenLastCalledWith('week');
    expect(screen.getByRole('radio', { name: 'Week' })).toBeChecked();

    await userEvent.click(screen.getByRole('radio', { name: 'Month' }));
    expect(bySubject).toHaveBeenLastCalledWith('month');
    expect(screen.getByRole('radio', { name: 'Month' })).toBeChecked();
    await userEvent.click(screen.getByRole('radio', { name: 'All time' }));
    expect(bySubject).toHaveBeenLastCalledWith('all');
  });

  it('says so kindly when the range is empty', async () => {
    render(<SubjectBreakdown revision={0} />);
    expect(await screen.findByText('No focus time in this range yet.')).toBeInTheDocument();
  });
});

describe('SessionsTable', () => {
  const setupSessions = (rows: Session[]) => {
    const sessions = vi.fn(() => Promise.resolve(rows));
    api = mockApi({ stats: { sessions } });
    installMockApi(api);
    const onChanged = vi.fn();
    render(<SessionsTable revision={0} onChanged={onChanged} />);
    return { onChanged };
  };

  it('sessions table changes subject via updateSession and deletes after confirm', async () => {
    const { onChanged } = setupSessions([session({ id: 7 })]);
    const row = (await screen.findByText('1h 05m')).closest('tr') as HTMLElement;
    expect(row).toHaveTextContent('Mon 2 Nov');

    await userEvent.selectOptions(within(row).getByRole('combobox', { name: 'Subject' }), SUBJECT_2);
    expect(api.stats.updateSession).toHaveBeenCalledWith(7, { subjectId: 2 });
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));

    await userEvent.selectOptions(within(row).getByRole('combobox', { name: 'Subject' }), 'No subject');
    expect(api.stats.updateSession).toHaveBeenLastCalledWith(7, { subjectId: null });

    await userEvent.click(within(row).getByRole('button', { name: 'Delete session' }));
    expect(api.stats.deleteSession).not.toHaveBeenCalled();
    expect(screen.getByText('Delete this session? This removes 1h 05m from your stats.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(api.stats.deleteSession).toHaveBeenCalledWith(7);
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(3));
    expect(screen.queryByText('1h 05m')).not.toBeInTheDocument();
  });

  it('cancel keeps the session', async () => {
    setupSessions([session({ id: 7 })]);
    const row = (await screen.findByText('1h 05m')).closest('tr') as HTMLElement;
    await userEvent.click(within(row).getByRole('button', { name: 'Delete session' }));
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    expect(cancel).toHaveFocus();
    await userEvent.click(cancel);
    expect(api.stats.deleteSession).not.toHaveBeenCalled();
    expect(screen.queryByText(/Delete this session\?/)).not.toBeInTheDocument();
  });

  it('lists newest first and leaves a running session alone', async () => {
    setupSessions([
      session({ id: 1, startedAt: new Date(2026, 10, 1, 9, 0).getTime(), dayKey: '2026-11-01' }),
      session({ id: 2, status: 'running', endedAt: null, focusMs: 10 * MINUTE }),
    ]);
    await screen.findByText('In progress');
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('In progress');
    expect(
      within(rows[0] as HTMLElement).queryByRole('button', { name: 'Delete session' }),
    ).not.toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).getByRole('combobox', { name: 'Subject' })).toBeDisabled();
    expect(rows[1]).toHaveTextContent('Sun 1 Nov');
  });

  it('says so when there are no sessions yet', async () => {
    setupSessions([]);
    expect(
      await screen.findByText('No sessions yet. Start a Pomodoro and they’ll appear here.'),
    ).toBeInTheDocument();
  });

  it('names a subject it cannot find rather than showing "No subject"', async () => {
    setupSessions([session({ id: 7, subjectId: 99 })]);
    const select = await screen.findByRole('combobox', { name: 'Subject' });
    expect(select).toHaveValue('99');
    expect(select).toHaveDisplayValue('Unknown subject');
  });

  it("lets main's answer win once it lands, so a later change elsewhere shows", async () => {
    let subjectId = 1;
    const sessions = vi.fn(() => Promise.resolve([session({ id: 7, subjectId })]));
    api = mockApi({ stats: { sessions } });
    installMockApi(api);
    const { rerender } = render(<SessionsTable revision={0} onChanged={vi.fn()} />);
    const select = await screen.findByRole('combobox', { name: 'Subject' });
    await userEvent.selectOptions(select, SUBJECT_2);
    expect(select).toHaveDisplayValue(SUBJECT_2);

    subjectId = 2;
    rerender(<SessionsTable revision={1} onChanged={vi.fn()} />);
    await waitFor(() => expect(sessions).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('combobox', { name: 'Subject' })).toHaveDisplayValue(SUBJECT_2);

    // The timer (or another window) moves it back; the table follows main.
    subjectId = 1;
    rerender(<SessionsTable revision={2} onChanged={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Subject' })).toHaveDisplayValue(SUBJECT_1),
    );
  });
});

describe('RecapCard', () => {
  it('recap card title "Your week: 2 Nov–8 Nov" and the week\'s numbers', () => {
    render(<RecapCard recap={recap()} />);
    expect(screen.getByRole('heading', { name: 'Your week: 2 Nov–8 Nov' })).toBeInTheDocument();
    expect(screen.getByText('12h 30m')).toBeInTheDocument();
    const term = (t: string) => screen.getByText(t).parentElement as HTMLElement;
    expect(term('Week before')).toHaveTextContent('10h 00m');
    expect(term('Days studied')).toHaveTextContent('5 of 7');
    expect(term('Best day')).toHaveTextContent('Wed 4 Nov · 3h 10m');
    expect(term('Longest session')).toHaveTextContent('0h 50m');
    expect(term('Streak')).toHaveTextContent('9 days');
    expect(term('Goal hit')).toHaveTextContent('2 days');
    const top = screen.getByRole('list', { name: 'Top subjects' });
    expect(
      within(top)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Maths5h 00m', 'No subject1h 00m']);
  });

  it('empty-week copy from spec §3.14', () => {
    render(<RecapCard recap={emptyRecap()} />);
    expect(screen.getByRole('heading', { name: 'Your week: 2 Nov–8 Nov' })).toBeInTheDocument();
    expect(
      screen.getByText("No focus time last week — that's okay. A fresh week starts now."),
    ).toBeInTheDocument();
    expect(screen.queryByText('Days studied')).not.toBeInTheDocument();
  });

  it('a close button appears only when the card can be closed', async () => {
    const onClose = vi.fn();
    const { rerender } = render(<RecapCard recap={recap()} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    rerender(<RecapCard recap={recap()} onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('RecapList', () => {
  it('lists stored recaps newest first', async () => {
    api = mockApi({
      recaps: {
        list: vi.fn(() =>
          Promise.resolve([recap({ weekStart: '2026-10-26' }), recap({ weekStart: '2026-11-02' })]),
        ),
      },
    });
    installMockApi(api);
    render(<RecapList revision={0} />);
    const headings = await screen.findAllByRole('heading', { name: /^Your week/ });
    expect(headings.map((h) => h.textContent)).toEqual(['Your week: 2 Nov–8 Nov', 'Your week: 26 Oct–1 Nov']);
  });

  it('explains when there are none yet', async () => {
    render(<RecapList revision={0} />);
    expect(
      await screen.findByText('Your first recap arrives after your first full week.'),
    ).toBeInTheDocument();
  });
});

function PopupHost() {
  return <>{useRecapPopup()}</>;
}

describe('useRecapPopup', () => {
  it('recap popup shows once then markShown', async () => {
    const pending = vi.fn(() => Promise.resolve(recap()));
    api = mockApi({ recaps: { pending } });
    installMockApi(api);
    render(
      <StrictMode>
        <PopupHost />
      </StrictMode>,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Your week: 2 Nov–8 Nov' });
    await waitFor(() => expect(api.recaps.markShown).toHaveBeenCalledWith('2026-11-02'));
    expect(pending).toHaveBeenCalledTimes(1);
    expect(api.recaps.markShown).toHaveBeenCalledTimes(1);
    expect(within(dialog).getByRole('button', { name: 'Got it' })).toHaveFocus();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Got it' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(pending).toHaveBeenCalledTimes(1);
    expect(api.recaps.markShown).toHaveBeenCalledTimes(1);
  });

  it('Esc closes it without reaching the app shortcuts', async () => {
    api = mockApi({ recaps: { pending: vi.fn(() => Promise.resolve(emptyRecap())) } });
    installMockApi(api);
    const onWindowKey = vi.fn();
    window.addEventListener('keydown', onWindowKey);
    render(<PopupHost />);
    await screen.findByText("No focus time last week — that's okay. A fresh week starts now.");
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onWindowKey).not.toHaveBeenCalled();
    window.removeEventListener('keydown', onWindowKey);
  });

  it('takes the keyboard while open: shortcuts never fire behind it, Enter presses Got it', async () => {
    api = mockApi({ recaps: { pending: vi.fn(() => Promise.resolve(recap())) } });
    installMockApi(api);
    const onWindowKey = vi.fn();
    window.addEventListener('keydown', onWindowKey);
    render(<PopupHost />);
    const dialog = await screen.findByRole('dialog', { name: 'Your week: 2 Nov–8 Nov' });
    const gotIt = within(dialog).getByRole('button', { name: 'Got it' });
    // Focus slips out (a click on the page behind, say): keys still don't reach the app.
    gotIt.blur();
    await userEvent.keyboard('srn');
    expect(onWindowKey).not.toHaveBeenCalled();
    expect(gotIt).toHaveFocus();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await userEvent.keyboard('{Enter}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onWindowKey).not.toHaveBeenCalled();
    window.removeEventListener('keydown', onWindowKey);
  });

  it('Space presses Got it too', async () => {
    api = mockApi({ recaps: { pending: vi.fn(() => Promise.resolve(recap())) } });
    installMockApi(api);
    render(<PopupHost />);
    await screen.findByRole('dialog', { name: 'Your week: 2 Nov–8 Nov' });
    await userEvent.keyboard(' ');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders nothing when no recap is pending', async () => {
    render(<PopupHost />);
    await act(async () => {});
    expect(api.recaps.pending).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.recaps.markShown).not.toHaveBeenCalled();
  });

  describe('asking again', () => {
    const at = (iso: string) => vi.useFakeTimers({ toFake: ['Date'], now: new Date(iso) });

    it('asks again when the window comes back on a new study day, and shows a recap once', async () => {
      at('2026-11-09T10:00:00');
      const pending = vi.fn().mockResolvedValueOnce(null).mockResolvedValue(recap());
      api = mockApi({ recaps: { pending } });
      installMockApi(api);
      render(
        <StrictMode>
          <PopupHost />
        </StrictMode>,
      );
      await act(async () => {});
      expect(pending).toHaveBeenCalledTimes(1);

      // Same day: hiding and showing the window does not ask again.
      act(() => useWindowVisibility.getState().setVisible(false));
      act(() => useWindowVisibility.getState().setVisible(true));
      await act(async () => {});
      expect(pending).toHaveBeenCalledTimes(1);

      // Slept past the rollover: back on screen, the next day, it asks.
      at('2026-11-10T10:00:00');
      act(() => useWindowVisibility.getState().setVisible(false));
      act(() => useWindowVisibility.getState().setVisible(true));
      await act(async () => {});
      expect(pending).toHaveBeenCalledTimes(2);
      expect(screen.getByRole('dialog', { name: 'Your week: 2 Nov–8 Nov' })).toBeInTheDocument();
      expect(api.recaps.markShown).toHaveBeenCalledTimes(1);

      // Another day, the same recap offered again: it is not marked twice.
      at('2026-11-11T10:00:00');
      act(() => void window.dispatchEvent(new Event('focus')));
      await act(async () => {});
      expect(pending).toHaveBeenCalledTimes(3);
      expect(api.recaps.markShown).toHaveBeenCalledTimes(1);
      vi.useRealTimers();
    });

    it('asks again on window focus on a new day, but not twice on one day', async () => {
      at('2026-11-09T10:00:00');
      const pending = vi.fn(() => Promise.resolve(null));
      api = mockApi({ recaps: { pending } });
      installMockApi(api);
      render(<PopupHost />);
      await act(async () => {});
      act(() => void window.dispatchEvent(new Event('focus')));
      expect(pending).toHaveBeenCalledTimes(1);
      at('2026-11-10T10:00:00');
      act(() => void window.dispatchEvent(new Event('focus')));
      act(() => void window.dispatchEvent(new Event('focus')));
      await act(async () => {});
      expect(pending).toHaveBeenCalledTimes(2);
      vi.useRealTimers();
    });
  });
});

describe('StatsOverlay', () => {
  it("holds each section's place with a quiet skeleton while it loads", async () => {
    const never = <T,>() => vi.fn(() => new Promise<T>(() => {}));
    api = mockApi({
      stats: {
        overview: never<StatsOverview>(),
        heatmap: never<HeatmapCell[]>(),
        week: never<WeekBars>(),
        trend: never<{ weekStart: string; ms: number }[]>(),
        bySubject: never<SubjectTotal[]>(),
        sessions: never<Session[]>(),
      },
      recaps: { list: never<WeeklyRecap[]>() },
    });
    installMockApi(api);
    const { container } = render(<StatsOverlay />);
    await act(async () => {});
    expect(container.querySelectorAll('[data-skeleton]')).toHaveLength(7);
    expect(container.querySelectorAll('section[aria-busy="true"]')).toHaveLength(7);
  });

  it('drops the skeletons once main answers', async () => {
    render(<StatsOverlay />);
    await screen.findByText('No sessions yet. Start a Pomodoro and they’ll appear here.');
    await waitFor(() => expect(document.querySelectorAll('[data-skeleton]')).toHaveLength(0));
    expect(document.querySelectorAll('[aria-busy="true"]')).toHaveLength(0);
  });

  it('loads every section from main', async () => {
    api = mockApi({
      stats: {
        overview: vi.fn(() => Promise.resolve(overview())),
        heatmap: vi.fn(() => Promise.resolve(heatmapCells())),
        sessions: vi.fn(() => Promise.resolve([session()])),
      },
    });
    installMockApi(api);
    render(<StatsOverlay />);
    await waitFor(() =>
      expect(screen.getByText('This week', { selector: 'dt' }).parentElement).toHaveTextContent(
        '+25% vs last week',
      ),
    );
    for (const name of ['This week', 'Last 12 weeks', 'By subject', 'Sessions', 'Weekly recaps']) {
      expect(screen.getByRole('heading', { name })).toBeInTheDocument();
    }
    expect(screen.queryByRole('heading', { name: 'Stats' })).not.toBeInTheDocument();
    await screen.findByText('1h 05m');
  });

  it('refreshes every section and the top bar after a session is deleted', async () => {
    api = mockApi({ stats: { sessions: vi.fn(() => Promise.resolve([session({ id: 3 })])) } });
    installMockApi(api);
    render(<StatsOverlay />);
    const row = (await screen.findByText('1h 05m')).closest('tr') as HTMLElement;
    await waitFor(() => expect(api.stats.overview).toHaveBeenCalledTimes(1));
    await userEvent.click(within(row).getByRole('button', { name: 'Delete session' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(api.stats.overview).toHaveBeenCalledTimes(3));
    expect(api.stats.heatmap).toHaveBeenCalledTimes(2);
    expect(api.stats.week).toHaveBeenCalledTimes(2);
    expect(api.stats.trend).toHaveBeenCalledTimes(2);
    expect(api.stats.bySubject).toHaveBeenCalledTimes(2);
    expect(api.stats.sessions).toHaveBeenCalledTimes(2);
    expect(api.recaps.list).toHaveBeenCalledTimes(2);
  });
});
