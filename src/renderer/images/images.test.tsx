import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IMAGE_ERRORS } from '../../core/images';
import { DEFAULT_SETTINGS } from '../../shared/settings';
import type { ImageWidget as ImageData, PublicSettings } from '../../shared/types';
import { Shell } from '../shell/Shell';
import { resetStudyStore, useStudyStore } from '../shell/store';
import { testRegistry } from '../shell/testRegistry';
import { installMockApi, mockApi, type MockApi } from '../test/mockApi';
import { ImageWidgets } from './ImageWidget';
import { resetImagesStore, useImagesStore } from './imagesStore';

const onboarded = (): PublicSettings => {
  const { spotifyTokens: _t, ...rest } = structuredClone(DEFAULT_SETTINGS);
  return { ...rest, onboarded: true };
};

const image = (over: Partial<ImageData> = {}): ImageData => ({
  id: 1,
  url: 'studyat-media://image/1',
  width: 480,
  height: 240,
  x: 0.5,
  y: 0.4,
  scale: 1,
  bare: false,
  ...over,
});

function setWindow(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
}

/** Renders the image widgets alone over a mock API whose `update` echoes the patch. */
function renderImages(images: ImageData[], api: MockApi = mockApi()): MockApi {
  vi.mocked(api.images.update).mockImplementation((id, p) => {
    const was = useImagesStore.getState().images.find((i) => i.id === id);
    return Promise.resolve(was ? { ...was, ...p } : null);
  });
  installMockApi(api);
  useImagesStore.setState({ images });
  render(<ImageWidgets />);
  return api;
}

async function renderShell(api: MockApi): Promise<MockApi> {
  installMockApi(api);
  render(<Shell registry={testRegistry()} />);
  await waitFor(() => expect(useStudyStore.getState().settings).not.toBeNull());
  return api;
}

const shellApi = (over: Parameters<typeof mockApi>[0] = {}): MockApi =>
  mockApi({ settings: { get: vi.fn(() => Promise.resolve(onboarded())) }, ...over });

beforeEach(() => {
  resetStudyStore();
  resetImagesStore();
  setWindow(1920, 1080);
});
afterEach(() => vi.restoreAllMocks());

describe('Add image dialog', () => {
  it('opens from the Widgets popover with Choose file…, a link field and Add', async () => {
    const user = userEvent.setup();
    await renderShell(shellApi());
    await user.click(screen.getByRole('button', { name: 'Widgets' }));
    await user.click(screen.getByRole('button', { name: 'Add image…' }));
    const dialog = screen.getByRole('dialog', { name: 'Add image' });
    expect(within(dialog).getByRole('button', { name: 'Choose file…' })).toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: 'Link' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Add' })).toBeInTheDocument();
    // The popover makes way for the dialog.
    expect(screen.queryByRole('dialog', { name: 'Widgets' })).not.toBeInTheDocument();
  });

  it('shows an error answer verbatim in an alert, then closes on success and shows the image', async () => {
    const user = userEvent.setup();
    const addUrl = vi
      .fn()
      .mockResolvedValueOnce({ error: IMAGE_ERRORS.type })
      .mockResolvedValueOnce(image({ id: 7, url: 'studyat-media://image/7' }));
    const api = await renderShell(shellApi({ images: { addUrl } }));
    act(() => useImagesStore.getState().setAdding(true));
    const dialog = screen.getByRole('dialog', { name: 'Add image' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Link' }), 'https://example.com/page');
    await user.click(within(dialog).getByRole('button', { name: 'Add' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      /^That isn't a GIF, PNG, JPEG or WebP image\.$/,
    );
    expect(api.images.addUrl).toHaveBeenCalledWith('https://example.com/page');

    await user.click(within(dialog).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add image' })).not.toBeInTheDocument());
    expect(screen.getByRole('img', { name: 'Image 1' })).toHaveAttribute('src', 'studyat-media://image/7');
  });

  it('a rejected add says "Couldn\'t add that image." in the alert', async () => {
    const user = userEvent.setup();
    const addUrl = vi.fn().mockRejectedValue(new Error('main unreachable'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await renderShell(shellApi({ images: { addUrl } }));
    act(() => useImagesStore.getState().setAdding(true));
    const dialog = screen.getByRole('dialog', { name: 'Add image' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Link' }), 'https://example.com/a.png');
    await user.click(within(dialog).getByRole('button', { name: 'Add' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/^Couldn't add that image\.$/);
    expect(screen.getByRole('dialog', { name: 'Add image' })).toBeInTheDocument();
  });

  it('the link form leaves checking to us, so a link without a scheme still reaches main', async () => {
    const user = userEvent.setup();
    const api = await renderShell(shellApi());
    act(() => useImagesStore.getState().setAdding(true));
    const dialog = screen.getByRole('dialog', { name: 'Add image' });
    const field = within(dialog).getByRole('textbox', { name: 'Link' });
    expect(field.closest('form')).toHaveAttribute('novalidate');
    await user.type(field, 'example.com/a.png');
    await user.click(within(dialog).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(api.images.addUrl).toHaveBeenCalledWith('example.com/a.png'));
  });

  it('a cancelled file dialog does nothing: no alert, the dialog stays', async () => {
    const user = userEvent.setup();
    const api = await renderShell(shellApi());
    act(() => useImagesStore.getState().setAdding(true));
    await user.click(screen.getByRole('button', { name: 'Choose file…' }));
    await waitFor(() => expect(api.images.addFile).toHaveBeenCalled());
    expect(screen.getByRole('dialog', { name: 'Add image' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('a chosen file closes the dialog and shows the image', async () => {
    const user = userEvent.setup();
    await renderShell(shellApi({ images: { addFile: vi.fn().mockResolvedValue(image({ id: 3 })) } }));
    act(() => useImagesStore.getState().setAdding(true));
    await user.click(screen.getByRole('button', { name: 'Choose file…' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add image' })).not.toBeInTheDocument());
    expect(screen.getByRole('img', { name: 'Image 1' })).toBeInTheDocument();
  });

  it('Esc closes the dialog and nothing behind it', async () => {
    const user = userEvent.setup();
    await renderShell(shellApi());
    act(() => {
      useStudyStore.getState().setPanel('spaces');
      useImagesStore.getState().setAdding(true);
    });
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Add image' })).not.toBeInTheDocument();
    expect(useStudyStore.getState().openPanel).toBe('spaces');
  });
});

describe('Image widget', () => {
  it('renders its media URL at the base size fitted in 240 × 240, keeping aspect', () => {
    renderImages([image({ width: 480, height: 240 })]);
    const img = screen.getByRole('img', { name: 'Image 1' });
    expect(img).toHaveAttribute('src', 'studyat-media://image/1');
    const picture = img.parentElement!;
    expect(picture.style.width).toBe('240px');
    expect(picture.style.height).toBe('120px');
    expect(screen.getByRole('group', { name: 'Image' }).style.transform).toBe('scale(1)');
  });

  it('fits a tall image by its height', () => {
    renderImages([image({ width: 300, height: 600 })]);
    const picture = screen.getByRole('img', { name: 'Image 1' }).parentElement!;
    expect(picture.style.width).toBe('120px');
    expect(picture.style.height).toBe('240px');
  });

  it('framed: titled Image, Hide background sets bare', async () => {
    const user = userEvent.setup();
    const api = renderImages([image()]);
    const frame = screen.getByRole('group', { name: 'Image' });
    expect(within(frame).getByRole('button', { name: 'Move Image' })).toHaveTextContent('Image');
    await user.click(within(frame).getByRole('button', { name: 'Hide background' }));
    expect(api.images.update).toHaveBeenCalledWith(1, { bare: true });
    expect(useImagesStore.getState().images[0]?.bare).toBe(true);
  });

  it('framed: close asks "Remove this image?"; Cancel keeps it, Remove removes it', async () => {
    const user = userEvent.setup();
    const api = renderImages([image()]);
    await user.click(screen.getByRole('button', { name: 'Close Image' }));
    const ask = screen.getByRole('group', { name: 'Remove this image?' });
    expect(ask).toHaveTextContent('Remove this image?');
    await user.click(within(ask).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('group', { name: 'Remove this image?' })).not.toBeInTheDocument();
    expect(api.images.remove).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Close Image' }));
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(api.images.remove).toHaveBeenCalledWith(1);
    await waitFor(() => expect(screen.queryByRole('img')).not.toBeInTheDocument());
  });

  it('bare: no header; the toolbar has Show background and Remove', async () => {
    const user = userEvent.setup();
    const api = renderImages([image({ bare: true })]);
    expect(screen.queryByRole('button', { name: /^Close/ })).not.toBeInTheDocument();
    const frame = screen.getByRole('group', { name: 'Image 1' });
    expect(frame.className).not.toMatch(/frosted/);
    await user.click(screen.getByRole('button', { name: 'Show background' }));
    expect(api.images.update).toHaveBeenCalledWith(1, { bare: false });

    act(() => useImagesStore.setState({ images: [image({ bare: true })] }));
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    const ask = screen.getByRole('group', { name: 'Remove this image?' });
    await user.click(within(ask).getByRole('button', { name: 'Remove' }));
    expect(api.images.remove).toHaveBeenCalledWith(1);
  });

  it('bare: dragging the image saves x and y', () => {
    const api = renderImages([image({ bare: true })]);
    const body = screen.getByRole('button', { name: 'Image 1' });
    expect(body).toContainElement(screen.getByRole('img', { name: 'Image 1' }));
    fireEvent.pointerDown(body, { clientX: 960, clientY: 500, button: 0, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 1056, clientY: 608, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 1056, clientY: 608, pointerId: 1 });
    expect(api.images.update).toHaveBeenCalledWith(1, { x: 0.55, y: 0.5 });
  });

  it('bare: a press on the image focuses it, so the arrow keys move it next', () => {
    renderImages([image({ bare: true })]);
    const body = screen.getByRole('button', { name: 'Image 1' });
    fireEvent.pointerDown(body, { clientX: 960, clientY: 500, button: 0, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 960, clientY: 500, pointerId: 1 });
    expect(body).toHaveFocus();
  });

  it('bare: the resize corner saves scale', () => {
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(240);
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(120);
    const api = renderImages([image({ bare: true })]);
    const corner = screen.getByRole('button', { name: 'Resize Image 1' });
    fireEvent.pointerDown(corner, { clientX: 1080, clientY: 552, button: 0, pointerId: 1 });
    // Along the 240 × 120 diagonal by its own length: double size.
    fireEvent.pointerMove(window, { clientX: 1320, clientY: 672, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 1320, clientY: 672, pointerId: 1 });
    expect(api.images.update).toHaveBeenCalledWith(1, expect.objectContaining({ scale: 2 }));
  });

  it('bare: arrow keys on the focused image move it', async () => {
    const user = userEvent.setup();
    const api = renderImages([image({ bare: true })]);
    screen.getByRole('button', { name: 'Image 1' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(api.images.update).toHaveBeenCalledWith(1, { x: 0.52, y: 0.4 });
  });

  it('numbers images in order: Image 1, Image 2', () => {
    renderImages([
      image({ id: 4, bare: true }),
      image({ id: 9, bare: true, url: 'studyat-media://image/9' }),
    ]);
    expect(screen.getByRole('img', { name: 'Image 2' })).toHaveAttribute('src', 'studyat-media://image/9');
  });

  it('a failed load shows "Image missing" with Remove', async () => {
    const user = userEvent.setup();
    const api = renderImages([image({ bare: true })]);
    fireEvent.error(screen.getByRole('img', { name: 'Image 1' }));
    expect(screen.getByText('Image missing')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    // Remove asks first: a failed load can be a file that is there but won't decode.
    expect(api.images.remove).not.toHaveBeenCalled();
    const ask = screen.getByRole('group', { name: 'Remove this image?' });
    await user.click(within(ask).getByRole('button', { name: 'Cancel' }));
    expect(api.images.remove).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    await user.click(
      within(screen.getByRole('group', { name: 'Remove this image?' })).getByRole('button', {
        name: 'Remove',
      }),
    );
    expect(api.images.remove).toHaveBeenCalledWith(1);
  });

  it('a thin missing image keeps a readable frame for its message and Remove', () => {
    // 1000 × 100 fits to 240 × 24, too short for the message; the missing frame is at least 160 × 80.
    renderImages([image({ width: 1000, height: 100 })]);
    const img = screen.getByRole('img', { name: 'Image 1' });
    expect(img.parentElement).toHaveStyle({ width: '240px', height: '24px' });
    fireEvent.error(img);
    const text = screen.getByText('Image missing');
    const frame = text.parentElement!.parentElement!;
    expect(frame).toHaveStyle({ width: '240px', height: '80px' });
    expect(within(frame).getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  });

  it('in focus view the toolbar and corner fade with the chrome; the image stays', async () => {
    const api = shellApi({ images: { list: vi.fn().mockResolvedValue([image({ bare: true })]) } });
    await renderShell(api);
    const img = await screen.findByRole('img', { name: 'Image 1' });
    act(() => useStudyStore.getState().setFocusView(true));
    expect(screen.getByTestId('shell').dataset.chrome).toBe('hidden');
    const toolbar = screen.getByRole('button', { name: 'Show background' }).parentElement!;
    expect(toolbar.closest('[class*="fades"]')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Resize Image 1' }).className).toMatch(/fades/);
    expect(img.closest('[class*="fades"]')).toBeNull();
  });
});

describe('images store', () => {
  it('patch is optimistic and undone when main fails', async () => {
    const api = mockApi({ images: { update: vi.fn().mockRejectedValue(new Error('disk')) } });
    installMockApi(api);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    useImagesStore.setState({ images: [image()] });
    const pending = useImagesStore.getState().patch(1, { x: 0.9 });
    expect(useImagesStore.getState().images[0]?.x).toBe(0.9);
    await pending;
    expect(useImagesStore.getState().images[0]?.x).toBe(0.5);
  });

  it('load reads the list from main', async () => {
    installMockApi(mockApi({ images: { list: vi.fn().mockResolvedValue([image()]) } }));
    await useImagesStore.getState().load();
    expect(useImagesStore.getState().images).toEqual([image()]);
  });

  it('remove drops the image once main has removed it', async () => {
    const api = mockApi();
    installMockApi(api);
    useImagesStore.setState({ images: [image(), image({ id: 2 })] });
    await useImagesStore.getState().remove(1);
    expect(api.images.remove).toHaveBeenCalledWith(1);
    expect(useImagesStore.getState().images.map((i) => i.id)).toEqual([2]);
  });
});
