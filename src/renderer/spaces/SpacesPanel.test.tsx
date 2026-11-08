import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installMockApi, mockApi, type MockApi } from '../test/mockApi';
import { makeSpace, sampleSpaces } from './fixtures';
import { resetSpacesStore, useSpacesStore } from './spacesStore';
import { SpacesPanel } from './SpacesPanel';

vi.mock('./thumbnail', () => ({ captureThumbnail: vi.fn(() => Promise.resolve('data:image/jpeg;base64,AAA')) }));

const setup = (spaces = sampleSpaces(), overrides: Parameters<typeof mockApi>[0] = {}): MockApi => {
  const api = mockApi({
    ...overrides,
    spaces: { list: vi.fn(() => Promise.resolve(spaces)), setActive: vi.fn(() => Promise.resolve(spaces)), update: vi.fn(() => Promise.resolve(spaces)), ...overrides.spaces },
  });
  installMockApi(api);
  render(<SpacesPanel />);
  return api;
};

const cards = () => screen.getAllByRole('listitem').filter((li) => li.closest('ul[role="menu"]') === null);

beforeEach(() => resetSpacesStore());

describe('SpacesPanel', () => {
  it('tabs filter by kind and favourites', async () => {
    setup();
    await screen.findByText('Rainy Window');
    expect(cards()).toHaveLength(3);
    await userEvent.click(screen.getByRole('tab', { name: 'Videos' }));
    expect(cards()).toHaveLength(1);
    await userEvent.click(screen.getByRole('tab', { name: 'Images' }));
    expect(screen.getByText('Forest Path')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'YouTube' }));
    expect(screen.getByText('Lofi Cafe')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Favourites' }));
    expect(cards()).toHaveLength(1);
    expect(screen.getByText('Forest Path')).toBeInTheDocument();
  });

  it('search filters by name case-insensitively and shows "No spaces match."', async () => {
    setup();
    await screen.findByText('Rainy Window');
    await userEvent.type(screen.getByLabelText('Search spaces'), 'FOREST');
    expect(cards()).toHaveLength(1);
    await userEvent.clear(screen.getByLabelText('Search spaces'));
    await userEvent.type(screen.getByLabelText('Search spaces'), 'zzz');
    expect(screen.getByText('No spaces match.')).toBeInTheDocument();
  });

  it('clicking a card calls spaces.setActive', async () => {
    const api = setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Use Forest Path' }));
    expect(api.spaces.setActive).toHaveBeenCalledWith(2);
  });

  it('missing file card shows "File moved — Relocate…" and calls relocate', async () => {
    const api = setup([makeSpace({ id: 5, name: 'Gone', missing: true })]);
    await userEvent.click(await screen.findByRole('button', { name: 'File moved — Relocate…' }));
    expect(api.spaces.relocate).toHaveBeenCalledWith(5);
  });

  it('add YouTube with bad url shows inline error', async () => {
    const api = setup();
    await screen.findByText('Rainy Window');
    await userEvent.type(screen.getByLabelText('YouTube link'), 'not a link');
    await userEvent.click(screen.getByRole('button', { name: 'Add YouTube' }));
    expect(screen.getByRole('alert')).toHaveTextContent("That doesn't look like a YouTube link.");
    expect(api.spaces.addYouTube).not.toHaveBeenCalled();
  });

  it('add YouTube with a good url calls addYouTube', async () => {
    const api = setup();
    await screen.findByText('Rainy Window');
    await userEvent.type(screen.getByLabelText('YouTube link'), 'https://youtu.be/dQw4w9WgXcQ');
    await userEvent.click(screen.getByRole('button', { name: 'Add YouTube' }));
    expect(api.spaces.addYouTube).toHaveBeenCalledWith('https://youtu.be/dQw4w9WgXcQ');
  });

  it('adding a video without a thumb captures one and saves it', async () => {
    const added = makeSpace({ id: 9, name: 'New clip' });
    const api = setup(sampleSpaces(), { spaces: { addFiles: vi.fn(() => Promise.resolve([...sampleSpaces(), added])) } });
    await screen.findByText('Rainy Window');
    await userEvent.click(screen.getByRole('button', { name: 'Add files…' }));
    await waitFor(() => expect(api.spaces.update).toHaveBeenCalledWith(9, { thumb: 'data:image/jpeg;base64,AAA' }));
  });

  it('the heart toggles the favourite and the menu opens settings that save opts', async () => {
    const api = setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Favourite Rainy Window' }));
    expect(api.spaces.update).toHaveBeenCalledWith(1, { favourite: true });
    await userEvent.click(screen.getByRole('button', { name: 'Menu for Rainy Window' }));
    await userEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Settings' }));
    await userEvent.click(screen.getByLabelText('Audio'));
    expect(api.spaces.update).toHaveBeenCalledWith(1, { opts: { audio: true } });
  });

  it('builtin cards have no rename or remove', async () => {
    setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Menu for Forest Path' }));
    const menu = screen.getByRole('menu');
    expect(within(menu).queryByRole('menuitem', { name: 'Remove' })).not.toBeInTheDocument();
    expect(within(menu).queryByRole('menuitem', { name: 'Rename' })).not.toBeInTheDocument();
  });

  describe('card thumbnails', () => {
    it('an image card without a thumb shows the image itself, lazily', async () => {
      setup();
      const card = (await screen.findByText('Forest Path')).closest('li') as HTMLElement;
      const img = card.querySelector('img');
      expect(img).toHaveAttribute('src', 'studyat-media://space/2');
      expect(img).toHaveAttribute('loading', 'lazy');
      expect(img).toHaveAttribute('decoding', 'async');
    });

    it('a video without a thumb, or a missing image, gets a placeholder tile for its kind', async () => {
      setup([makeSpace({ id: 1, name: 'No thumb' }), makeSpace({ id: 2, kind: 'image', name: 'Gone image', missing: true })]);
      const video = (await screen.findByText('No thumb')).closest('li') as HTMLElement;
      const image = screen.getByText('Gone image').closest('li') as HTMLElement;
      expect(video.querySelector('img')).toBeNull();
      expect(within(video).getByTestId('space-placeholder')).toHaveAttribute('data-kind', 'video');
      expect(image.querySelector('img')).toBeNull();
      expect(within(image).getByTestId('space-placeholder')).toHaveAttribute('data-kind', 'image');
    });

    it('a thumb that fails to load falls back to the placeholder', async () => {
      setup();
      const card = (await screen.findByText('Lofi Cafe')).closest('li') as HTMLElement;
      fireEvent.error(card.querySelector('img') as HTMLImageElement);
      expect(card.querySelector('img')).toBeNull();
      expect(within(card).getByTestId('space-placeholder')).toHaveAttribute('data-kind', 'youtube');
    });
  });

  it('a YouTube card whose embed was blocked says so', async () => {
    setup();
    await screen.findByText('Lofi Cafe');
    act(() => useSpacesStore.getState().markEmbedError(3, 'embed'));
    const card = screen.getByText('Lofi Cafe').closest('li') as HTMLElement;
    expect(within(card).getByText("This video can't be embedded")).toBeInTheDocument();
  });

  describe('rename and remove', () => {
    it('rename saves the new name on Enter', async () => {
      const api = setup();
      await userEvent.click(await screen.findByRole('button', { name: 'Menu for Rainy Window' }));
      await userEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
      const input = screen.getByLabelText('Space name');
      expect(input).toHaveFocus();
      await userEvent.clear(input);
      await userEvent.type(input, 'Rain at night{Enter}');
      expect(api.spaces.update).toHaveBeenCalledWith(1, { name: 'Rain at night' });
    });

    it('Escape cancels a rename, saves nothing and stays inside the panel', async () => {
      const api = setup();
      const onWindowKey = vi.fn();
      await userEvent.click(await screen.findByRole('button', { name: 'Menu for Rainy Window' }));
      await userEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
      await userEvent.type(screen.getByLabelText('Space name'), ' nope');
      window.addEventListener('keydown', onWindowKey);
      await userEvent.keyboard('{Escape}');
      window.removeEventListener('keydown', onWindowKey);
      expect(screen.queryByLabelText('Space name')).not.toBeInTheDocument();
      expect(screen.getByText('Rainy Window')).toBeInTheDocument();
      expect(api.spaces.update).not.toHaveBeenCalled();
      expect(onWindowKey).not.toHaveBeenCalled();
    });

    it('rename starts from the current name, not a stale one', async () => {
      setup();
      await screen.findByText('Rainy Window');
      act(() => useSpacesStore.getState().apply(sampleSpaces().map((s) => (s.id === 1 ? { ...s, name: 'Renamed elsewhere' } : s))));
      await userEvent.click(screen.getByRole('button', { name: 'Menu for Renamed elsewhere' }));
      await userEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
      expect(screen.getByLabelText('Space name')).toHaveValue('Renamed elsewhere');
    });

    it('remove calls spaces.remove', async () => {
      const rest = sampleSpaces().filter((s) => s.id !== 1);
      const api = setup(sampleSpaces(), { spaces: { remove: vi.fn(() => Promise.resolve(rest)) } });
      await userEvent.click(await screen.findByRole('button', { name: 'Menu for Rainy Window' }));
      await userEvent.click(screen.getByRole('menuitem', { name: 'Remove' }));
      expect(api.spaces.remove).toHaveBeenCalledWith(1);
      await waitFor(() => expect(screen.queryByText('Rainy Window')).not.toBeInTheDocument());
    });

    it('removing the active space switches to the first built-in', async () => {
      const rest = sampleSpaces().filter((s) => s.id !== 1);
      const api = setup(sampleSpaces(), { spaces: { remove: vi.fn(() => Promise.resolve(rest)) } });
      await screen.findByText('Rainy Window');
      act(() => useSpacesStore.setState({ activeId: 1 }));
      await userEvent.click(screen.getByRole('button', { name: 'Menu for Rainy Window' }));
      await userEvent.click(screen.getByRole('menuitem', { name: 'Remove' }));
      await waitFor(() => expect(api.spaces.setActive).toHaveBeenCalledWith(2));
      expect(useSpacesStore.getState().activeId).toBe(2);
    });

    it('removing another space leaves the active one alone', async () => {
      const rest = sampleSpaces().filter((s) => s.id !== 1);
      const api = setup(sampleSpaces(), { spaces: { remove: vi.fn(() => Promise.resolve(rest)) } });
      await screen.findByText('Rainy Window');
      act(() => useSpacesStore.setState({ activeId: 3 }));
      await userEvent.click(screen.getByRole('button', { name: 'Menu for Rainy Window' }));
      await userEvent.click(screen.getByRole('menuitem', { name: 'Remove' }));
      await waitFor(() => expect(screen.queryByText('Rainy Window')).not.toBeInTheDocument());
      expect(api.spaces.setActive).not.toHaveBeenCalled();
    });
  });

  describe('card menu', () => {
    it('opening focuses the first item; Escape closes it, returns focus to ⋯ and stays inside the panel', async () => {
      setup();
      const onWindowKey = vi.fn();
      const trigger = await screen.findByRole('button', { name: 'Menu for Rainy Window' });
      await userEvent.click(trigger);
      expect(screen.getByRole('menuitem', { name: 'Rename' })).toHaveFocus();
      window.addEventListener('keydown', onWindowKey);
      await userEvent.keyboard('{Escape}');
      window.removeEventListener('keydown', onWindowKey);
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
      expect(onWindowKey).not.toHaveBeenCalled();
    });

    it('arrow keys move between items', async () => {
      setup();
      await userEvent.click(await screen.findByRole('button', { name: 'Menu for Rainy Window' }));
      await userEvent.keyboard('{ArrowDown}');
      expect(screen.getByRole('menuitem', { name: 'Settings' })).toHaveFocus();
      await userEvent.keyboard('{ArrowUp}{ArrowUp}');
      expect(screen.getByRole('menuitem', { name: 'Remove' })).toHaveFocus();
    });

    it('only one menu is open at a time', async () => {
      setup();
      await userEvent.click(await screen.findByRole('button', { name: 'Menu for Rainy Window' }));
      await userEvent.click(screen.getByRole('button', { name: 'Menu for Forest Path' }));
      expect(screen.getAllByRole('menu')).toHaveLength(1);
      expect(screen.getByRole('button', { name: 'Menu for Rainy Window' })).toHaveAttribute('aria-expanded', 'false');
    });

    it('a click outside closes it', async () => {
      setup();
      await userEvent.click(await screen.findByRole('button', { name: 'Menu for Rainy Window' }));
      await userEvent.click(screen.getByLabelText('Search spaces'));
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('tabbing out of it closes it', async () => {
      setup();
      await userEvent.click(await screen.findByRole('button', { name: 'Menu for Rainy Window' }));
      await userEvent.tab();
      await userEvent.tab();
      await userEvent.tab();
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('the ⋯ button toggles it shut', async () => {
      setup();
      const trigger = await screen.findByRole('button', { name: 'Menu for Rainy Window' });
      await userEvent.click(trigger);
      await userEvent.click(trigger);
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });
  });

  describe('failures', () => {
    it('a failed add YouTube shows an inline error and reloads the list', async () => {
      const list = vi.fn(() => Promise.resolve(sampleSpaces()));
      const api = setup(sampleSpaces(), { spaces: { list, addYouTube: vi.fn(() => Promise.reject(new Error('db'))) } });
      await screen.findByText('Rainy Window');
      await userEvent.type(screen.getByLabelText('YouTube link'), 'https://youtu.be/dQw4w9WgXcQ');
      await userEvent.click(screen.getByRole('button', { name: 'Add YouTube' }));
      expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't add that video. Try again.");
      expect(api.spaces.addYouTube).toHaveBeenCalled();
      expect(list).toHaveBeenCalledTimes(2);
      expect(screen.getByLabelText('YouTube link')).toHaveValue('https://youtu.be/dQw4w9WgXcQ');
    });

    it('a failed add files shows an inline error and reloads the list', async () => {
      const list = vi.fn(() => Promise.resolve(sampleSpaces()));
      setup(sampleSpaces(), { spaces: { list, addFiles: vi.fn(() => Promise.reject(new Error('dialog'))) } });
      await screen.findByText('Rainy Window');
      await userEvent.click(screen.getByRole('button', { name: 'Add files…' }));
      expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't add those files. Try again.");
      expect(list).toHaveBeenCalledTimes(2);
    });

    it('a failed switch shows an inline error', async () => {
      setup(sampleSpaces(), { spaces: { setActive: vi.fn(() => Promise.reject(new Error('db'))) } });
      await userEvent.click(await screen.findByRole('button', { name: 'Use Forest Path' }));
      expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't switch spaces. Try again.");
    });

    it('a failed remove shows an inline error', async () => {
      setup(sampleSpaces(), { spaces: { remove: vi.fn(() => Promise.reject(new Error('db'))) } });
      await userEvent.click(await screen.findByRole('button', { name: 'Menu for Rainy Window' }));
      await userEvent.click(screen.getByRole('menuitem', { name: 'Remove' }));
      expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't remove that space. Try again.");
    });
  });
});
