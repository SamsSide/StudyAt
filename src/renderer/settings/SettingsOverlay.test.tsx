import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  it('lists the ten sections', () => {
    setup();
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'Timer',
      'Chimes',
      'Goals & streak',
      'Subjects',
      'Spotify',
      'Calendar',
      'Weather',
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
        connect: vi.fn(() =>
          Promise.reject(
            new Error(
              "Error invoking remote method 'spotify:connect': Error: Port 43821 is in use (EADDRINUSE)",
            ),
          ),
        ),
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
        set: vi.fn(() =>
          Promise.reject(
            new Error(
              "Error invoking remote method 'settings:set': Error: Ctrl+Alt+K is already used by another app",
            ),
          ),
        ),
      },
    });
    setup(api);
    await openSection('Shortcuts');
    const field = screen.getByLabelText('Start or pause the timer');
    expect(field).toHaveValue('Ctrl+Alt+P');
    fireEvent.keyDown(field, { key: 'k', code: 'KeyK', ctrlKey: true, altKey: true });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Ctrl+Alt+K is already used by another app');
    expect(alert).not.toHaveTextContent('Error invoking');
    expect(api.settings.set).toHaveBeenCalledWith({
      globalHotkey: 'Ctrl+Alt+K',
    });
    expect(field).toHaveValue('Ctrl+Alt+P');
  });

  it('shortcuts: Backspace turns the hotkey off', async () => {
    const api = setup();
    await openSection('Shortcuts');
    fireEvent.keyDown(screen.getByLabelText('Start or pause the timer'), {
      key: 'Backspace',
    });
    await waitFor(() => expect(api.settings.set).toHaveBeenCalledWith({ globalHotkey: '' }));
  });

  it('data: export buttons call exportJson/exportCsv; restore goes straight to main', async () => {
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

    // One confirmation only: main's native dialog. The overlay asks nothing itself.
    await userEvent.click(
      await screen.findByRole('button', {
        name: 'Restore daily-2026-11-07.sqlite',
      }),
    );
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(api.data.restoreBackup).toHaveBeenCalledTimes(1);
    expect(api.data.restoreBackup).toHaveBeenCalledWith('daily-2026-11-07.sqlite');
  });

  it("data: a refused restore shows main's clean message", async () => {
    const api = mockApi({
      data: {
        listBackups: vi.fn(() =>
          Promise.resolve([{ name: 'b.sqlite', size: 10, createdAt: 1_762_473_600_000 }]),
        ),
        restoreBackup: vi.fn(() =>
          Promise.reject(
            new Error("Error invoking remote method 'data:restoreBackup': Error: That backup is damaged"),
          ),
        ),
      },
    });
    setup(api);
    await openSection('Data');
    await userEvent.click(await screen.findByRole('button', { name: 'Restore b.sqlite' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't restore that backup. That backup is damaged",
    );
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

  it('shortcuts: keys come from the physical key, so Shift+digit is still the digit', async () => {
    const api = setup();
    await openSection('Shortcuts');
    const field = screen.getByLabelText('Start or pause the timer');
    fireEvent.keyDown(field, { key: '!', code: 'Digit1', ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(api.settings.set).toHaveBeenCalledWith({ globalHotkey: 'Ctrl+Shift+1' }));
    fireEvent.keyDown(field, { key: '+', code: 'Equal', ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(api.settings.set).toHaveBeenCalledWith({ globalHotkey: 'Ctrl+Shift+=' }));
    fireEvent.keyDown(field, { key: 'a', code: 'KeyA', altKey: true });
    await waitFor(() => expect(api.settings.set).toHaveBeenCalledWith({ globalHotkey: 'Alt+A' }));
  });

  it('a number that fails to save goes back to the saved value with a short message', async () => {
    const api = mockApi({ settings: { set: vi.fn(() => Promise.reject(new Error('disk full'))) } });
    setup(api);
    const input = screen.getByLabelText('Focus length');
    await userEvent.clear(input);
    await userEvent.type(input, '40');
    await userEvent.tab();
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't save that");
    expect(input).toHaveValue(25);
  });

  it('the chime volume saves once, after the slider settles', async () => {
    vi.useFakeTimers();
    try {
      const api = setup();
      fireEvent.click(screen.getByRole('tab', { name: 'Chimes' }));
      const slider = screen.getByLabelText('Volume');
      fireEvent.change(slider, { target: { value: '0.3' } });
      fireEvent.change(slider, { target: { value: '0.2' } });
      fireEvent.change(slider, { target: { value: '0.1' } });
      expect(slider).toHaveValue('0.1');
      expect(api.settings.set).not.toHaveBeenCalled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      expect(api.settings.set).toHaveBeenCalledTimes(1);
      expect(api.settings.set).toHaveBeenCalledWith({ chimeVolume: 0.1 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('the volume slider never jumps back while a newer value is waiting to save', async () => {
    vi.useFakeTimers();
    try {
      let answerFirst: (s: PublicSettings) => void = () => undefined;
      const set = vi.fn((patch: { chimeVolume?: number }) =>
        patch.chimeVolume === 0.3
          ? new Promise<PublicSettings>((resolve) => {
              answerFirst = resolve;
            })
          : Promise.resolve({ ...publicDefaults(), ...patch }),
      );
      setup(mockApi({ settings: { set } }));
      fireEvent.click(screen.getByRole('tab', { name: 'Chimes' }));
      const slider = screen.getByLabelText('Volume');
      fireEvent.change(slider, { target: { value: '0.3' } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      expect(set).toHaveBeenCalledWith({ chimeVolume: 0.3 });
      fireEvent.change(slider, { target: { value: '0.6' } });
      await act(async () => {
        answerFirst({ ...publicDefaults(), chimeVolume: 0.3 });
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(slider).toHaveValue('0.6');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      expect(set).toHaveBeenLastCalledWith({ chimeVolume: 0.6 });
      expect(slider).toHaveValue('0.6');
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaving the chimes section mid-drag still saves where the slider stopped', async () => {
    vi.useFakeTimers();
    try {
      const api = setup();
      fireEvent.click(screen.getByRole('tab', { name: 'Chimes' }));
      fireEvent.change(screen.getByLabelText('Volume'), { target: { value: '0.4' } });
      fireEvent.click(screen.getByRole('tab', { name: 'Timer' }));
      expect(api.settings.set).toHaveBeenCalledTimes(1);
      expect(api.settings.set).toHaveBeenCalledWith({ chimeVolume: 0.4 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('data: a daily backup shows its date only; other backups keep their time', async () => {
    const api = mockApi({
      data: {
        listBackups: vi.fn(() =>
          Promise.resolve([
            {
              name: 'daily-2026-11-07.sqlite',
              size: 20480,
              createdAt: new Date(2026, 10, 7, 0, 0).getTime(),
            },
            {
              name: 'pre-migration-v2-2026-11-06.sqlite',
              size: 20480,
              createdAt: new Date(2026, 10, 6, 14, 30).getTime(),
            },
          ]),
        ),
      },
    });
    setup(api);
    await openSection('Data');
    const list = await screen.findByRole('list', { name: 'Backups' });
    const items = within(list).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('7 Nov 2026 · 20 KB');
    expect(items[0]).not.toHaveTextContent(/\d{2}:\d{2}/);
    expect(items[1]).toHaveTextContent('6 Nov 2026, 14:30 · 20 KB');
  });

  it('spotify: Connect waits for a Client ID and says so', async () => {
    setup();
    await openSection('Spotify');
    const connect = screen.getByRole('button', { name: 'Connect' });
    expect(connect).toBeDisabled();
    expect(connect).toHaveAccessibleDescription('Paste your Client ID to connect.');
    await userEvent.type(screen.getByLabelText('Client ID'), 'abc123');
    expect(connect).toBeEnabled();
    expect(screen.queryByText('Paste your Client ID to connect.')).not.toBeInTheDocument();
  });

  it('a custom chime that is already a sound is offered in the list and the user is told', async () => {
    const existing = {
      id: 3,
      name: 'ding',
      kind: 'file' as const,
      source: 'C:/ding.mp3',
      builtin: false,
      sort: 0,
      missing: false,
    };
    const api = mockApi({
      sounds: {
        list: vi.fn(() => Promise.resolve([existing])),
        addFiles: vi.fn(() => Promise.resolve([existing])),
      },
    });
    setup(api);
    await openSection('Chimes');
    const select = screen.getByLabelText('Focus ends');
    await waitFor(() => expect(within(select).getByRole('option', { name: 'ding' })).toBeInTheDocument());
    await userEvent.selectOptions(select, 'custom');
    // Main can't say whether the dialog was cancelled, so this is a quiet note, not an alert.
    expect(await screen.findByRole('status')).toHaveTextContent('already in your sounds');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(api.settings.set).not.toHaveBeenCalled();
    await userEvent.selectOptions(select, 'file:3');
    expect(api.settings.set).toHaveBeenCalledWith({ chimeFocusEnd: 'file:3' });
  });

  it('Home and End jump to the first and last section', async () => {
    setup();
    screen.getByRole('tab', { name: 'Timer' }).focus();
    await userEvent.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'General' })).toHaveFocus();
    expect(screen.getByRole('tab', { name: 'General' })).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{Home}');
    expect(screen.getByRole('tab', { name: 'Timer' })).toHaveFocus();
  });

  describe('Calendar', () => {
    const ICS = 'https://calendar.google.com/calendar/ical/me%40gmail.com/private-abc/basic.ics';
    const ICS2 = 'https://calendar.google.com/calendar/ical/b/private-def/basic.ics';
    const linked = { configured: true, calendars: [{ name: 'Lectures', colour: '#7c9cff' }] };

    it('shows the three steps and the privacy note verbatim', async () => {
      setup();
      await openSection('Calendar');
      expect(screen.getByText('Open Google Calendar on the web and go to Settings.')).toBeInTheDocument();
      expect(
        screen.getByText(
          "Under 'Settings for my calendars', choose your calendar, then 'Integrate calendar'.",
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByText("Copy the 'Secret address in iCal format' and paste it here."),
      ).toBeInTheDocument();
      expect(
        screen.getByText('This link is private — StudyAt keeps it encrypted on this PC.'),
      ).toBeInTheDocument();
    });

    it('address fields are password-style, and up to five can be added and removed', async () => {
      setup();
      await openSection('Calendar');
      expect(screen.getByLabelText('Calendar address 1')).toHaveAttribute('type', 'password');
      const add = screen.getByRole('button', { name: 'Add calendar' });
      for (let i = 0; i < 4; i++) await userEvent.click(add);
      expect(screen.getByLabelText('Calendar address 5')).toBeInTheDocument();
      expect(add).toBeDisabled();
      await userEvent.click(screen.getByRole('button', { name: 'Remove calendar address 5' }));
      expect(screen.queryByLabelText('Calendar address 5')).toBeNull();
      expect(add).toBeEnabled();
    });

    it('Save sends the trimmed, non-blank addresses once, then shows the calendars', async () => {
      const api = mockApi({ calendar: { setUrls: vi.fn(() => Promise.resolve(linked)) } });
      setup(api);
      await openSection('Calendar');
      const save = screen.getByRole('button', { name: 'Save' });
      expect(save).toBeDisabled();
      await userEvent.type(screen.getByLabelText('Calendar address 1'), `  ${ICS} `);
      await userEvent.click(screen.getByRole('button', { name: 'Add calendar' }));
      await userEvent.click(screen.getByRole('button', { name: 'Add calendar' }));
      await userEvent.type(screen.getByLabelText('Calendar address 3'), ICS2);
      await userEvent.click(save);
      expect(api.calendar.setUrls).toHaveBeenCalledTimes(1);
      expect(api.calendar.setUrls).toHaveBeenCalledWith([ICS, ICS2]);
      const list = await screen.findByRole('list', { name: 'Connected calendars' });
      expect(within(list).getByText('Lectures')).toBeInTheDocument();
      // The secret leaves the page once saved.
      expect(screen.getByLabelText('Calendar address 1')).toHaveValue('');
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    });

    it('does not call setUrls again for the same list', async () => {
      const api = mockApi({ calendar: { setUrls: vi.fn(() => Promise.resolve(linked)) } });
      setup(api);
      await openSection('Calendar');
      await userEvent.type(screen.getByLabelText('Calendar address 1'), ICS);
      await userEvent.click(screen.getByRole('button', { name: 'Save' }));
      await screen.findByRole('list', { name: 'Connected calendars' });
      await userEvent.type(screen.getByLabelText('Calendar address 1'), ` ${ICS}`);
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    });

    it("shows main's refusal without the IPC prefix", async () => {
      const api = mockApi({
        calendar: {
          setUrls: vi.fn(() =>
            Promise.reject(
              new Error(
                "Error invoking remote method 'calendar:setUrls': Error: Calendar addresses must start with https://",
              ),
            ),
          ),
        },
      });
      setup(api);
      await openSection('Calendar');
      await userEvent.type(screen.getByLabelText('Calendar address 1'), 'http://x');
      await userEvent.click(screen.getByRole('button', { name: 'Save' }));
      expect(await screen.findByRole('alert')).toHaveTextContent(
        /^Calendar addresses must start with https:\/\/$/,
      );
    });

    it('lists the connected calendars and can remove them all', async () => {
      const api = mockApi({ calendar: { status: vi.fn(() => Promise.resolve(linked)) } });
      setup(api);
      await openSection('Calendar');
      const list = await screen.findByRole('list', { name: 'Connected calendars' });
      expect(within(list).getByText('Lectures')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Remove all calendars' }));
      expect(api.calendar.setUrls).toHaveBeenCalledWith([]);
      await waitFor(() => expect(screen.queryByRole('list', { name: 'Connected calendars' })).toBeNull());
    });
  });

  describe('Weather', () => {
    const DURHAM = {
      name: 'Durham',
      latitude: 54.78,
      longitude: -1.57,
      country: 'United Kingdom',
      admin1: 'England',
    };

    it('searches 300 ms after typing stops and saves the picked place', async () => {
      const after = { ...publicDefaults(), weatherPlace: DURHAM };
      const api = mockApi({
        weather: {
          searchPlaces: vi.fn(() => Promise.resolve([DURHAM])),
          setPlace: vi.fn(() => Promise.resolve(after)),
        },
      });
      setup(api);
      await openSection('Weather');
      vi.useFakeTimers();
      try {
        const box = screen.getByLabelText('Search for a place');
        fireEvent.change(box, { target: { value: 'Du' } });
        fireEvent.change(box, { target: { value: 'Durh' } });
        await act(() => vi.advanceTimersByTimeAsync(299));
        expect(api.weather.searchPlaces).not.toHaveBeenCalled();
        await act(() => vi.advanceTimersByTimeAsync(1));
        expect(api.weather.searchPlaces).toHaveBeenCalledTimes(1);
        expect(api.weather.searchPlaces).toHaveBeenCalledWith('Durh');
      } finally {
        vi.useRealTimers();
      }
      const pick = await screen.findByRole('button', { name: 'Durham, England, United Kingdom' });
      await userEvent.click(pick);
      expect(api.weather.setPlace).toHaveBeenCalledWith(DURHAM);
      await waitFor(() => expect(useStudyStore.getState().settings?.weatherPlace).toEqual(DURHAM));
      expect(screen.getByLabelText('Search for a place')).toHaveValue('');
    });

    it('does not search for fewer than two characters', async () => {
      const api = setup();
      await openSection('Weather');
      await userEvent.type(screen.getByLabelText('Search for a place'), 'D');
      await new Promise((r) => setTimeout(r, 350));
      expect(api.weather.searchPlaces).not.toHaveBeenCalled();
    });

    it('says when nothing was found, and shows a failed search kindly', async () => {
      const api = mockApi({
        weather: {
          searchPlaces: vi
            .fn()
            .mockResolvedValueOnce([])
            .mockRejectedValueOnce(
              new Error("Error invoking remote method 'weather:searchPlaces': Error: You seem to be offline"),
            ),
        },
      });
      setup(api);
      await openSection('Weather');
      const box = screen.getByLabelText('Search for a place');
      await userEvent.type(box, 'Zzq');
      expect(await screen.findByText('No places found')).toBeInTheDocument();
      await userEvent.type(box, 'x');
      expect(await screen.findByRole('alert')).toHaveTextContent(/^You seem to be offline$/);
    });

    it('shows the chosen place and clears it', async () => {
      const api = mockApi({ weather: { setPlace: vi.fn(() => Promise.resolve(publicDefaults())) } });
      setup(api, { ...publicDefaults(), weatherPlace: DURHAM });
      await openSection('Weather');
      expect(screen.getByText('Durham, England, United Kingdom')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
      expect(api.weather.setPlace).toHaveBeenCalledWith(null);
      await waitFor(() => expect(useStudyStore.getState().settings?.weatherPlace).toBeNull());
      expect(screen.getByText('Not set')).toBeInTheDocument();
    });

    it('units is a Celsius / Fahrenheit segmented control that saves', async () => {
      const api = setup();
      await openSection('Weather');
      const group = screen.getByRole('group', { name: 'Units' });
      expect(within(group).getByRole('button', { name: 'Celsius' })).toHaveAttribute('aria-pressed', 'true');
      await userEvent.click(within(group).getByRole('button', { name: 'Fahrenheit' }));
      expect(api.settings.set).toHaveBeenCalledWith({ weatherUnits: 'fahrenheit' });
    });
  });
});
