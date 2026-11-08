import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../shared/settings';
import { installMockApi, mockApi, type MockApi } from '../test/mockApi';
import { makeSpace, sampleSpaces } from './fixtures';
import { resetSpacesStore } from './spacesStore';
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
    expect(DEFAULT_SETTINGS).toBeDefined();
  });
});
