// The system tray (spec §3.7): icon, a tooltip with the remaining time and mode, and the menu
// Show/Hide StudyAt · Start/Pause · Mini timer ✓ · Quit StudyAt. A left click brings the window
// back. Electron's Tray and Menu are injected so this runs under a unit test.
import type { Menu, MenuItemConstructorOptions } from 'electron';
import type { TimerState } from '../shared/types';
import { trayTooltip } from './windows';

/** The slice of Electron's `Tray` this needs. */
export interface TrayLike {
  setToolTip(text: string): void;
  setContextMenu(menu: Menu | null): void;
  on(event: 'click' | 'double-click', listener: () => void): void;
  destroy(): void;
}

export interface TrayDeps {
  create(): TrayLike;
  buildMenu(template: MenuItemConstructorOptions[]): Menu;
  getState(): TimerState;
  isMainVisible(): boolean;
  isMiniShown(): boolean;
  showMain(): void;
  toggleMain(): void;
  /** `timer.toggle()`: idle → start, running → pause, paused → resume. */
  toggleTimer(): void;
  toggleMini(): void;
  /** `app.quit()`; the before-quit handler saves first. */
  quit(): void;
}

export interface AppTray {
  tray: TrayLike;
  /** Re-reads the timer, window and mini state; the menu is rebuilt only when a label changes. */
  refresh(state?: TimerState): void;
  destroy(): void;
}

const TIMER_LABEL = { idle: 'Start', running: 'Pause', paused: 'Resume' } as const;

export function createTray(deps: TrayDeps): AppTray {
  const tray = deps.create();
  let tooltip = '';
  let menuKey = '';
  let destroyed = false;

  const refresh = (state: TimerState = deps.getState()): void => {
    if (destroyed) return;
    const nextTip = trayTooltip(state);
    if (nextTip !== tooltip) {
      tooltip = nextTip;
      tray.setToolTip(nextTip);
    }
    const visible = deps.isMainVisible();
    const mini = deps.isMiniShown();
    const key = `${visible}|${state.status}|${mini}`;
    if (key === menuKey) return;
    menuKey = key;
    tray.setContextMenu(
      deps.buildMenu([
        { label: visible ? 'Hide StudyAt' : 'Show StudyAt', click: () => deps.toggleMain() },
        { label: TIMER_LABEL[state.status], click: () => deps.toggleTimer() },
        { label: 'Mini timer', type: 'checkbox', checked: mini, click: () => deps.toggleMini() },
        { type: 'separator' },
        { label: 'Quit StudyAt', click: () => deps.quit() },
      ]),
    );
  };

  tray.on('click', () => deps.showMain());
  tray.on('double-click', () => deps.showMain());
  refresh();

  return {
    tray,
    refresh,
    destroy() {
      destroyed = true;
      tray.destroy();
    },
  };
}
