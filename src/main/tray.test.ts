import { EventEmitter } from 'node:events';
import type { Menu, MenuItemConstructorOptions } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import type { TimerState } from '../shared/types';
import { createTray, type TrayDeps } from './tray';
import { installQuit } from './windows';

const MIN = 60_000;

const state = (over: Partial<TimerState> = {}): TimerState => ({
  mode: 'focus',
  status: 'idle',
  remainingMs: 25 * MIN,
  segmentMs: 25 * MIN,
  completedFocusCount: 0,
  subjectId: null,
  pauseReason: null,
  todayFocusMs: 0,
  ...over,
});

function setup(over: Partial<TrayDeps> = {}) {
  let current = state();
  let visible = true;
  let mini = false;
  const menus: MenuItemConstructorOptions[][] = [];
  const tray = { setToolTip: vi.fn(), setContextMenu: vi.fn(), on: vi.fn(), destroy: vi.fn() };
  const deps: TrayDeps = {
    create: () => tray,
    buildMenu: (template) => {
      menus.push(template);
      return template as unknown as Menu;
    },
    getState: () => current,
    isMainVisible: () => visible,
    isMiniShown: () => mini,
    showMain: vi.fn(),
    toggleMain: vi.fn(),
    toggleTimer: vi.fn(),
    toggleMini: vi.fn(),
    quit: vi.fn(),
    ...over,
  };
  const t = createTray(deps);
  const menu = () => menus[menus.length - 1] ?? [];
  const item = (label: string) => menu().find((m) => m.label === label);
  const click = (label: string) => (item(label)?.click as (() => void) | undefined)?.();
  return {
    t,
    tray,
    deps,
    menus,
    menu,
    item,
    click,
    set: (s: Partial<TimerState>) => (current = state(s)),
    setVisible: (v: boolean) => (visible = v),
    setMini: (m: boolean) => (mini = m),
  };
}

describe('createTray (spec §3.7)', () => {
  it('builds the menu Show/Hide StudyAt · Start/Pause · Mini timer ✓ · Quit StudyAt', () => {
    const { menu } = setup();
    expect(menu().map((m) => m.label ?? m.type)).toEqual(['Hide StudyAt', 'Start', 'Mini timer', 'separator', 'Quit StudyAt']);
    expect(menu()[2]).toMatchObject({ type: 'checkbox', checked: false });
  });

  it('tray tooltip formats running time', () => {
    const { t, tray, set } = setup();
    expect(tray.setToolTip).toHaveBeenLastCalledWith('StudyAt');
    set({ status: 'running', remainingMs: 12 * MIN + 34_000 });
    t.refresh();
    expect(tray.setToolTip).toHaveBeenLastCalledWith('12:34 · Focus');
  });

  it('relabels the menu as the timer, window and mini change, and only then', () => {
    const { t, menus, item, set, setVisible, setMini } = setup();
    set({ status: 'running', remainingMs: 20 * MIN });
    t.refresh();
    expect(item('Pause')).toBeDefined();
    set({ status: 'running', remainingMs: 19 * MIN });
    t.refresh();
    expect(menus).toHaveLength(2);
    set({ status: 'paused', remainingMs: 19 * MIN });
    setVisible(false);
    setMini(true);
    t.refresh();
    expect(item('Resume')).toBeDefined();
    expect(item('Show StudyAt')).toBeDefined();
    expect(item('Mini timer')?.checked).toBe(true);
  });

  it('menu items call their actions', () => {
    const { click, deps } = setup();
    click('Hide StudyAt');
    click('Start');
    click('Mini timer');
    expect(deps.toggleMain).toHaveBeenCalledTimes(1);
    expect(deps.toggleTimer).toHaveBeenCalledTimes(1);
    expect(deps.toggleMini).toHaveBeenCalledTimes(1);
  });

  it('a click on the icon shows the window', () => {
    const { tray, deps } = setup();
    const onClick = tray.on.mock.calls.find((c) => c[0] === 'click')?.[1] as () => void;
    onClick();
    expect(deps.showMain).toHaveBeenCalled();
  });

  it('quit from tray calls timer.quit then app.quit', async () => {
    const order: string[] = [];
    const app = new (class extends EventEmitter {
      exited = false;
      quit = vi.fn(() => {
        order.push('app.quit');
        let prevented = false;
        this.emit('before-quit', { preventDefault: () => (prevented = true) });
        if (!prevented) this.exited = true;
      });
    })();
    const timer = {
      quit: vi.fn(async () => {
        order.push('timer.quit');
        await Promise.resolve();
      }),
    };
    installQuit(app, () => timer.quit());
    const { click } = setup({ quit: () => app.quit() });

    click('Quit StudyAt');
    expect(app.exited).toBe(false); // held until the timer has saved
    await new Promise((r) => setTimeout(r, 0));
    expect(order).toEqual(['app.quit', 'timer.quit', 'app.quit']);
    expect(app.exited).toBe(true);
  });

  it('does nothing after destroy', () => {
    const { t, tray, set } = setup();
    t.destroy();
    set({ status: 'running' });
    t.refresh();
    expect(tray.destroy).toHaveBeenCalled();
    expect(tray.setToolTip).toHaveBeenCalledTimes(1);
  });
});
