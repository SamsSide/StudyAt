import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../shared/settings';
import type { Mix, PublicSettings, Sound } from '../../shared/types';
import { audioEngine } from '../audio/engine';
import { makeSpace } from '../spaces/fixtures';
import { spaceAudio as storeSpaceAudio } from '../spaces/spaceAudio';
import { resetSpacesStore, useSpacesStore } from '../spaces/spacesStore';
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
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
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
    const toggle = screen.getByRole('button', { name: 'Mute White noise' });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
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

  const goneSound = (): Sound =>
    sound(9, 'Lecture hum', { kind: 'file', builtin: false, source: 'C:\\x.mp3', missing: true });

  it('relocating points the same sound at the new file: same id, same level, and it plays again', async () => {
    const gone = goneSound();
    const found: Sound = { ...gone, source: 'D:\\x.mp3', missing: false };
    const api = setup({ sounds: [...SOUNDS, gone], settings: { soundLevels: { '9': 0.5 } } });
    (api.sounds.relocate as ReturnType<typeof vi.fn>).mockResolvedValue([...SOUNDS, found]);
    const user = userEvent.setup();
    expect(screen.queryByLabelText('Lecture hum volume')).not.toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'File moved — Relocate…' }));
    expect(api.sounds.relocate).toHaveBeenCalledWith(9);
    expect(await screen.findByLabelText('Lecture hum volume')).toHaveValue('0.5');
    expect(setLevel).toHaveBeenLastCalledWith(found, 0.5, 'studyat-media://sound/9');
    expect(api.sounds.addFiles).not.toHaveBeenCalled();
    expect(api.sounds.remove).not.toHaveBeenCalled();
    // The id didn't change, so the saved levels and every mix still name it: nothing to rewrite.
    expect(api.settings.set).not.toHaveBeenCalled();
  });

  it('a cancelled relocate leaves the list exactly as it was', async () => {
    const gone = goneSound();
    const api = setup({ sounds: [...SOUNDS, gone], settings: { soundLevels: { '9': 0.5 } } });
    (api.sounds.relocate as ReturnType<typeof vi.fn>).mockResolvedValue([...SOUNDS, gone]);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'File moved — Relocate…' }));
    expect(api.sounds.relocate).toHaveBeenCalledWith(9);
    expect(api.sounds.remove).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'File moved — Relocate…' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(setLevel).not.toHaveBeenCalledWith(gone, 0.5, expect.anything());
  });

  it("a failed relocate shows a fixed sentence only, never main's reason or a path, and logs it", async () => {
    const gone = goneSound();
    const api = setup({ sounds: [...SOUNDS, gone] });
    const err = new Error(
      "Error invoking remote method 'sounds:relocate': Error: EACCES: permission denied, open 'C:\\x.mp3'",
    );
    (api.sounds.relocate as ReturnType<typeof vi.fn>).mockRejectedValue(err);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'File moved — Relocate…' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/^Couldn't relocate that sound\.$/);
    expect(alert).not.toHaveTextContent('EACCES');
    expect(alert).not.toHaveTextContent('x.mp3');
    expect(warn).toHaveBeenCalledWith(expect.any(String), err);
  });

  it('a failed "Add sound…" shows an inline error', async () => {
    const api = setup();
    (api.sounds.addFiles as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('disk'));
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Add sound…' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/^Couldn't add that sound\.$/);
  });

  it('a failed level save says so and is sent again with the next change', async () => {
    const api = setup();
    const set = api.settings.set as ReturnType<typeof vi.fn>;
    set.mockRejectedValueOnce(new Error('EACCES'));
    const slider = await screen.findByLabelText('White noise volume');
    vi.useFakeTimers();
    fireEvent.change(slider, { target: { value: '0.5' } });
    await act(() => vi.advanceTimersByTimeAsync(300));
    expect(set).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alert')).toHaveTextContent(/^Couldn't save your sound levels\.$/);
    expect(warn).toHaveBeenCalled();
    // Moving the master slider saves it and resends the levels that didn't save.
    fireEvent.change(screen.getByLabelText('Master volume'), { target: { value: '0.3' } });
    await act(() => vi.advanceTimersByTimeAsync(300));
    expect(set).toHaveBeenCalledTimes(2);
    expect(set).toHaveBeenLastCalledWith({ soundLevels: { '1': 0.5 }, masterVolume: 0.3 });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('a failed master save is sent again when the panel closes', async () => {
    const api = setup();
    const set = api.settings.set as ReturnType<typeof vi.fn>;
    set.mockRejectedValueOnce(new Error('EACCES'));
    const slider = await screen.findByLabelText('Master volume');
    vi.useFakeTimers();
    fireEvent.change(slider, { target: { value: '0.25' } });
    await act(() => vi.advanceTimersByTimeAsync(300));
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't save your sound levels.");
    cleanup();
    expect(set).toHaveBeenCalledTimes(2);
    expect(set).toHaveBeenLastCalledWith({ masterVolume: 0.25 });
  });

  it('a failed first load says so, with no unhandled rejection, and "Try again" loads the sounds', async () => {
    const list = vi
      .fn()
      .mockRejectedValueOnce(new Error("EACCES: permission denied, open 'C:\\Users\\sam'"))
      .mockResolvedValue(SOUNDS);
    installMockApi(mockApi({ sounds: { list }, mixes: { list: vi.fn(() => Promise.resolve([])) } }));
    render(<SoundsPanel />);
    expect(await screen.findByText("Couldn't load your sounds.")).toBeInTheDocument();
    expect(screen.getByTestId('sounds-panel')).not.toHaveTextContent('EACCES');
    expect(screen.queryByText('No mixes yet.')).not.toBeInTheDocument();
    expect(warn).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByLabelText('White noise volume')).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load your sounds.")).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add sound…' })).toBeEnabled();
  });

  it('"Add sound…" and the mix form wait for the saved soundscape', async () => {
    let release: (s: PublicSettings) => void = () => undefined;
    installMockApi(
      mockApi({
        sounds: { list: vi.fn(() => Promise.resolve(SOUNDS)) },
        mixes: { list: vi.fn(() => Promise.resolve([])) },
        settings: { get: vi.fn(() => new Promise<PublicSettings>((r) => (release = r))) },
      }),
    );
    render(<SoundsPanel />);
    expect(screen.getByRole('button', { name: 'Add sound…' })).toBeDisabled();
    expect(screen.getByLabelText('Mix name')).toBeDisabled();
    await act(async () => {
      release(settingsWith({}));
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add sound…' })).toBeEnabled());
    expect(screen.getByLabelText('Mix name')).toBeEnabled();
  });

  it("the mute button's accessible name contains its visible label", async () => {
    setup({ settings: { soundLevels: { '1': 0.7 } } });
    const toggle = await screen.findByRole('button', { name: 'Mute White noise' });
    // An icon button: no visible text that could disagree with the name it is announced by.
    expect(toggle.textContent?.trim()).toBe('');
    expect(toggle.querySelector('svg')).not.toBeNull();
  });

  it('the master slider is disabled until the saved soundscape has loaded', async () => {
    let release: (s: PublicSettings) => void = () => undefined;
    const api = mockApi({
      sounds: { list: vi.fn(() => Promise.resolve(SOUNDS)) },
      mixes: { list: vi.fn(() => Promise.resolve([])) },
      settings: { get: vi.fn(() => new Promise<PublicSettings>((r) => (release = r))) },
    });
    installMockApi(api);
    render(<SoundsPanel />);
    expect(screen.getByLabelText('Master volume')).toBeDisabled();
    await act(async () => {
      release(settingsWith({ masterVolume: 0.4 }));
    });
    await waitFor(() => expect(screen.getByLabelText('Master volume')).toBeEnabled());
    expect(screen.getByLabelText('Master volume')).toHaveValue('0.4');
  });

  it('re-reads the space audio slider when the spaceAudio prop changes', async () => {
    installMockApi(mockApi({ sounds: { list: vi.fn(() => Promise.resolve(SOUNDS)) } }));
    const first: SpaceAudio = { get: () => 0.9, set: vi.fn() };
    const second: SpaceAudio = { get: () => 0.3, set: vi.fn() };
    const { rerender } = render(<SoundsPanel spaceAudio={first} />);
    expect(await screen.findByLabelText('Space audio')).toHaveValue('0.9');
    rerender(<SoundsPanel spaceAudio={second} />);
    expect(screen.getByLabelText('Space audio')).toHaveValue('0.3');
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

  it("the space audio slider follows the active space's level as it changes elsewhere", async () => {
    resetSpacesStore();
    const space = makeSpace({
      id: 1,
      kind: 'video',
      opts: { audio: true, volume: 0.5, speed: 1, dim: 0, blur: 0, quality: 'auto' },
    });
    useSpacesStore.setState({ spaces: [space], activeId: 1, loaded: true });
    setup({ spaceAudio: storeSpaceAudio });
    const slider = await screen.findByLabelText('Space audio');
    expect(slider).toHaveValue('0.5');
    act(() => useSpacesStore.setState({ spaces: [{ ...space, opts: { ...space.opts, volume: 0.2 } }] }));
    expect(slider).toHaveValue('0.2');
    resetSpacesStore();
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
