import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../shared/settings';
import type { Mix, PublicSettings, Sound } from '../../shared/types';
import { audioEngine } from '../audio/engine';
import { installMockApi, mockApi, type MockApi } from '../test/mockApi';
import { SoundsPanel, type SpaceAudio } from './SoundsPanel';

const sound = (id: number, name: string, over: Partial<Sound> = {}): Sound => ({
  id,
  name,
  kind: 'noise',
  source: 'white',
  builtin: true,
  sort: id,
  missing: false,
  ...over,
});

const settingsWith = (over: Partial<PublicSettings>): PublicSettings => {
  const { spotifyTokens: _t, ...rest } = structuredClone(DEFAULT_SETTINGS);
  return { ...rest, ...over };
};

const SOUNDS = [sound(1, 'White noise'), sound(2, 'Pink noise', { source: 'pink' })];

function setup(
  opts: {
    sounds?: Sound[];
    mixes?: Mix[];
    settings?: Partial<PublicSettings>;
    spaceAudio?: SpaceAudio;
  } = {},
) {
  const api: MockApi = mockApi({
    sounds: { list: vi.fn(() => Promise.resolve(opts.sounds ?? SOUNDS)) },
    mixes: { list: vi.fn(() => Promise.resolve(opts.mixes ?? [])) },
    settings: {
      get: vi.fn(() => Promise.resolve(settingsWith(opts.settings ?? {}))),
    },
  });
  installMockApi(api);
  render(<SoundsPanel spaceAudio={opts.spaceAudio} />);
  return api;
}

let setLevel: ReturnType<typeof vi.spyOn>;
let setMasterSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  setLevel = vi.spyOn(audioEngine, 'setLevel').mockResolvedValue(undefined);
  setMasterSpy = vi.spyOn(audioEngine, 'setMaster').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('SoundsPanel', () => {
  it('restores master and channel levels into the engine and the sliders on mount', async () => {
    setup({ settings: { masterVolume: 0.4, soundLevels: { '2': 0.6 } } });
    const slider = await screen.findByLabelText('Pink noise volume');
    expect(slider).toHaveValue('0.6');
    expect(screen.getByLabelText('Master volume')).toHaveValue('0.4');
    expect(setMasterSpy).toHaveBeenCalledWith(0.4);
    expect(setLevel).toHaveBeenCalledWith(SOUNDS[1], 0.6, '');
    expect(setLevel).toHaveBeenCalledTimes(1);
  });

  it('slider change calls settings.set with soundLevels after a debounce', async () => {
    const api = setup();
    const slider = await screen.findByLabelText('White noise volume');
    vi.useFakeTimers();
    fireEvent.change(slider, { target: { value: '0.5' } });
    expect(setLevel).toHaveBeenLastCalledWith(SOUNDS[0], 0.5, '');
    expect(api.settings.set).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(api.settings.set).toHaveBeenCalledTimes(1);
    expect(api.settings.set).toHaveBeenCalledWith({
      soundLevels: { '1': 0.5 },
    });
  });

  it('master slider saves masterVolume and drives the engine', async () => {
    const api = setup();
    const slider = await screen.findByLabelText('Master volume');
    vi.useFakeTimers();
    fireEvent.change(slider, { target: { value: '0.25' } });
    expect(setMasterSpy).toHaveBeenLastCalledWith(0.25);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(api.settings.set).toHaveBeenCalledWith({ masterVolume: 0.25 });
  });

  it('mute zeroes the channel and unmute restores the previous level', async () => {
    setup({ settings: { soundLevels: { '1': 0.7 } } });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Mute White noise' }));
    expect(screen.getByLabelText('White noise volume')).toHaveValue('0');
    expect(setLevel).toHaveBeenLastCalledWith(SOUNDS[0], 0, '');
    await user.click(screen.getByRole('button', { name: 'Unmute White noise' }));
    expect(screen.getByLabelText('White noise volume')).toHaveValue('0.7');
  });

  it('saving a mix calls mixes.save with the current levels', async () => {
    const api = setup({ settings: { soundLevels: { '1': 0.3, '2': 0 } } });
    const user = userEvent.setup();
    await screen.findByLabelText('White noise volume');
    await user.type(screen.getByLabelText('Mix name'), 'Rainy day');
    await user.click(screen.getByRole('button', { name: 'Save mix' }));
    expect(api.mixes.save).toHaveBeenCalledWith('Rainy day', { '1': 0.3 });
  });

  it('applying a mix sets every channel (others to 0) and persists it', async () => {
    const mix: Mix = { id: 5, name: 'Focus', levels: { '2': 0.8 } };
    const api = setup({
      mixes: [mix],
      settings: { soundLevels: { '1': 0.5 } },
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Focus' }));
    expect(screen.getByLabelText('White noise volume')).toHaveValue('0');
    expect(screen.getByLabelText('Pink noise volume')).toHaveValue('0.8');
    await waitFor(() =>
      expect(api.settings.set).toHaveBeenCalledWith({
        soundLevels: { '1': 0, '2': 0.8 },
      }),
    );
  });

  it('deleting a mix calls mixes.remove', async () => {
    const api = setup({ mixes: [{ id: 5, name: 'Focus', levels: {} }] });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Delete Focus' }));
    expect(api.mixes.remove).toHaveBeenCalledWith(5);
  });

  it('a missing custom sound shows the Relocate state and relocating re-adds it', async () => {
    const gone = sound(9, 'Lecture hum', {
      kind: 'file',
      builtin: false,
      source: 'C:\\x.mp3',
      missing: true,
    });
    const api = setup({ sounds: [...SOUNDS, gone] });
    const user = userEvent.setup();
    const btn = await screen.findByRole('button', {
      name: 'File moved — Relocate…',
    });
    expect(screen.queryByLabelText('Lecture hum volume')).not.toBeInTheDocument();
    await user.click(btn);
    expect(api.sounds.remove).toHaveBeenCalledWith(9);
    expect(api.sounds.addFiles).toHaveBeenCalledTimes(1);
  });

  it('never starts a missing sound, even with a saved level', async () => {
    const gone = sound(9, 'Lecture hum', {
      kind: 'file',
      builtin: false,
      missing: true,
    });
    setup({ sounds: [gone], settings: { soundLevels: { '9': 0.5 } } });
    await screen.findByText('Lecture hum');
    expect(setLevel).toHaveBeenCalledWith(gone, 0, 'studyat-media://sound/9');
  });

  it('"Add sound…" calls sounds.addFiles and shows the new list', async () => {
    const added = sound(10, 'Library', { kind: 'file', builtin: false });
    const api = setup();
    (api.sounds.addFiles as ReturnType<typeof vi.fn>).mockResolvedValue([...SOUNDS, added]);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Add sound…' }));
    expect(await screen.findByLabelText('Library volume')).toBeInTheDocument();
  });

  it('shows the space audio slider only when a spaceAudio prop is given', async () => {
    setup();
    await screen.findByLabelText('Master volume');
    expect(screen.queryByLabelText('Space audio')).not.toBeInTheDocument();
  });

  it('space audio slider reads and sets through the prop', async () => {
    const spaceAudio = { get: vi.fn(() => 0.9), set: vi.fn() };
    setup({ spaceAudio });
    const slider = await screen.findByLabelText('Space audio');
    expect(slider).toHaveValue('0.9');
    fireEvent.change(slider, { target: { value: '0.2' } });
    expect(spaceAudio.set).toHaveBeenCalledWith(0.2);
  });
});
