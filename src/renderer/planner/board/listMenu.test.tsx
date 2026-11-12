import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskList } from '../../../shared/types';
import { resetStudyStore, useStudyStore } from '../../shell/store';
import { installMockApi, mockApi, seedSubjects, type MockApi } from '../../test/mockApi';
import { ListMenu } from '../ListMenu';
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
