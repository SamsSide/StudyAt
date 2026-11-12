import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskList } from '../../../shared/types';
import { resetStudyStore, useStudyStore } from '../../shell/store';
import { installMockApi, mockApi, seedSubjects, type MockApi } from '../../test/mockApi';
import { Overlay } from '../../shell/Overlay';
import { ListMenu, menuSpot } from '../ListMenu';
import { ListsView } from '../ListsView';
import { resetPlannerStore, usePlannerStore } from '../plannerStore';

const list = (over: Partial<TaskList> = {}): TaskList => ({
  id: 10,
  name: 'Networks',
  subjectId: null,
  sort: 0,
  createdAt: 0,
  ...over,
});

let api: MockApi;

beforeEach(() => {
  resetPlannerStore();
  resetStudyStore();
  useStudyStore.setState({ subjects: seedSubjects() });
  api = mockApi();
  installMockApi(api);
});

describe('ListMenu', () => {
  it('closes on a press outside, and when focus moves out', async () => {
    render(
      <div>
        <ListMenu list={list()} />
        <ListMenu list={list({ id: 11, name: 'Someday' })} />
        <button type="button">Elsewhere</button>
      </div>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Networks menu' }));
    expect(screen.getByRole('group', { name: 'List actions' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Elsewhere' }));
    expect(screen.queryByRole('group', { name: 'List actions' })).not.toBeInTheDocument();

    // Opening a second menu leaves only that one open.
    await userEvent.click(screen.getByRole('button', { name: 'Networks menu' }));
    await userEvent.click(screen.getByRole('button', { name: 'Someday menu' }));
    expect(screen.getAllByRole('group', { name: 'List actions' })).toHaveLength(1);
  });

  it('closes when focus tabs out of it', async () => {
    render(
      <div>
        <ListMenu list={list()} />
        <button type="button">Elsewhere</button>
      </div>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Networks menu' }));
    screen.getByRole('button', { name: 'Elsewhere' }).focus();
    await waitFor(() =>
      expect(screen.queryByRole('group', { name: 'List actions' })).not.toBeInTheDocument(),
    );
  });

  it('Rename opens "New name" and Save updates the list', async () => {
    render(<ListMenu list={list()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Networks menu' }));
    await userEvent.click(screen.getByRole('button', { name: 'Rename' }));
    const input = screen.getByRole('textbox', { name: 'New name' });
    expect(input).toHaveFocus();
    await userEvent.clear(input);
    await userEvent.type(input, 'Networks 2');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(api.lists.update).toHaveBeenCalledWith(10, { name: 'Networks 2' });
  });

  it('Link subject to a real subject sends its id', async () => {
    render(<ListMenu list={list()} />);
    const subject = seedSubjects()[1]!;
    await userEvent.click(screen.getByRole('button', { name: 'Networks menu' }));
    await userEvent.click(screen.getByRole('button', { name: 'Link subject' }));
    await userEvent.click(screen.getByRole('button', { name: subject.name }));
    expect(api.lists.update).toHaveBeenCalledWith(10, { subjectId: subject.id });
  });

  it('tells its host once the list is deleted', async () => {
    const onDeleted = vi.fn();
    render(<ListMenu list={list()} onDeleted={onDeleted} />);
    await userEvent.click(screen.getByRole('button', { name: 'Networks menu' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
  });
});

describe('ListMenu in the widget Lists view', () => {
  it('renames, and after Delete focus lands on the list picker', async () => {
    usePlannerStore.setState({ lists: [list()], listId: 10 });
    vi.mocked(api.lists.update).mockResolvedValue([list({ name: 'Networks' })]);
    vi.mocked(api.planner.lists).mockResolvedValue({ lists: [list()], tasks: [], deadlines: [] });
    render(<ListsView />);
    await userEvent.click(await screen.findByRole('button', { name: 'Networks menu' }));
    await userEvent.click(screen.getByRole('button', { name: 'Rename' }));
    await userEvent.clear(screen.getByRole('textbox', { name: 'New name' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'New name' }), 'Nets{Enter}');
    expect(api.lists.update).toHaveBeenCalledWith(10, { name: 'Nets' });

    await userEvent.click(screen.getByRole('button', { name: 'Networks menu' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'List' })).toHaveFocus());
  });
});

describe('menuSpot (the portalled panel, kept clear of the clipping list row)', () => {
  const win = { w: 1000, h: 800 };
  const panel = { w: 180, h: 200 };
  const at = (left: number, top: number) => ({ left, top, right: left + 28, bottom: top + 28 });

  it('opens below the trigger with right edges aligned', () => {
    expect(menuSpot(at(500, 100), panel, win)).toEqual({ left: 528 - 180, top: 132 });
  });

  it('flips above when there is no room below', () => {
    // Trigger 700-728: below would end at 932 > 792; above starts at 700 - 4 - 200.
    expect(menuSpot(at(500, 700), panel, win)).toEqual({ left: 348, top: 496 });
  });

  it('opens rightwards from the left-most list, where right-aligned would leave the window', () => {
    expect(menuSpot(at(20, 100), panel, win)).toEqual({ left: 20, top: 132 });
  });

  it('stays inside the window when neither way fits', () => {
    const tall = { w: 180, h: 790 };
    expect(menuSpot(at(500, 400), tall, win).top).toBe(8);
  });
});

describe('ListMenu panel outside the list row', () => {
  it('portals the panel to the body, fixed at the spot below its trigger', async () => {
    const { container } = render(<ListMenu list={list()} />);
    const trigger = screen.getByRole('button', { name: 'Networks menu' });
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({
      left: 500,
      top: 100,
      right: 528,
      bottom: 128,
      width: 28,
      height: 28,
      x: 500,
      y: 100,
      toJSON: () => ({}),
    } as DOMRect);
    await userEvent.click(trigger);
    const panel = screen.getByRole('group', { name: 'List actions' });
    expect(container.contains(panel)).toBe(false);
    expect(panel.parentElement).toBe(document.body);
    // jsdom lays out nothing, so the panel measures 0 × 0: its right edge sits at the trigger's.
    expect(panel.style.left).toBe('528px');
    expect(panel.style.top).toBe('132px');
    expect(trigger).toHaveAttribute('aria-controls', panel.id);
  });

  it('Esc closes it and returns focus to the trigger; a click inside the panel keeps it open', async () => {
    render(<ListMenu list={list()} />);
    const trigger = screen.getByRole('button', { name: 'Networks menu' });
    await userEvent.click(trigger);
    expect(screen.getByRole('button', { name: 'Rename' })).toHaveFocus();
    await userEvent.click(screen.getByRole('button', { name: 'Link subject' }));
    const none = screen.getByRole('button', { name: 'None' });
    expect(none).toHaveFocus();
    fireEvent.keyDown(none, { key: 'Escape' });
    expect(screen.queryByRole('group', { name: 'List actions' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});

describe('ListMenu inside the board overlay (aria-modal)', () => {
  const onBoard = () =>
    render(
      <Overlay title="Tasks" onClose={() => {}} full>
        <ListMenu list={list()} />
        <button type="button">After</button>
      </Overlay>,
    );

  it('portals the panel inside the dialog, not to the body', async () => {
    onBoard();
    await userEvent.click(screen.getByRole('button', { name: 'Networks menu' }));
    const panel = screen.getByRole('group', { name: 'List actions' });
    expect(screen.getByRole('dialog', { name: 'Tasks' }).contains(panel)).toBe(true);
    expect(panel.parentElement).not.toBe(document.body);
  });

  it('Tab from the last item returns to the trigger and closes the menu', async () => {
    onBoard();
    const trigger = screen.getByRole('button', { name: 'Networks menu' });
    await userEvent.click(trigger);
    screen.getByRole('button', { name: 'Delete' }).focus();
    await userEvent.tab();
    expect(trigger).toHaveFocus();
    expect(screen.queryByRole('group', { name: 'List actions' })).not.toBeInTheDocument();
  });

  it('Shift+Tab from the first item returns to the trigger and closes the menu', async () => {
    onBoard();
    const trigger = screen.getByRole('button', { name: 'Networks menu' });
    await userEvent.click(trigger);
    expect(screen.getByRole('button', { name: 'Rename' })).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(trigger).toHaveFocus();
    expect(screen.queryByRole('group', { name: 'List actions' })).not.toBeInTheDocument();
  });

  it('Tab between items stays in the panel', async () => {
    onBoard();
    await userEvent.click(screen.getByRole('button', { name: 'Networks menu' }));
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Link subject' })).toHaveFocus();
  });
});

describe('ListMenu trigger scrolled out of view', () => {
  it('closes the menu, with focus back on the trigger', async () => {
    render(<ListMenu list={list()} />);
    const trigger = screen.getByRole('button', { name: 'Networks menu' });
    await userEvent.click(trigger);
    expect(screen.getByRole('group', { name: 'List actions' })).toBeInTheDocument();
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({
      left: 500,
      top: -80,
      right: 528,
      bottom: -52,
      width: 28,
      height: 28,
      x: 500,
      y: -80,
      toJSON: () => ({}),
    } as DOMRect);
    fireEvent.scroll(window);
    expect(screen.queryByRole('group', { name: 'List actions' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
