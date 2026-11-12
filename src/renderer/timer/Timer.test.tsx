import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatClock as sharedFormatClock } from '../../shared/clock';
import { addDays, dayKeyOf } from '../../core/time';
import { INTENTION_MAX, TASK_GONE } from '../../shared/planner';
import { DEFAULT_SETTINGS } from '../../shared/settings';
import type { TimerState } from '../../shared/types';
import { MiniTimer } from '../mini/MiniTimer';
import { resetStudyStore, useStudyStore } from '../shell/store';
import { useShortcuts } from '../shell/useShortcuts';
import {
  idleTimerState,
  installMockApi,
  minimalPlannerTask,
  mockApi,
  seedSubjects,
  type MockApi,
} from '../test/mockApi';
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
  const NOW = new Date(2026, 10, 11, 12, 0).getTime();
  // Only Date is faked, so userEvent and the promises keep running normally.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
  const todayKey = dayKeyOf(NOW, DEFAULT_SETTINGS.rolloverHour);
  const tomorrow = addDays(todayKey, 1);
  const seedPlanner = (): void => {
    vi.mocked(api.planner.week).mockResolvedValue({
      from: todayKey,
      to: todayKey,
      deadlines: [],
      studiedMs: {},
      tasks: [
        minimalPlannerTask({ id: 1, title: 'Read ch. 3', day: todayKey }),
        minimalPlannerTask({ id: 2, title: 'Old', day: todayKey, done: true }),
        minimalPlannerTask({ id: 3, title: 'Lab report', day: tomorrow }),
      ],
    });
    vi.mocked(api.planner.lists).mockResolvedValue({
      lists: [],
      deadlines: [],
      tasks: [
        minimalPlannerTask({ id: 4, title: 'Essay plan', day: null, listId: 9 }),
        minimalPlannerTask({ id: 5, title: 'Lab safety quiz', day: null, listId: 9 }),
        minimalPlannerTask({ id: 6, title: 'Finished', day: null, listId: 9, done: true }),
      ],
    });
  };

  it('groups open tasks Today, This week, Lists after "No task", and picks one', async () => {
    const user = userEvent.setup();
    seedPlanner();
    render(<TimerWidget />);
    const box = screen.getByRole('combobox', { name: 'Task' });
    expect(box).toHaveTextContent('No task');
    await user.click(box);
    await screen.findByRole('option', { name: 'Essay plan' });
    expect(optionNames()).toEqual(['No task', 'Read ch. 3', 'Lab report', 'Essay plan', 'Lab safety quiz']);
    const headings = ['Today', 'This week', 'Lists'].map((h) => screen.getByText(h));
    headings.forEach((h, i) => {
      const next = headings[i + 1];
      if (next) expect(h.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
    expect(screen.getByRole('option', { name: 'Essay plan' })).toHaveAttribute('title', 'Essay plan');
    await user.click(screen.getByRole('option', { name: 'Essay plan' }));
    expect(api.timer.setTask).toHaveBeenCalledWith(4);
  });

  /** Opens the task list for a box drawn at half size (so CSS px are twice window px). */
  const openAt = async (top: number, innerHeight: number) => {
    const user = userEvent.setup();
    seedPlanner();
    render(<TimerWidget />);
    const box = screen.getByRole('combobox', { name: 'Task' });
    Object.defineProperty(box, 'offsetHeight', { configurable: true, value: 32 });
    vi.spyOn(box, 'getBoundingClientRect').mockReturnValue(
      DOMRect.fromRect({ x: 0, y: top, width: 100, height: 16 }),
    );
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(innerHeight);
    await user.click(box);
    return screen.getByRole('listbox', { name: 'Task' });
  };

  it('the open task list scrolls within the room the window has, measured at the widget scale', async () => {
    // Below: (300 - 196) / 0.5 = 208 CSS px, short of the 376 the list wants; above: 180 / 0.5 = 360.
    // So it opens upwards into 360 - 72 = 288 CSS px.
    const list = await openAt(180, 300);
    expect(list).toHaveStyle({ maxHeight: '288px' });
    expect(list.parentElement?.className).toMatch(/upwards/i);
  });

  it('opens downwards when the room below fits the whole list, even with more above', async () => {
    // Below: (500 - 196) / 0.5 = 608 CSS px; above: 180 / 0.5 = 360.
    const list = await openAt(180, 500);
    expect(list).toHaveStyle({ maxHeight: '304px' });
    expect(list.parentElement?.className).not.toMatch(/upwards/i);
  });

  it('opens towards the side with more room when neither fits the whole list', async () => {
    // Below: (150 - 36) / 0.5 = 228 CSS px, short of 376; above: 20 / 0.5 = 40. So down, into 228 - 72 = 156.
    const list = await openAt(20, 150);
    expect(list).toHaveStyle({ maxHeight: '156px' });
    expect(list.parentElement?.className).not.toMatch(/upwards/i);
  });

  it('typing filters the titles', async () => {
    const user = userEvent.setup();
    seedPlanner();
    render(<TimerWidget />);
    await user.click(screen.getByRole('combobox', { name: 'Task' }));
    await screen.findByRole('option', { name: 'Essay plan' });
    await user.type(screen.getByLabelText('Find a task'), 'lab');
    expect(optionNames()).toEqual(['Lab report', 'Lab safety quiz']);
    await user.keyboard('{ArrowDown}{Enter}');
    expect(api.timer.setTask).toHaveBeenCalledWith(5);
  });

  it('opens on the held task, so Enter, Enter does not swap it for "No task"', async () => {
    const user = userEvent.setup();
    setup({ status: 'running', taskId: 4, taskText: 'Essay plan' });
    seedPlanner();
    render(<TimerWidget />);
    screen.getByRole('combobox', { name: 'Task' }).focus();
    await user.keyboard('{Enter}');
    // Once the fetch reorders the list the held task is still the highlighted one.
    await screen.findByRole('option', { name: 'Read ch. 3' });
    expect(screen.getByRole('option', { name: 'Essay plan' }).className).toMatch(/activeOption/);
    await user.keyboard('{Enter}');
    expect(api.timer.setTask).not.toHaveBeenCalled();
  });

  it('a pick that main rejects as gone says the task no longer exists', async () => {
    const user = userEvent.setup();
    seedPlanner();
    vi.mocked(api.timer.setTask).mockRejectedValue(new Error(TASK_GONE));
    render(<TimerWidget />);
    await user.click(screen.getByRole('combobox', { name: 'Task' }));
    await user.click(await screen.findByRole('option', { name: 'Essay plan' }));
    expect(await screen.findByText('That task no longer exists.')).toBeInTheDocument();
  });

  it('any other rejection says the task could not be set', async () => {
    const user = userEvent.setup();
    seedPlanner();
    vi.mocked(api.timer.setTask).mockRejectedValue(new Error('boom'));
    render(<TimerWidget />);
    await user.click(screen.getByRole('combobox', { name: 'Task' }));
    await user.click(await screen.findByRole('option', { name: 'Essay plan' }));
    expect(await screen.findByText("Couldn't set that task.")).toBeInTheDocument();
    expect(screen.queryByText('That task no longer exists.')).toBeNull();
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
    seedPlanner();
    render(<TimerWidget />);
    expect(screen.getByRole('combobox', { name: 'Task' })).toHaveTextContent('Old');
    await userEvent.click(screen.getByRole('combobox', { name: 'Task' }));
    await waitFor(() => expect(api.planner.week).toHaveBeenCalled());
    expect(screen.getByRole('combobox', { name: 'Task' })).toHaveTextContent('Old');
    expect(api.timer.setTask).not.toHaveBeenCalled();
  });
});

describe('IntentionField and OutcomeAsk', () => {
  const field = (): HTMLInputElement => screen.getByPlaceholderText('By the end I will…');

  it('caps the text at 140 code points, so an emoji counts as one', async () => {
    const user = userEvent.setup();
    render(<TimerWidget />);
    expect(INTENTION_MAX).toBe(140);
    await user.click(field());
    await user.paste('😀'.repeat(INTENTION_MAX));
    expect([...field().value]).toHaveLength(INTENTION_MAX);
    await user.paste('😀');
    expect(field().value).toBe('😀'.repeat(INTENTION_MAX));
  });

  it('drops the draft when the field hides, so it shows the text from main on return', async () => {
    const user = userEvent.setup();
    render(<TimerWidget />);
    await user.type(field(), 'Draft text{Enter}');
    act(() => {
      useStudyStore.setState({ timer: { ...useStudyStore.getState().timer, mode: 'short' } });
    });
    expect(screen.queryByPlaceholderText('By the end I will…')).toBeNull();
    act(() => {
      useStudyStore.setState({ timer: { ...useStudyStore.getState().timer, mode: 'focus' } });
    });
    expect(field()).toHaveValue('');
  });

  it('shows a newer intention from main over a draft', async () => {
    const user = userEvent.setup();
    render(<TimerWidget />);
    await user.type(field(), 'Half typed');
    act(() => {
      useStudyStore.setState({ timer: { ...useStudyStore.getState().timer, intention: 'From main' } });
    });
    expect(field()).toHaveValue('From main');
  });

  it('refuses an insert past the cap instead of dropping the end', () => {
    render(<TimerWidget />);
    const full = 'a'.repeat(INTENTION_MAX - 1) + 'z';
    fireEvent.change(field(), { target: { value: full } });
    expect(field()).toHaveValue(full);
    // One more character in the middle would push the final 'z' off the end: the change is refused.
    fireEvent.change(field(), { target: { value: 'a'.repeat(10) + 'X' + full.slice(10) } });
    expect(field()).toHaveValue(full);
    // Emoji count as one each.
    const emoji = '😀'.repeat(INTENTION_MAX);
    fireEvent.change(field(), { target: { value: emoji } });
    expect(field()).toHaveValue(emoji);
  });

  it('has the placeholder, and Enter saves the text', async () => {
    const user = userEvent.setup();
    render(<TimerWidget />);
    await user.type(field(), 'Finish Q1–3{Enter}');
    expect(api.timer.setIntention).toHaveBeenCalledTimes(1);
    expect(api.timer.setIntention).toHaveBeenCalledWith('Finish Q1–3');
    await user.tab(); // the blur after Enter sends nothing more
    expect(api.timer.setIntention).toHaveBeenCalledTimes(1);
  });

  it('saves on blur, shows the held intention, and clearing it sends null', async () => {
    const user = userEvent.setup();
    setup({ intention: 'Finish Q1–3' });
    render(<TimerWidget />);
    expect(field()).toHaveValue('Finish Q1–3');
    await user.clear(field());
    await user.tab();
    expect(api.timer.setIntention).toHaveBeenCalledWith(null);
  });

  it('does not save text that has not changed', async () => {
    const user = userEvent.setup();
    setup({ intention: 'Same' });
    render(<TimerWidget />);
    await user.click(field());
    await user.tab();
    expect(api.timer.setIntention).not.toHaveBeenCalled();
  });

  it('is hidden in a break', () => {
    setup({ mode: 'short' });
    render(<TimerWidget />);
    expect(screen.queryByPlaceholderText('By the end I will…')).toBeNull();
  });

  const ask = { pomodoroId: 'p1', intention: 'Finish Q1–3' };

  it('asks "Did you do it?" with the intention, and sends the answer', async () => {
    const user = userEvent.setup();
    setup({ mode: 'short', askOutcome: ask });
    render(<TimerWidget />);
    const group = screen.getByRole('group', { name: 'Did you do it?' });
    expect(group).toHaveTextContent('Finish Q1–3');
    await user.click(within(group).getByRole('button', { name: 'Partly' }));
    expect(api.timer.setOutcome).toHaveBeenCalledWith('p1', 'partly');
    await user.click(within(group).getByRole('button', { name: 'Skip the question' }));
    expect(api.timer.setOutcome).toHaveBeenCalledWith('p1', null);
    await user.click(within(group).getByRole('button', { name: 'Done' }));
    await user.click(within(group).getByRole('button', { name: 'Not' }));
    expect(api.timer.setOutcome).toHaveBeenCalledWith('p1', 'done');
    expect(api.timer.setOutcome).toHaveBeenCalledWith('p1', 'not');
  });

  it('shows neither the field nor the question when the setting is off', async () => {
    setup({ askOutcome: ask });
    useStudyStore.setState({ settings: { ...(await api.settings.get()), sessionIntention: false } });
    render(<TimerWidget />);
    expect(screen.queryByPlaceholderText('By the end I will…')).toBeNull();
    expect(screen.queryByText('Did you do it?')).toBeNull();
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
