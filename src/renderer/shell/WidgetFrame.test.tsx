import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../shared/settings';
import type { PublicSettings } from '../../shared/types';
import { installMockApi, mockApi } from '../test/mockApi';
import { resetStudyStore, useStudyStore } from './store';
import { WidgetFrame } from './WidgetFrame';

const settingsWith = (x: number, y: number): PublicSettings => {
  const { spotifyTokens: _t, ...rest } = structuredClone(DEFAULT_SETTINGS);
  return { ...rest, widgets: { ...rest.widgets, tasks: { open: true, x, y, autoHide: false } } };
};

function setWindow(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
}

beforeEach(() => {
  resetStudyStore();
  setWindow(1000, 800);
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
    expect(frame().style.left).toBe('400px');
    expect(frame().style.top).toBe('200px');
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
    // 12 px clear of the right and bottom edges: 1000 - 12 - 200 and 800 - 12 - 100.
    expect(frame().style.left).toBe('788px');
    expect(frame().style.top).toBe('688px');
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
    expect(frame().style.left).toBe('500px');
    expect(frame().style.top).toBe('500px');
    expect(api.settings.set).not.toHaveBeenCalled();
    fireEvent.pointerMove(window, { clientX: 2500, clientY: -900, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 2500, clientY: -900, pointerId: 1 });
    expect(frame().style.left).toBe('788px');
    expect(frame().style.top).toBe('76px');
    expect(api.settings.set).toHaveBeenCalledWith({
      widgets: { tasks: { open: true, x: 0.888, y: 0.095, autoHide: false } },
    });
    await waitFor(() => expect(useStudyStore.getState().settings?.widgets.tasks.x).toBe(0.888));
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
    expect(frame().style.left).toBe('400px');
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
    expect(frame().style.left).toBe('788px');
    expect(frame().style.top).toBe('688px');
    act(() => {
      setWindow(500, 400);
      window.dispatchEvent(new Event('resize'));
    });
    expect(frame().style.left).toBe('288px');
    expect(frame().style.top).toBe('288px');
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
      widgets: { tasks: { open: true, x: 0.52, y: 0.5, autoHide: false } },
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
      widgets: { tasks: { open: false, x: 0.5, y: 0.5, autoHide: false } },
    });
  });
});
