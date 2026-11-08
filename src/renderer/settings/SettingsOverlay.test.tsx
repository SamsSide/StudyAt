import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../shared/settings';
import type { PublicSettings } from '../../shared/types';
import { installMockApi, mockApi, type MockApi, seedSubjects } from '../test/mockApi';
import { resetStudyStore, useStudyStore } from '../shell/store';

vi.mock('../audio/engine', () => ({
  audioEngine: { playChime: vi.fn(() => Promise.resolve()) },
}));

import { audioEngine } from '../audio/engine';
import { SettingsOverlay } from './SettingsOverlay';

const publicDefaults = (): PublicSettings => {
  const { spotifyTokens: _t, ...rest } = structuredClone(DEFAULT_SETTINGS);
  return rest;
};

function setup(api: MockApi = mockApi(), settings: PublicSettings = publicDefaults()) {
  installMockApi(api);
  useStudyStore.setState({ settings, subjects: seedSubjects() });
  render(<SettingsOverlay />);
  return api;
}

const openSection = async (name: string) => {
  await userEvent.click(screen.getByRole('tab', { name }));
};

beforeEach(() => {
  resetStudyStore();
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('SettingsOverlay', () => {
  it('lists the eight sections', () => {
    setup();
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'Timer',
      'Chimes',
      'Goals & streak',
      'Subjects',
      'Spotify',
      'Shortcuts',
      'Data',
      'General',
    ]);
  });

  it('timer minutes input clamps to 1..180 and saves', async () => {
    const api = setup();
    const input = screen.getByLabelText('Focus length');
    await userEvent.clear(input);
    await userEvent.type(input, '999');
    await userEvent.tab();
    expect(api.settings.set).toHaveBeenCalledWith({ focusMinutes: 180 });
    expect(input).toHaveValue(180);

    await userEvent.clear(input);
    await userEvent.type(input, '0');
    await userEvent.tab();
    expect(api.settings.set).toHaveBeenLastCalledWith({ focusMinutes: 1 });
  });

  it('chime selects list Bell, Singing bowl, Wood block, Marimba, Soft digital and Custom file…', async () => {
    setup();
    await openSection('Chimes');
    const select = screen.getByLabelText('Focus ends');
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Bell', 'Singing bowl', 'Wood block', 'Marimba', 'Soft digital', 'Custom file…']);
  });

  it('changing a chime saves it', async () => {
    const api = setup();
    await openSection('Chimes');
    await userEvent.selectOptions(screen.getByLabelText('Break ends'), 'bowl');
    expect(api.settings.set).toHaveBeenCalledWith({ chimeBreakEnd: 'bowl' });
  });

  it('custom file adds a sound then sets file:<soundId>', async () => {
    const sound = {
      id: 7,
      name: 'ding',
      kind: 'file' as const,
      source: 'x',
      builtin: false,
      sort: 0,
      missing: false,
    };
    const api = mockApi({
      sounds: {
        list: vi.fn(() => Promise.resolve([])),
        addFiles: vi.fn(() => Promise.resolve([sound])),
      },
    });
    setup(api);
    await openSection('Chimes');
    await userEvent.selectOptions(screen.getByLabelText('Focus ends'), 'custom');
    await waitFor(() =>
      expect(api.settings.set).toHaveBeenCalledWith({
        chimeFocusEnd: 'file:7',
      }),
    );
  });

  it('preview button plays the selected chime', async () => {
    setup();
    await openSection('Chimes');
    await userEvent.click(screen.getByRole('button', { name: 'Preview Focus ends' }));
    expect(audioEngine.playChime).toHaveBeenCalledWith('bell', {
      volume: 0.7,
      repeat: 1,
      customUrl: undefined,
    });
    await userEvent.click(screen.getByRole('button', { name: 'Preview Break ends' }));
    expect(audioEngine.playChime).toHaveBeenLastCalledWith('marimba', {
      volume: 0.7,
      repeat: 1,
      customUrl: undefined,
    });
  });

  it('goals: the daily goal saves', async () => {
    const api = setup();
    await openSection('Goals & streak');
    const input = screen.getByLabelText('Daily goal');
    await userEvent.clear(input);
    await userEvent.type(input, '90');
    await userEvent.tab();
    expect(api.settings.set).toHaveBeenCalledWith({ goalMinutes: 90 });
  });

  it('subjects: add, rename, recolour, archive', async () => {
    const api = setup();
    await openSection('Subjects');

    await userEvent.type(screen.getByLabelText('New subject'), 'Linear Algebra');
    await userEvent.click(screen.getByRole('button', { name: 'New subject colour #e57aa8' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(api.subjects.create).toHaveBeenCalledWith({
      name: 'Linear Algebra',
      colour: '#e57aa8',
    });

    const first = seedSubjects()[0]!;
    const name = screen.getByLabelText(`Name of ${first.name}`);
    await userEvent.clear(name);
    await userEvent.type(name, 'Theory');
    await userEvent.tab();
    expect(api.subjects.update).toHaveBeenCalledWith(first.id, {
      name: 'Theory',
    });

    await userEvent.click(screen.getByRole('button', { name: `Colour for ${first.name} #5ccfb0` }));
    expect(api.subjects.update).toHaveBeenCalledWith(first.id, {
      colour: '#5ccfb0',
    });

    await userEvent.click(screen.getByRole('button', { name: `Archive ${first.name}` }));
    expect(api.subjects.archive).toHaveBeenCalledWith(first.id);
  });

  it('subjects: archived ones are listed under Archived', async () => {
    setup();
    useStudyStore.setState({
      subjects: seedSubjects().map((s, i) => ({ ...s, archived: i === 0 })),
    });
    await openSection('Subjects');
    const archived = await screen.findByRole('list', {
      name: 'Archived subjects',
    });
    expect(within(archived).getByText('COMP2181 Theory of Computation')).toBeInTheDocument();
  });

  it('spotify section shows the four setup steps verbatim and the redirect URI', async () => {
    setup();
    await openSection('Spotify');
    expect(screen.getByText('Go to developer.spotify.com/dashboard and log in.')).toBeInTheDocument();
    expect(screen.getByText('Create an app. Any name works, e.g. StudyAt.')).toBeInTheDocument();
    expect(screen.getByText('http://127.0.0.1:43821/callback')).toBeInTheDocument();
    expect(screen.getByText(/Add this Redirect URI:/)).toBeInTheDocument();
    expect(screen.getByText("Tick 'Web API', save, then copy the Client ID here.")).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
  });

  it('spotify: the Client ID saves', async () => {
    const api = setup();
    await openSection('Spotify');
    await userEvent.type(screen.getByLabelText('Client ID'), 'abc123');
    await userEvent.tab();
    expect(api.settings.set).toHaveBeenCalledWith({
      spotifyClientId: 'abc123',
    });
  });

  it('connect shows port-in-use message on that error', async () => {
    const api = mockApi({
      spotify: {
        connect: vi.fn(() => Promise.reject(new Error('Port 43821 is in use (EADDRINUSE)'))),
      },
    });
    setup(api, { ...publicDefaults(), spotifyClientId: 'abc' });
    await openSection('Spotify');
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Port 43821 is in use — close the other app and retry',
    );
  });

  it('shortcuts section shows global hotkey and registration error', async () => {
    const api = mockApi({
      settings: {
        set: vi.fn(() => Promise.reject(new Error('Ctrl+Alt+K is already used by another app'))),
      },
    });
    setup(api);
    await openSection('Shortcuts');
    const field = screen.getByLabelText('Show or hide StudyAt');
    expect(field).toHaveValue('Ctrl+Alt+P');
    fireEvent.keyDown(field, { key: 'k', ctrlKey: true, altKey: true });
    expect(await screen.findByRole('alert')).toHaveTextContent('Ctrl+Alt+K is already used by another app');
    expect(api.settings.set).toHaveBeenCalledWith({
      globalHotkey: 'Ctrl+Alt+K',
    });
    expect(field).toHaveValue('Ctrl+Alt+P');
  });

  it('shortcuts: Backspace turns the hotkey off', async () => {
    const api = setup();
    await openSection('Shortcuts');
    fireEvent.keyDown(screen.getByLabelText('Show or hide StudyAt'), {
      key: 'Backspace',
    });
    await waitFor(() => expect(api.settings.set).toHaveBeenCalledWith({ globalHotkey: '' }));
  });

  it('data: export buttons call exportJson/exportCsv; restore asks for confirmation', async () => {
    const api = mockApi({
      data: {
        listBackups: vi.fn(() =>
          Promise.resolve([
            {
              name: 'daily-2026-11-07.sqlite',
              size: 20480,
              createdAt: 1_762_473_600_000,
            },
          ]),
        ),
      },
    });
    setup(api);
    await openSection('Data');
    await userEvent.click(screen.getByRole('button', { name: 'Export JSON' }));
    await userEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    await userEvent.click(screen.getByRole('button', { name: 'Open data folder' }));
    expect(api.data.exportJson).toHaveBeenCalledTimes(1);
    expect(api.data.exportCsv).toHaveBeenCalledTimes(1);
    expect(api.data.openDataFolder).toHaveBeenCalledTimes(1);

    await userEvent.click(
      await screen.findByRole('button', {
        name: 'Restore daily-2026-11-07.sqlite',
      }),
    );
    expect(api.data.restoreBackup).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      'Restore daily-2026-11-07.sqlite? StudyAt will restart with that backup. Your current data is kept as a backup first.',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(api.data.restoreBackup).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Restore daily-2026-11-07.sqlite' }));
    await userEvent.click(screen.getByRole('button', { name: 'Restore' }));
    expect(api.data.restoreBackup).toHaveBeenCalledWith('daily-2026-11-07.sqlite');
  });

  it('general: launch at start-up toggles setting', async () => {
    const api = setup();
    await openSection('General');
    const toggle = screen.getByRole('switch', { name: 'Launch at start-up' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(toggle);
    expect(api.settings.set).toHaveBeenCalledWith({ launchAtStartup: true });
  });

  it('general: auto-hide delay and mini timer save', async () => {
    const api = setup();
    await openSection('General');
    const delay = screen.getByLabelText('Hide the controls after');
    await userEvent.clear(delay);
    await userEvent.type(delay, '12');
    await userEvent.tab();
    expect(api.settings.set).toHaveBeenCalledWith({ autoHideSeconds: 12 });
    await userEvent.click(
      screen.getByRole('switch', {
        name: 'Show the mini timer when the window is hidden',
      }),
    );
    expect(api.settings.set).toHaveBeenCalledWith({ miniWhenHidden: false });
  });
});
