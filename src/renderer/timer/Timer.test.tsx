import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import type { TimerState } from '../../shared/types';
import { MiniTimer } from '../mini/MiniTimer';
import { resetStudyStore, useStudyStore } from '../shell/store';
import { idleTimerState, installMockApi, mockApi, seedSubjects, type MockApi } from '../test/mockApi';
import { AwayPrompt } from './AwayPrompt';
import { formatClock } from './format';
import { TimerWidget } from './TimerWidget';

let api: MockApi;

function setup(timer: Partial<TimerState> = {}) {
  api = mockApi();
  installMockApi(api);
  resetStudyStore();
  useStudyStore.setState({ timer: { ...idleTimerState(), ...timer }, subjects: seedSubjects() });
}

/** Stands in for main's timer push, which the store only hears after initStudyStore(). */
const push = (timer: TimerState): void => act(() => useStudyStore.setState({ timer }));

beforeEach(() => setup());

describe('formatClock', () => {
  it('formats minutes and hours', () => {
    expect(formatClock(3_725_000)).toBe('1:02:05');
    expect(formatClock(25 * 60_000)).toBe('25:00');
    expect(formatClock(59_001)).toBe('01:00');
    expect(formatClock(-5)).toBe('00:00');
  });
});

describe('TimerWidget', () => {
  it('shows 25:00 idle focus', () => {
    render(<TimerWidget />);
    expect(screen.getByRole('timer')).toHaveTextContent('25:00');
    expect(screen.getByRole('tab', { name: 'Pomodoro' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument();
  });

  it('mode tabs call setMode', async () => {
    render(<TimerWidget />);
    await userEvent.click(screen.getByRole('tab', { name: 'Short break' }));
    await userEvent.click(screen.getByRole('tab', { name: 'Long break' }));
    expect(api.timer.setMode).toHaveBeenNthCalledWith(1, 'short');
    expect(api.timer.setMode).toHaveBeenNthCalledWith(2, 'long');
  });

  it('start, pause, resume, reset and skip call the API', async () => {
    render(<TimerWidget />);
    await userEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(api.timer.start).toHaveBeenCalledTimes(1);
    push({ ...idleTimerState(), status: 'running' });
    await userEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(api.timer.pause).toHaveBeenCalledTimes(1);
    push({ ...idleTimerState(), status: 'paused', pauseReason: 'user' });
    await userEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(api.timer.resume).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Reset' }));
    await userEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(api.timer.reset).toHaveBeenCalledTimes(1);
    expect(api.timer.skip).toHaveBeenCalledTimes(1);
  });

  it('subject select lists non-archived subjects with "No subject"', async () => {
    const subjects = seedSubjects();
    subjects[1] = { ...subjects[1]!, archived: true };
    useStudyStore.setState({ subjects });
    render(<TimerWidget />);
    const names = screen.getAllByRole('option').map((o) => o.textContent);
    expect(names[0]).toBe('No subject');
    expect(names).not.toContain(subjects[1]!.name);
    expect(names).toContain(subjects[0]!.name);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Subject' }), String(subjects[0]!.id));
    expect(api.timer.setSubject).toHaveBeenCalledWith(subjects[0]!.id);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Subject' }), 'No subject');
    expect(api.timer.setSubject).toHaveBeenLastCalledWith(null);
  });

  it('shows the system-pause messages', () => {
    setup({ status: 'paused', pauseReason: 'suspend' });
    const { unmount } = render(<TimerWidget />);
    expect(screen.getByText('Paused while your PC was asleep')).toBeInTheDocument();
    unmount();
    push({ ...idleTimerState(), status: 'paused', pauseReason: 'lock' });
    render(<TimerWidget />);
    expect(screen.getByText('Paused while your PC was locked')).toBeInTheDocument();
  });

  it('shows the tomato counter 2/4 and wraps after a long break', () => {
    setup({ completedFocusCount: 2 });
    const { unmount } = render(<TimerWidget />);
    expect(screen.getByText('🍅 2/4')).toBeInTheDocument();
    unmount();
    setup({ completedFocusCount: 5 });
    render(<TimerWidget />);
    expect(screen.getByText('🍅 1/4')).toBeInTheDocument();
  });

  it('the gear opens the settings overlay', async () => {
    render(<TimerWidget />);
    await userEvent.click(screen.getByRole('button', { name: 'Timer settings' }));
    expect(useStudyStore.getState().overlay).toBe('settings');
  });
});

describe('AwayPrompt', () => {
  it('uses the spec copy, focuses Discard and answers through the API', async () => {
    render(<AwayPrompt />);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    act(() => api.emitAway({ awayMs: 7 * 60_000 + 20_000, deadline: 0 }));
    expect(screen.getByText('Welcome back')).toBeInTheDocument();
    expect(screen.getByText('You were away for 7 min. Keep that time as study?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Discard' })).toHaveFocus();
    await userEvent.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(api.timer.answerAway).toHaveBeenCalledWith('keep');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();

    act(() => api.emitAway({ awayMs: 10_000, deadline: 0 }));
    expect(screen.getByText('You were away for 1 min. Keep that time as study?')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(api.timer.answerAway).toHaveBeenLastCalledWith('discard');
  });

  it('closes when main sends null', () => {
    render(<AwayPrompt />);
    act(() => api.emitAway({ awayMs: 600_000, deadline: 0 }));
    act(() => api.emitAway(null));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});

describe('MiniTimer', () => {
  it('shows the countdown, mode and subject, and toggles via start/pause', async () => {
    setup({ remainingMs: 5 * 60_000, mode: 'short', subjectId: 1 });
    render(<MiniTimer />);
    expect(screen.getByRole('timer')).toHaveTextContent('05:00');
    expect(screen.getByText('Short break')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(api.timer.start).toHaveBeenCalledTimes(1);
    push({ ...idleTimerState(), status: 'running' });
    await userEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(api.timer.pause).toHaveBeenCalledTimes(1);
  });

  it('"Open StudyAt" calls showMini(false)', async () => {
    render(<MiniTimer />);
    await userEvent.click(screen.getByRole('button', { name: 'Open StudyAt' }));
    expect(api.app.showMini).toHaveBeenCalledWith(false);
  });
});
