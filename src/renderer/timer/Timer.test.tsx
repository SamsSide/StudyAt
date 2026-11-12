import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatClock as sharedFormatClock } from '../../shared/clock';
import type { Task, TimerState } from '../../shared/types';
import { MiniTimer } from '../mini/MiniTimer';
import { resetStudyStore, useStudyStore } from '../shell/store';
import { useShortcuts } from '../shell/useShortcuts';
import { idleTimerState, installMockApi, mockApi, seedSubjects, type MockApi } from '../test/mockApi';
import { AwayPrompt } from './AwayPrompt';
import { formatClock } from './format';
import { TimerWidget } from './TimerWidget';

let api: MockApi;

const task = (id: number, text: string, done = false): Task => ({
  id,
  text,
  colour: 'yellow',
  done,
  sort: id,
  createdAt: 0,
  doneAt: done ? 1 : null,
});

function setup(timer: Partial<TimerState> = {}) {
  api = mockApi();
  installMockApi(api);
  resetStudyStore();
  useStudyStore.setState({ timer: { ...idleTimerState(), ...timer }, subjects: seedSubjects() });
}

/** Stands in for main's timer push, which the store only hears after initStudyStore(). */
const push = (timer: TimerState): void => act(() => useStudyStore.setState({ timer }));

/** Mounts the in-app shortcuts around the component under test, as the shell does. */
function Shortcuts({ children }: { children: ReactNode }) {
  useShortcuts();
  return <>{children}</>;
}

beforeEach(() => setup());

describe('formatClock', () => {
  it('is the shared clock, so the widget reads the same as the title and tray', () => {
    expect(formatClock).toBe(sharedFormatClock);
  });
});

describe('TimerWidget', () => {
  it('shows 25:00 idle focus', () => {
    render(<TimerWidget />);
    expect(screen.getByRole('timer')).toHaveTextContent('25:00');
    expect(screen.getByRole('button', { name: 'Pomodoro' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument();
  });

  it('mode buttons call setMode on click', async () => {
    render(<TimerWidget />);
    expect(screen.getByRole('toolbar', { name: 'Timer mode' })).toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Short' }));
    await userEvent.click(screen.getByRole('button', { name: 'Long' }));
    expect(api.timer.setMode).toHaveBeenNthCalledWith(1, 'short');
    expect(api.timer.setMode).toHaveBeenNthCalledWith(2, 'long');
  });

  const modeButtons = (): HTMLElement[] => {
    const bar = screen.getByRole('toolbar', { name: 'Timer mode' });
    return ['Pomodoro', 'Short', 'Long'].map((name) => within(bar).getByRole('button', { name }));
  };

  it('arrow keys only move focus round the modes, so a stray key never ends a focus session', async () => {
    const user = userEvent.setup();
    setup({ status: 'running', mode: 'focus' });
    render(<TimerWidget />);
    const [focus, short, long] = modeButtons();
    expect(focus).toHaveAttribute('tabindex', '0');
    expect(short).toHaveAttribute('tabindex', '-1');
    expect(long).toHaveAttribute('tabindex', '-1');
    await user.tab();
    expect(focus).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(short).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(long).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('button', { name: 'Countdown' })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(focus).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('button', { name: 'Countdown' })).toHaveFocus();
    await user.keyboard('{ArrowUp}{ArrowDown}{Home}');
    expect(focus).toHaveFocus();
    await user.keyboard('{End}');
    expect(screen.getByRole('button', { name: 'Countdown' })).toHaveFocus();
    expect(api.timer.setMode).not.toHaveBeenCalled();
    expect(focus).toHaveAttribute('aria-pressed', 'true');
  });

  it('the arrowed-to mode is the tab stop until the mode changes', async () => {
    const user = userEvent.setup();
    setup({ status: 'running', mode: 'focus' });
    render(<TimerWidget />);
    const [focus, short, long] = modeButtons();
    await user.tab();
    await user.keyboard('{ArrowRight}');
    expect(short).toHaveAttribute('tabindex', '0');
    expect(focus).toHaveAttribute('tabindex', '-1');
    await user.tab();
    expect(short).not.toHaveFocus();
    await user.tab({ shift: true });
    expect(short).toHaveFocus();
    push({ ...idleTimerState(), mode: 'long' });
    expect(long).toHaveAttribute('tabindex', '0');
    expect(short).toHaveAttribute('tabindex', '-1');
    expect(long).toHaveAttribute('aria-pressed', 'true');
    // Back to the first mode: the old arrowed-to stop doesn't come back.
    push({ ...idleTimerState(), mode: 'focus' });
    expect(focus).toHaveAttribute('tabindex', '0');
    expect(short).toHaveAttribute('tabindex', '-1');
  });

  it('Enter or Space on the focused mode picks it', async () => {
    const user = userEvent.setup();
    setup({ status: 'running', mode: 'focus' });
    render(<TimerWidget />);
    await user.tab();
    await user.keyboard('{ArrowRight}{Enter}');
    expect(api.timer.setMode).toHaveBeenCalledTimes(1);
    expect(api.timer.setMode).toHaveBeenLastCalledWith('short');
    await user.keyboard('{ArrowRight} ');
    expect(api.timer.setMode).toHaveBeenCalledTimes(2);
    expect(api.timer.setMode).toHaveBeenLastCalledWith('long');
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

  it('the mini toggle shows and hides the mini timer', async () => {
    const user = userEvent.setup();
    render(<TimerWidget />);
    const show = screen.getByRole('button', { name: 'Show mini timer' });
    expect(show).toHaveAttribute('aria-pressed', 'false');
    await user.click(show);
    expect(api.app.showMini).toHaveBeenLastCalledWith(true);
    const hide = screen.getByRole('button', { name: 'Hide mini timer' });
    expect(hide).toHaveAttribute('aria-pressed', 'true');
    await user.click(hide);
    expect(api.app.showMini).toHaveBeenLastCalledWith(false);
    expect(useStudyStore.getState().miniShown).toBe(false);
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

describe('Countdown', () => {
  const presetBar = () => screen.queryByRole('group', { name: 'Countdown length' });

  it('adds Countdown to the mode control and picks it', async () => {
    render(<TimerWidget />);
    const bar = screen.getByRole('toolbar', { name: 'Timer mode' });
    expect(
      within(bar)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Pomodoro', 'Short', 'Long', 'Countdown']);
    await userEvent.click(within(bar).getByRole('button', { name: 'Countdown' }));
    expect(api.timer.setMode).toHaveBeenCalledWith('countdown');
  });

  it('shows presets and a 1 to 240 field while idle, and they set countdownMinutes', async () => {
    const user = userEvent.setup();
    setup({ mode: 'countdown', remainingMs: 60 * 60_000 });
    render(<TimerWidget />);
    const bar = presetBar()!;
    expect(
      within(bar)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['30', '45', '60', '90', '120']);
    await user.click(within(bar).getByRole('button', { name: '90' }));
    expect(api.settings.set).toHaveBeenLastCalledWith({ countdownMinutes: 90 });
    const field = within(bar).getByRole('spinbutton', { name: 'Countdown minutes' });
    expect(field).toHaveAttribute('min', '1');
    expect(field).toHaveAttribute('max', '240');
    await user.clear(field);
    await user.type(field, '999');
    await user.tab();
    expect(api.settings.set).toHaveBeenLastCalledWith({ countdownMinutes: 240 });
  });

  it('hides the presets while running, and in the other modes', () => {
    setup({ mode: 'countdown', status: 'running' });
    const { unmount } = render(<TimerWidget />);
    expect(presetBar()).toBeNull();
    unmount();
    setup({ mode: 'focus' });
    render(<TimerWidget />);
    expect(presetBar()).toBeNull();
  });
});

describe('TaskSelect', () => {
  it('lists "No task" then the not-done tasks in order, and picks one', async () => {
    const user = userEvent.setup();
    vi.mocked(api.legacyTasks.list).mockResolvedValue([
      task(1, 'Read ch. 3'),
      task(2, 'Old', true),
      task(3, 'Essay plan'),
    ]);
    render(<TimerWidget />);
    const box = screen.getByRole('combobox', { name: 'Task' });
    expect(box).toHaveTextContent('No task');
    await user.click(box);
    await screen.findByRole('option', { name: 'Essay plan' });
    expect(optionNames()).toEqual(['No task', 'Read ch. 3', 'Essay plan']);
    expect(screen.getByRole('option', { name: 'Essay plan' })).toHaveAttribute('title', 'Essay plan');
    await user.click(screen.getByRole('option', { name: 'Essay plan' }));
    expect(api.timer.setTask).toHaveBeenCalledWith(3);
  });

  it('is available in Countdown but not in a break', () => {
    setup({ mode: 'countdown' });
    const { unmount } = render(<TimerWidget />);
    expect(screen.getByRole('combobox', { name: 'Task' })).toBeInTheDocument();
    unmount();
    setup({ mode: 'short' });
    render(<TimerWidget />);
    expect(screen.queryByRole('combobox', { name: 'Task' })).toBeNull();
  });

  it('a held task that is now done still shows its text while running', async () => {
    setup({ status: 'running', taskId: 2, taskText: 'Old' });
    vi.mocked(api.legacyTasks.list).mockResolvedValue([task(2, 'Old', true)]);
    render(<TimerWidget />);
    expect(screen.getByRole('combobox', { name: 'Task' })).toHaveTextContent('Old');
    await userEvent.click(screen.getByRole('combobox', { name: 'Task' }));
    await waitFor(() => expect(api.legacyTasks.list).toHaveBeenCalled());
    expect(screen.getByRole('combobox', { name: 'Task' })).toHaveTextContent('Old');
    expect(api.timer.setTask).not.toHaveBeenCalled();
  });
});

const optionNames = (): string[] => screen.getAllByRole('option').map((o) => o.textContent ?? '');

describe('SubjectSelect', () => {
  it('lists "No subject" first, then the live subjects, each with its colour dot', async () => {
    const user = userEvent.setup();
    const subjects = seedSubjects();
    subjects[1] = { ...subjects[1]!, archived: true };
    useStudyStore.setState({ subjects });
    render(<TimerWidget />);
    const box = screen.getByRole('combobox', { name: 'Subject' });
    expect(box).toHaveTextContent('No subject');
    expect(box).toHaveAttribute('aria-expanded', 'false');
    await user.click(box);
    expect(box).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('listbox', { name: 'Subject' })).toBeInTheDocument();
    const names = optionNames();
    expect(names[0]).toBe('No subject');
    expect(names).not.toContain(subjects[1]!.name);
    expect(names).toContain(subjects[0]!.name);
    expect(screen.getByRole('option', { name: 'No subject' })).toHaveAttribute('aria-selected', 'true');
    const dot = screen.getByRole('option', { name: subjects[0]!.name }).querySelector('[data-dot]');
    expect(dot).toHaveStyle({ background: subjects[0]!.colour });
  });

  it('clicking an option sets the subject and closes the list', async () => {
    const user = userEvent.setup();
    const subjects = seedSubjects();
    render(<TimerWidget />);
    await user.click(screen.getByRole('combobox', { name: 'Subject' }));
    await user.click(screen.getByRole('option', { name: subjects[2]!.name }));
    expect(api.timer.setSubject).toHaveBeenLastCalledWith(subjects[2]!.id);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Subject' })).toHaveFocus();
  });

  it('lists an archived subject only while it is the one selected', async () => {
    const user = userEvent.setup();
    const subjects = seedSubjects();
    subjects[1] = { ...subjects[1]!, archived: true };
    setup({ subjectId: subjects[1]!.id });
    useStudyStore.setState({ subjects });
    render(<TimerWidget />);
    const box = screen.getByRole('combobox', { name: 'Subject' });
    expect(box).toHaveTextContent(subjects[1]!.name);
    await user.click(box);
    expect(optionNames()).toContain(subjects[1]!.name);
    expect(screen.getByRole('option', { name: subjects[1]!.name })).toHaveAttribute('aria-selected', 'true');
    await user.click(screen.getByRole('option', { name: 'No subject' }));
    expect(api.timer.setSubject).toHaveBeenLastCalledWith(null);
    push({ ...idleTimerState(), subjectId: null });
    await user.click(box);
    expect(optionNames()).not.toContain(subjects[1]!.name);
  });

  it('works from the keyboard: arrows, Home/End, type-ahead, Enter and Escape', async () => {
    const user = userEvent.setup();
    const subjects = seedSubjects();
    render(<TimerWidget />);
    const box = screen.getByRole('combobox', { name: 'Subject' });
    act(() => box.focus());
    const active = (): string | null =>
      document.getElementById(box.getAttribute('aria-activedescendant') ?? '')?.textContent ?? null;

    await user.keyboard('{ArrowDown}');
    expect(box).toHaveAttribute('aria-expanded', 'true');
    expect(active()).toBe('No subject');
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(active()).toBe(subjects[1]!.name);
    await user.keyboard('{Enter}');
    expect(api.timer.setSubject).toHaveBeenLastCalledWith(subjects[1]!.id);
    expect(box).toHaveAttribute('aria-expanded', 'false');

    await user.keyboard('{End}');
    expect(active()).toBe(subjects[5]!.name);
    await user.keyboard('{Home}');
    expect(active()).toBe('No subject');
    await user.keyboard('{Escape}');
    expect(box).toHaveAttribute('aria-expanded', 'false');
    expect(api.timer.setSubject).toHaveBeenCalledTimes(1);

    // Typing opens the list on the first name that starts with it (names hold spaces, so Space
    // joins the search while typing is under way; Enter picks).
    await user.keyboard('comp2221');
    expect(box).toHaveAttribute('aria-expanded', 'true');
    expect(active()).toBe(subjects[2]!.name);
    await user.keyboard('{Enter}');
    expect(api.timer.setSubject).toHaveBeenLastCalledWith(subjects[2]!.id);

    // Space opens and, with no typing under way, picks.
    await user.keyboard(' ');
    expect(box).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard('{ArrowUp}{ArrowDown}');
    expect(active()).toBe(subjects[0]!.name);
    await user.keyboard(' ');
    expect(api.timer.setSubject).toHaveBeenLastCalledWith(subjects[0]!.id);
    expect(box).toHaveAttribute('aria-expanded', 'false');
  });

  it('Tab closes the list without picking and lets focus move on', async () => {
    const user = userEvent.setup();
    setup({ status: 'running', mode: 'focus' });
    render(<TimerWidget />);
    const box = screen.getByRole('combobox', { name: 'Subject' });
    act(() => box.focus());
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}');
    expect(box).toHaveAttribute('aria-expanded', 'true');
    await user.tab();
    expect(api.timer.setSubject).not.toHaveBeenCalled();
    expect(box).toHaveAttribute('aria-expanded', 'false');
    expect(box).not.toHaveFocus();
  });

  it('keeps its keys from the shortcuts while it has focus', async () => {
    const user = userEvent.setup();
    render(
      <Shortcuts>
        <TimerWidget />
      </Shortcuts>,
    );
    act(() => useStudyStore.setState({ overlay: 'stats' }));
    const box = screen.getByRole('combobox', { name: 'Subject' });
    act(() => box.focus());
    await user.keyboard(' ');
    await user.keyboard('{Escape}');
    expect(useStudyStore.getState().overlay).toBe('stats');
    await user.keyboard('r');
    expect(api.timer.start).not.toHaveBeenCalled();
    expect(api.timer.reset).not.toHaveBeenCalled();
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

  it('swallows the shortcuts while it is open, but its buttons still work from the keyboard', async () => {
    const user = userEvent.setup();
    render(
      <Shortcuts>
        <AwayPrompt />
      </Shortcuts>,
    );
    act(() => api.emitAway({ awayMs: 600_000, deadline: 0 }));
    await user.keyboard('rn1s?mf');
    await user.keyboard('{Escape}');
    expect(api.timer.reset).not.toHaveBeenCalled();
    expect(api.timer.skip).not.toHaveBeenCalled();
    expect(api.timer.setMode).not.toHaveBeenCalled();
    expect(api.app.showMini).not.toHaveBeenCalled();
    expect(api.app.toggleFullscreen).not.toHaveBeenCalled();
    expect(useStudyStore.getState().overlay).toBeNull();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();

    // Even with focus knocked out of the dialog, keys don't reach the shortcuts.
    act(() => (document.activeElement as HTMLElement).blur());
    await user.keyboard('r');
    expect(api.timer.reset).not.toHaveBeenCalled();

    await user.tab();
    expect(screen.getByRole('button', { name: 'Keep it' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(api.timer.answerAway).toHaveBeenCalledWith('keep');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    await user.keyboard('r');
    expect(api.timer.reset).toHaveBeenCalledTimes(1);
  });

  it('keeps Tab inside the dialog and gives focus back when it closes', async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button">Before</button>
        <AwayPrompt />
      </>,
    );
    const before = screen.getByRole('button', { name: 'Before' });
    act(() => before.focus());
    act(() => api.emitAway({ awayMs: 600_000, deadline: 0 }));
    const discard = screen.getByRole('button', { name: 'Discard' });
    const keep = screen.getByRole('button', { name: 'Keep it' });
    expect(discard).toHaveFocus();
    await user.tab();
    expect(keep).toHaveFocus();
    await user.tab();
    expect(discard).toHaveFocus();
    await user.tab({ shift: true });
    expect(keep).toHaveFocus();
    await user.keyboard(' ');
    expect(api.timer.answerAway).toHaveBeenCalledWith('keep');
    expect(before).toHaveFocus();
  });

  it('closes when main sends null', () => {
    render(<AwayPrompt />);
    act(() => api.emitAway({ awayMs: 600_000, deadline: 0 }));
    act(() => api.emitAway(null));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});

describe('MiniTimer', () => {
  it('names Countdown as the mode', () => {
    setup({ mode: 'countdown' });
    render(<MiniTimer />);
    expect(screen.getByText('Countdown')).toBeInTheDocument();
  });

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

  it('names the subject for screen readers, not just as a colour', () => {
    const subjects = seedSubjects();
    setup({ subjectId: subjects[0]!.id });
    const { unmount } = render(<MiniTimer />);
    expect(screen.getByText(`Subject: ${subjects[0]!.name}`)).toBeInTheDocument();
    unmount();
    setup();
    render(<MiniTimer />);
    expect(screen.getByText('Subject: none')).toBeInTheDocument();
  });

  it('re-fetches the subjects when the timer names one it has not heard of', async () => {
    render(<MiniTimer />);
    push({ ...idleTimerState(), subjectId: 1 });
    expect(api.subjects.list).not.toHaveBeenCalled();
    const fresh = [
      ...seedSubjects(),
      { id: 7, name: 'Revision', colour: '#ffffff', archived: false, sort: 6 },
    ];
    vi.mocked(api.subjects.list).mockResolvedValue(fresh);
    push({ ...idleTimerState(), subjectId: 7 });
    expect(api.subjects.list).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Subject: Revision')).toBeInTheDocument();
  });

  it('"Open StudyAt" calls showMini(false)', async () => {
    render(<MiniTimer />);
    await userEvent.click(screen.getByRole('button', { name: 'Open StudyAt' }));
    expect(api.app.showMini).toHaveBeenCalledWith(false);
  });
});

describe('mini.tsx', () => {
  afterEach(() => document.getElementById('root')?.remove());

  it('mounts the mini timer into #root and loads the store', async () => {
    const root = document.createElement('div');
    root.id = 'root';
    document.body.append(root);
    vi.resetModules();
    await act(async () => {
      await import('../mini');
    });
    expect(await screen.findByRole('timer')).toHaveTextContent('25:00');
    expect(api.timer.get).toHaveBeenCalled();
    expect(api.subjects.list).toHaveBeenCalled();
  });
});
