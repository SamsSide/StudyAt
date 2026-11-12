import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../shared/settings';
import type { Deadline, DeadlinesView, PublicSettings } from '../../shared/types';
import { Shell } from '../shell/Shell';
import { resetStudyStore, useStudyStore } from '../shell/store';
import { testRegistry } from '../shell/testRegistry';
import { installMockApi, mockApi, seedSubjects, type MockApi } from '../test/mockApi';
import { DeadlinesWidget } from './DeadlinesWidget';

// 2026-11-20 12:00 local.
const NOW = new Date(2026, 10, 20, 12, 0, 0).getTime();
const MIN = 60_000;
const stamp = (ms: number): string => {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

const deadline = (over: Partial<Deadline>): Deadline => ({
  id: 1,
  title: 'Networks',
  kind: 'exam',
  subjectId: 2,
  due: '2030-01-01T09:00',
  note: '',
  done: false,
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

const empty: DeadlinesView = { upcoming: [], past: [] };

function setup(upcoming: Deadline[] = [], past: Deadline[] = []): MockApi {
  const api = mockApi({
    deadlines: {
      list: vi.fn(({ past: p }: { past: boolean }) => Promise.resolve(p ? past : upcoming)),
      create: vi.fn(() => Promise.resolve(empty)),
      update: vi.fn(() => Promise.resolve(empty)),
      remove: vi.fn(() => Promise.resolve(empty)),
    },
  });
  installMockApi(api);
  return api;
}

beforeEach(() => {
  resetStudyStore();
  useStudyStore.setState({ subjects: seedSubjects() });
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'], now: NOW });
});
afterEach(() => vi.useRealTimers());

const open = async () => {
  const user = userEvent.setup();
  render(<DeadlinesWidget />);
  await screen.findByRole('button', { name: '+ Add' });
  return user;
};

describe('DeadlinesWidget', () => {
  it('lists rows soonest first with Exam / CW badges and live countdowns', async () => {
    setup([
      deadline({ id: 4, title: 'Late', due: stamp(NOW + 23 * 24 * 60 * MIN + 4 * 60 * MIN + 5 * MIN) }),
      deadline({ id: 3, title: 'Soon', kind: 'coursework', due: stamp(NOW + 31 * 60 * MIN + 12 * MIN) }),
      deadline({ id: 2, title: 'Imminent', due: stamp(NOW + 42 * MIN) }),
      deadline({ id: 1, title: 'Gone', kind: 'coursework', due: stamp(NOW - 5 * MIN) }),
    ]);
    // Eight seconds before the minute, so the imminent row reads 42m 08s.
    vi.setSystemTime(NOW - 8_000);
    await open();
    const rows = screen.getAllByRole('listitem');
    expect(rows.map((r) => within(r).getByText(/^(Exam|CW)$/).textContent)).toEqual([
      'CW',
      'Exam',
      'CW',
      'Exam',
    ]);
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('Gone'),
      expect.stringContaining('Imminent'),
      expect.stringContaining('Soon'),
      expect.stringContaining('Late'),
    ]);
    expect(within(rows[0]!).getByText('Due')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('42m 08s')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('31h 12m')).toBeInTheDocument();
    expect(within(rows[3]!).getByText('23d 4h')).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText('42m 07s')).toBeInTheDocument();
  });

  it('shows the past list from the Past toggle', async () => {
    const api = setup(
      [deadline({ title: 'Ahead', due: '2030-01-01T09:00' })],
      [deadline({ id: 9, title: 'Behind' })],
    );
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'Past' }));
    expect(await screen.findByText('Behind')).toBeInTheDocument();
    expect(screen.queryByText('Ahead')).not.toBeInTheDocument();
    expect(api.deadlines.list).toHaveBeenLastCalledWith({ past: true });
  });

  it('keeps only the last ten past deadlines', async () => {
    const past = Array.from({ length: 12 }, (_, i) =>
      deadline({ id: i + 1, title: `P${i + 1}`, due: `2026-10-${String(i + 1).padStart(2, '0')}T09:00` }),
    );
    setup([], past);
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'Past' }));
    await screen.findByText('P12');
    expect(screen.getAllByRole('listitem')).toHaveLength(10);
    expect(screen.queryByText('P2')).not.toBeInTheDocument();
  });

  it('pre-fills 09:00 for an exam and follows the kind until the time is edited', async () => {
    setup();
    const user = await open();
    await user.click(screen.getByRole('button', { name: '+ Add' }));
    const time = screen.getByLabelText('Time') as HTMLInputElement;
    expect(time.value).toBe('09:00');
    await user.selectOptions(screen.getByLabelText('Kind'), 'coursework');
    expect(time.value).toBe('12:00');
    fireEvent.change(time, { target: { value: '15:30' } });
    await user.selectOptions(screen.getByLabelText('Kind'), 'exam');
    expect(time.value).toBe('15:30');
  });

  it('saves a new deadline through deadlines.create', async () => {
    const api = setup();
    const user = await open();
    await user.click(screen.getByRole('button', { name: '+ Add' }));
    await user.type(screen.getByLabelText('Title'), 'Algorithms');
    await user.selectOptions(screen.getByLabelText('Subject'), '3');
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-12-14' } });
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.deadlines.create).toHaveBeenCalledWith({
        title: 'Algorithms',
        kind: 'exam',
        subjectId: 3,
        due: '2026-12-14T09:00',
        note: '',
      }),
    );
    expect(await screen.findByRole('button', { name: '+ Add' })).toBeInTheDocument();
  });

  it('refuses a 121-character title', async () => {
    const api = setup();
    const user = await open();
    await user.click(screen.getByRole('button', { name: '+ Add' }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'x'.repeat(121) } });
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-12-14' } });
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert')).toHaveTextContent('120');
    expect(api.deadlines.create).not.toHaveBeenCalled();
  });

  it('marks a deadline done', async () => {
    const api = setup([deadline({ id: 7, title: 'Networks', due: '2030-01-01T09:00' })]);
    const user = await open();
    await user.click(screen.getByRole('button', { name: /Networks/ }));
    await user.click(screen.getByRole('button', { name: 'Mark done' }));
    await waitFor(() => expect(api.deadlines.update).toHaveBeenCalledWith(7, { done: true }));
  });

  it('asks in place before deleting', async () => {
    const api = setup([deadline({ id: 7, title: 'Networks', due: '2030-01-01T09:00' })]);
    const user = await open();
    await user.click(screen.getByRole('button', { name: /Networks/ }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByText('Delete this deadline?')).toBeInTheDocument();
    expect(api.deadlines.remove).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Yes, delete' }));
    await waitFor(() => expect(api.deadlines.remove).toHaveBeenCalledWith(7));
  });
});

describe('Deadlines in the shell', () => {
  it('"Hide background" saves widgets.deadlines.bare and the toggle becomes "Show background"', async () => {
    vi.useRealTimers();
    const { spotifyTokens: _t, ...rest } = structuredClone(DEFAULT_SETTINGS);
    const settings: PublicSettings = {
      ...rest,
      onboarded: true,
      widgets: { ...rest.widgets, deadlines: { ...rest.widgets.deadlines, open: true } },
    };
    const api = mockApi({
      settings: {
        get: vi.fn(() => Promise.resolve(settings)),
        set: vi.fn((patch) =>
          Promise.resolve({ ...settings, ...patch, widgets: { ...settings.widgets, ...patch.widgets } }),
        ),
      },
    });
    installMockApi(api);
    const user = userEvent.setup();
    render(<Shell registry={testRegistry()} />);
    await user.click(await screen.findByRole('button', { name: 'Hide background' }));
    await waitFor(() =>
      expect(api.settings.set).toHaveBeenCalledWith({
        widgets: { deadlines: expect.objectContaining({ open: true, bare: true }) },
      }),
    );
    expect(await screen.findByRole('button', { name: 'Show background' })).toBeInTheDocument();
  });
});
