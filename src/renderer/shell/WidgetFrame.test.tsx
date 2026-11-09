import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../shared/settings';
import type { PublicSettings } from '../../shared/types';
import { installMockApi, mockApi } from '../test/mockApi';
import { resetStudyStore, useStudyStore } from './store';
import { WidgetFrame } from './WidgetFrame';

const settingsWith = (x: number, y: number, scale = 1): PublicSettings => {
  const { spotifyTokens: _t, ...rest } = structuredClone(DEFAULT_SETTINGS);
  return { ...rest, widgets: { ...rest.widgets, tasks: { open: true, x, y, autoHide: false, scale } } };
};

function setWindow(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
}

beforeEach(() => {
  resetStudyStore();
  // The layout reference, so layoutScale is 1 unless a test changes the window.
  setWindow(1920, 1080);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(200);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(100);
});
afterEach(() => vi.restoreAllMocks());

const frame = () => screen.getByRole('group', { name: 'Tasks' });

describe('WidgetFrame', () => {
  it('places the widget centre at x and its top at y', () => {
    installMockApi(mockApi());
    useStudyStore.setState({ settings: settingsWith(0.5, 0.25) });
    render(
      <WidgetFrame id="tasks" title="Tasks">
        <p>body</p>
      </WidgetFrame>,
    );
    expect(frame().style.left).toBe('860px');
    expect(frame().style.top).toBe('270px');
    expect(screen.getByText('body')).toBeInTheDocument();
  });

  it('never opens under the dock or the top bar, nor against the window edges', () => {
    installMockApi(mockApi());
    // An old saved spot under the dock, at the very top.
    useStudyStore.setState({ settings: settingsWith(0.05, 0) });
    render(
      <WidgetFrame id="tasks" title="Tasks">
        <p>body</p>
      </WidgetFrame>,
    );
    // Dock: 12 px in, 76 px wide, then a 12 px gap. Top bar: 12 px down, 52 px tall, then 12 px.
    expect(frame().style.left).toBe('100px');
    expect(frame().style.top).toBe('76px');
    act(() => useStudyStore.setState({ settings: settingsWith(1, 1) }));
    // 12 px clear of the right and bottom edges: 1920 - 12 - 200 and 1080 - 12 - 100.
    expect(frame().style.left).toBe('1708px');
    expect(frame().style.top).toBe('968px');
  });

  it('widget drag persists fractions and clamps inside window', async () => {
    const api = mockApi();
    installMockApi(api);
    useStudyStore.setState({ settings: settingsWith(0.5, 0.5) });
    render(
      <WidgetFrame id="tasks" title="Tasks">
        <p>body</p>
      </WidgetFrame>,
    );
    const handle = screen.getByRole('button', { name: 'Move Tasks' });
    fireEvent.pointerDown(handle, { clientX: 500, clientY: 420, button: 0, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 600, clientY: 520, pointerId: 1 });
    expect(frame().style.left).toBe('960px');
    expect(frame().style.top).toBe('640px');
    expect(api.settings.set).not.toHaveBeenCalled();
    fireEvent.pointerMove(window, { clientX: 2500, clientY: -900, pointerId: 1 });
    expect(frame().style.left).toBe('1708px');
    expect(frame().style.top).toBe('76px');
    // Saved to 4 places, so the settled spot may sit a fraction of a pixel off the drag's.
    fireEvent.pointerUp(window, { clientX: 2500, clientY: -900, pointerId: 1 });
    expect(api.settings.set).toHaveBeenCalledWith({
      widgets: { tasks: { open: true, x: 0.9417, y: 0.0704, autoHide: false, scale: 1 } },
    });
    await waitFor(() => expect(useStudyStore.getState().settings?.widgets.tasks.x).toBe(0.9417));
  });

  it('unmounting mid-drag drops the window listeners and saves nothing', () => {
    const api = mockApi();
    installMockApi(api);
    useStudyStore.setState({ settings: settingsWith(0.5, 0.5) });
    const removed = vi.spyOn(window, 'removeEventListener');
    const { unmount } = render(
      <WidgetFrame id="tasks" title="Tasks">
        <p>body</p>
      </WidgetFrame>,
    );
    const handle = screen.getByRole('button', { name: 'Move Tasks' });
    fireEvent.pointerDown(handle, { clientX: 500, clientY: 420, button: 0, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 600, clientY: 520, pointerId: 1 });
    unmount();
    for (const type of ['pointermove', 'pointerup', 'pointercancel']) {
      expect(removed).toHaveBeenCalledWith(type, expect.any(Function));
    }
    fireEvent.pointerUp(window, { clientX: 600, clientY: 520, pointerId: 1 });
    expect(api.settings.set).not.toHaveBeenCalled();
  });

  it('a click on the handle without a move saves nothing', () => {
    const api = mockApi();
    installMockApi(api);
    useStudyStore.setState({ settings: settingsWith(0.5, 0.5) });
    render(
      <WidgetFrame id="tasks" title="Tasks">
        <p>body</p>
      </WidgetFrame>,
    );
    const handle = screen.getByRole('button', { name: 'Move Tasks' });
    fireEvent.pointerDown(handle, { clientX: 500, clientY: 420, button: 0, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 500, clientY: 420, pointerId: 1 });
    expect(api.settings.set).not.toHaveBeenCalled();
    expect(frame().style.left).toBe('860px');
  });

  it('re-clamps on resize without persisting', () => {
    const api = mockApi();
    installMockApi(api);
    useStudyStore.setState({ settings: settingsWith(0.9, 0.9) });
    render(
      <WidgetFrame id="tasks" title="Tasks">
        <p>body</p>
      </WidgetFrame>,
    );
    expect(frame().style.left).toBe('1628px');
    expect(frame().style.top).toBe('968px');
    act(() => {
      setWindow(500, 400);
      window.dispatchEvent(new Event('resize'));
    });
    // layoutScale floors at 0.5, so the scaled box is 100 × 50: 500 - 12 - 100 and 400 - 12 - 50.
    expect(frame().style.left).toBe('388px');
    expect(frame().style.top).toBe('338px');
    expect(api.settings.set).not.toHaveBeenCalled();
  });

  it('moves with the arrow keys on the handle', async () => {
    const user = userEvent.setup();
    const api = mockApi();
    installMockApi(api);
    useStudyStore.setState({ settings: settingsWith(0.5, 0.5) });
    render(
      <WidgetFrame id="tasks" title="Tasks">
        <p>body</p>
      </WidgetFrame>,
    );
    screen.getByRole('button', { name: 'Move Tasks' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(api.settings.set).toHaveBeenLastCalledWith({
      widgets: { tasks: { open: true, x: 0.52, y: 0.5, autoHide: false, scale: 1 } },
    });
  });

  it('close button sets open false', async () => {
    const user = userEvent.setup();
    const api = mockApi();
    installMockApi(api);
    useStudyStore.setState({ settings: settingsWith(0.5, 0.5) });
    render(
      <WidgetFrame id="tasks" title="Tasks">
        <p>body</p>
      </WidgetFrame>,
    );
    await user.click(screen.getByRole('button', { name: 'Close Tasks' }));
    expect(api.settings.set).toHaveBeenCalledWith({
      widgets: { tasks: { open: false, x: 0.5, y: 0.5, autoHide: false, scale: 1 } },
    });
  });
});

const renderTasks = () =>
  render(
    <WidgetFrame id="tasks" title="Tasks">
      <p>body</p>
    </WidgetFrame>,
  );

const savedTasks = () => useStudyStore.getState().settings?.widgets.tasks;

describe('WidgetFrame scale (spec §3.5)', () => {
  it('scales with the window: scale 1 at 960 × 540 renders at half size', () => {
    installMockApi(mockApi());
    setWindow(960, 540);
    useStudyStore.setState({ settings: settingsWith(0.5, 0.5) });
    renderTasks();
    expect(frame().style.transform).toBe('scale(0.5)');
    // Placed by the scaled 100 × 50 box: 480 - 50.
    expect(frame().style.left).toBe('430px');
    expect(frame().style.top).toBe('270px');
  });

  it('places by the scaled box: x is its centre, y its top', () => {
    installMockApi(mockApi());
    useStudyStore.setState({ settings: settingsWith(0.5, 0.12, 1.5) });
    renderTasks();
    expect(frame().style.transform).toBe('scale(1.5)');
    // Scaled box 300 × 150: 0.5 · 1920 - 150 and 0.12 · 1080.
    expect(frame().style.left).toBe('810px');
    expect(frame().style.top).toBe('129.6px');
  });

  it('clamps by the scaled box, clear of the dock and the window edges', () => {
    installMockApi(mockApi());
    useStudyStore.setState({ settings: settingsWith(1, 1, 2) });
    renderTasks();
    // Scaled box 400 × 200: 1920 - 12 - 400 and 1080 - 12 - 200.
    expect(frame().style.left).toBe('1508px');
    expect(frame().style.top).toBe('868px');
  });

  it('shrinks a widget too big for the free area to fit, and saves nothing', () => {
    const api = mockApi();
    installMockApi(api);
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(1200);
    useStudyStore.setState({ settings: settingsWith(0.5, 0.5) });
    renderTasks();
    // The free area is 1068 - 76 = 992 px tall.
    expect(parseFloat(frame().style.transform.replace('scale(', ''))).toBeCloseTo(992 / 1200, 5);
    expect(frame().style.top).toBe('76px');
    expect(api.settings.set).not.toHaveBeenCalled();
    expect(savedTasks()?.scale).toBe(1);
  });

  it('has a resize handle labelled with the title', () => {
    installMockApi(mockApi());
    useStudyStore.setState({ settings: settingsWith(0.5, 0.5) });
    render(
      <WidgetFrame id="timer" title="Timer">
        <p>body</p>
      </WidgetFrame>,
    );
    expect(screen.getByRole('button', { name: 'Resize Timer' })).toBeInTheDocument();
  });

  it('dragging the resize handle along the diagonal saves the scale on pointer up', async () => {
    const api = mockApi();
    installMockApi(api);
    useStudyStore.setState({ settings: settingsWith(0.5, 0.5) });
    renderTasks();
    const corner = screen.getByRole('button', { name: 'Resize Tasks' });
    // Half the 200 × 100 box's diagonal outwards: 1.5×.
    fireEvent.pointerDown(corner, { clientX: 1060, clientY: 640, button: 0, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 1160, clientY: 690, pointerId: 1 });
    expect(frame().style.transform).toBe('scale(1.5)');
    // The top-left corner stays put while it grows.
    expect(frame().style.left).toBe('860px');
    expect(frame().style.top).toBe('540px');
    expect(api.settings.set).not.toHaveBeenCalled();
    fireEvent.pointerUp(window, { clientX: 1160, clientY: 690, pointerId: 1 });
    expect(api.settings.set).toHaveBeenCalledWith({
      widgets: { tasks: { open: true, x: 0.526, y: 0.5, autoHide: false, scale: 1.5 } },
    });
    await waitFor(() => expect(savedTasks()?.scale).toBe(1.5));
  });

  it('rounds the scale to 0.01 and holds it within 0.5–2', () => {
    installMockApi(mockApi());
    useStudyStore.setState({ settings: settingsWith(0.5, 0.5) });
    renderTasks();
    const corner = screen.getByRole('button', { name: 'Resize Tasks' });
    fireEvent.pointerDown(corner, { clientX: 1060, clientY: 640, button: 0, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 1070, clientY: 643, pointerId: 1 });
    expect(frame().style.transform).toBe('scale(1.05)');
    fireEvent.pointerMove(window, { clientX: 3000, clientY: 2000, pointerId: 1 });
    expect(frame().style.transform).toBe('scale(2)');
    fireEvent.pointerMove(window, { clientX: -3000, clientY: -2000, pointerId: 1 });
    expect(frame().style.transform).toBe('scale(0.5)');
    fireEvent.pointerUp(window, { clientX: -3000, clientY: -2000, pointerId: 1 });
    expect(savedTasks()?.scale).toBe(0.5);
  });

  it('a click on the resize handle without a move saves nothing', () => {
    const api = mockApi();
    installMockApi(api);
    useStudyStore.setState({ settings: settingsWith(0.5, 0.5) });
    renderTasks();
    const corner = screen.getByRole('button', { name: 'Resize Tasks' });
    fireEvent.pointerDown(corner, { clientX: 1060, clientY: 640, button: 0, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 1060, clientY: 640, pointerId: 1 });
    expect(api.settings.set).not.toHaveBeenCalled();
    expect(frame().style.transform).toBe('scale(1)');
  });

  it('+ and = step up 0.1, - steps down 0.1, 0 resets to 1', async () => {
    const user = userEvent.setup();
    installMockApi(mockApi());
    useStudyStore.setState({ settings: settingsWith(0.5, 0.5) });
    renderTasks();
    screen.getByRole('button', { name: 'Resize Tasks' }).focus();
    await user.keyboard('+');
    expect(savedTasks()?.scale).toBe(1.1);
    await user.keyboard('=');
    expect(savedTasks()?.scale).toBe(1.2);
    await user.keyboard('-');
    expect(savedTasks()?.scale).toBe(1.1);
    await user.keyboard('0');
    expect(savedTasks()?.scale).toBe(1);
    await user.keyboard('-');
    expect(savedTasks()?.scale).toBe(0.9);
  });

  it('never steps past 0.5 or 2', async () => {
    const user = userEvent.setup();
    const api = mockApi();
    installMockApi(api);
    useStudyStore.setState({ settings: settingsWith(0.5, 0.5, 2) });
    renderTasks();
    screen.getByRole('button', { name: 'Resize Tasks' }).focus();
    await user.keyboard('+');
    expect(api.settings.set).not.toHaveBeenCalled();
    expect(savedTasks()?.scale).toBe(2);
  });

  it('a double-click on the resize handle resets the scale to 1', async () => {
    const user = userEvent.setup();
    installMockApi(mockApi());
    useStudyStore.setState({ settings: settingsWith(0.5, 0.5, 1.7) });
    renderTasks();
    await user.dblClick(screen.getByRole('button', { name: 'Resize Tasks' }));
    expect(savedTasks()?.scale).toBe(1);
  });

  // Stored JSON reaches the frame unchecked, so a bad scale must still render a usable widget.
  it('renders a missing or non-number scale at 1', () => {
    installMockApi(mockApi());
    useStudyStore.setState({ settings: settingsWith(0.5, 0.5, null as unknown as number) });
    renderTasks();
    expect(frame().style.transform).toBe('scale(1)');
    expect(frame().style.left).toBe('860px');
  });

  it('holds a stored scale out of range to 0.5–2', () => {
    installMockApi(mockApi());
    useStudyStore.setState({ settings: settingsWith(0.5, 0.5, -3) });
    const { unmount } = renderTasks();
    expect(frame().style.transform).toBe('scale(0.5)');
    unmount();
    useStudyStore.setState({ settings: settingsWith(0.5, 0.5, 0.2) });
    renderTasks();
    expect(frame().style.transform).toBe('scale(0.5)');
  });

  it('renders a stored scale of 5 at no more than 2 × layoutScale, then fitted', () => {
    installMockApi(mockApi());
    useStudyStore.setState({ settings: settingsWith(0.5, 0.5, 5) });
    renderTasks();
    expect(frame().style.transform).toBe('scale(2)');
    cleanup();
    setWindow(960, 540);
    renderTasks();
    expect(frame().style.transform).toBe('scale(1)');
    cleanup();
    setWindow(1920, 1080);
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(1200);
    renderTasks();
    expect(parseFloat(frame().style.transform.replace('scale(', ''))).toBeCloseTo(992 / 1200, 5);
  });

  it('steps from 1 when the stored scale is a string, and saves a number', async () => {
    const user = userEvent.setup();
    installMockApi(mockApi());
    useStudyStore.setState({ settings: settingsWith(0.5, 0.5, '1.5' as unknown as number) });
    renderTasks();
    expect(frame().style.transform).toBe('scale(1)');
    screen.getByRole('button', { name: 'Resize Tasks' }).focus();
    await user.keyboard('+');
    expect(savedTasks()?.scale).toBe(1.1);
  });

  it('a drag clamps against the window as it is now, after a resize mid-drag', () => {
    installMockApi(mockApi());
    useStudyStore.setState({ settings: settingsWith(0.5, 0.5) });
    renderTasks();
    const handle = screen.getByRole('button', { name: 'Move Tasks' });
    fireEvent.pointerDown(handle, { clientX: 500, clientY: 420, button: 0, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 3000, clientY: 420, pointerId: 1 });
    expect(frame().style.left).toBe('1708px');
    act(() => {
      setWindow(960, 540);
      window.dispatchEvent(new Event('resize'));
    });
    fireEvent.pointerMove(window, { clientX: 3001, clientY: 420, pointerId: 1 });
    // The box is 100 × 50 at layoutScale 0.5: 960 - 12 - 100 and 540 - 12 - 50.
    expect(frame().style.transform).toBe('scale(0.5)');
    expect(frame().style.left).toBe('848px');
    expect(frame().style.top).toBe('478px');
    fireEvent.pointerUp(window, { clientX: 3001, clientY: 420, pointerId: 1 });
  });

  it('a corner drag measures against the box as it is now, after a resize mid-drag', () => {
    installMockApi(mockApi());
    useStudyStore.setState({ settings: settingsWith(0.5, 0.5) });
    renderTasks();
    const corner = screen.getByRole('button', { name: 'Resize Tasks' });
    fireEvent.pointerDown(corner, { clientX: 1060, clientY: 640, button: 0, pointerId: 1 });
    act(() => {
      setWindow(960, 540);
      window.dispatchEvent(new Event('resize'));
    });
    // The box is now 100 × 50, so moving the corner one whole diagonal doubles it: scale 2,
    // rendered at 2 × 0.5.
    fireEvent.pointerMove(window, { clientX: 1160, clientY: 690, pointerId: 1 });
    expect(frame().style.transform).toBe('scale(1)');
    fireEvent.pointerUp(window, { clientX: 1160, clientY: 690, pointerId: 1 });
    expect(savedTasks()?.scale).toBe(2);
  });
});

describe('WidgetFrame outside settings (image widgets, spec §3.6)', () => {
  const imagePos = { x: 0.5, y: 0.5, scale: 1, autoHide: false };

  it('reads pos and saves through onPatch, closes through onClose', async () => {
    const user = userEvent.setup();
    const api = mockApi();
    installMockApi(api);
    const onPatch = vi.fn();
    const onClose = vi.fn();
    render(
      <WidgetFrame
        title="Image"
        pos={imagePos}
        onPatch={onPatch}
        onClose={onClose}
        headerExtra={<button type="button">Extra</button>}
      >
        <p>body</p>
      </WidgetFrame>,
    );
    const group = screen.getByRole('group', { name: 'Image' });
    expect(group.style.left).toBe('860px');
    expect(screen.getByRole('button', { name: 'Extra' })).toBeInTheDocument();
    const handle = screen.getByRole('button', { name: 'Move Image' });
    fireEvent.pointerDown(handle, { clientX: 500, clientY: 420, button: 0, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 596, clientY: 528, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 596, clientY: 528, pointerId: 1 });
    expect(onPatch).toHaveBeenCalledWith({ x: 0.55, y: 0.6 });
    await user.click(screen.getByRole('button', { name: 'Close Image' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(api.settings.set).not.toHaveBeenCalled();
  });

  it('renders an unchecked pos with a null scale at 1', () => {
    installMockApi(mockApi());
    render(
      <WidgetFrame title="Image" pos={{ ...imagePos, scale: null as unknown as number }}>
        <p>body</p>
      </WidgetFrame>,
    );
    expect(screen.getByRole('group', { name: 'Image' }).style.transform).toBe('scale(1)');
  });

  it('bare hides the header and the glass; the body is the drag handle', () => {
    const onPatch = vi.fn();
    installMockApi(mockApi());
    render(
      <WidgetFrame
        title="Image 1"
        chrome="bare"
        pos={imagePos}
        onPatch={onPatch}
        headerExtra={<button type="button">Show background</button>}
      >
        <p>picture</p>
      </WidgetFrame>,
    );
    const group = screen.getByRole('group', { name: 'Image 1' });
    expect(group.className).not.toMatch(/frosted/);
    expect(screen.queryByRole('button', { name: 'Close Image 1' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show background' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resize Image 1' })).toBeInTheDocument();
    const body = screen.getByRole('button', { name: 'Move Image 1' });
    expect(body).toContainElement(screen.getByText('picture'));
    // A click without a move does nothing.
    fireEvent.pointerDown(body, { clientX: 960, clientY: 560, button: 0, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 960, clientY: 560, pointerId: 1 });
    expect(onPatch).not.toHaveBeenCalled();
    fireEvent.pointerDown(body, { clientX: 960, clientY: 560, button: 0, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 1056, clientY: 668, pointerId: 1 });
    expect(group.style.left).toBe('956px');
    fireEvent.pointerUp(window, { clientX: 1056, clientY: 668, pointerId: 1 });
    expect(onPatch).toHaveBeenCalledWith({ x: 0.55, y: 0.6 });
  });

  it('bare moves with the arrow keys on the body', async () => {
    const user = userEvent.setup();
    const onPatch = vi.fn();
    installMockApi(mockApi());
    render(
      <WidgetFrame title="Image 1" chrome="bare" pos={imagePos} onPatch={onPatch}>
        <p>picture</p>
      </WidgetFrame>,
    );
    screen.getByRole('button', { name: 'Move Image 1' }).focus();
    await user.keyboard('{ArrowDown}');
    expect(onPatch).toHaveBeenCalledWith({ x: 0.5, y: 0.52 });
  });
});
