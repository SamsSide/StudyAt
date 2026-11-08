// The global start/pause hotkey (spec §3.7; Sam's extra). Default Ctrl+Alt+P, editable in Settings,
// empty = off. A shortcut another app holds, or one Electron can't parse, is a readable error for
// Settings → Shortcuts and never a crash; the previous hotkey stays live until a new one succeeds.

/** The slice of Electron's `globalShortcut` this needs (injected for tests). */
export interface ShortcutRegistry {
  register(accelerator: string, callback: () => void): boolean;
  unregister(accelerator: string): void;
}

export type HotkeyResult = { ok: true } | { ok: false; error: string };

/**
 * Presses closer together than this are one press: Windows repeats a held hotkey, and each repeat
 * would otherwise toggle the timer again (Review Focus 5: one `toggle` per press). The gap counts
 * from the latest repeat, so holding the keys down never toggles twice.
 */
export const PRESS_GAP_MS = 400;

export class GlobalHotkey {
  /** The accelerator currently registered; '' when off. */
  active = '';
  private lastPress = -Infinity;

  constructor(
    private readonly registry: ShortcutRegistry,
    private readonly onPress: () => void,
    private readonly now: () => number,
  ) {}

  /**
   * Makes `accelerator` the hotkey. The new one is registered before the old one is released, so a
   * failure leaves the old hotkey working.
   */
  register(accelerator: string): HotkeyResult {
    const accel = accelerator.trim();
    if (accel === this.active) return { ok: true };
    if (accel === '') {
      this.release();
      return { ok: true };
    }
    let ok: boolean;
    try {
      ok = this.registry.register(accel, () => this.press());
    } catch {
      return { ok: false, error: `${accel} can’t be used as a shortcut. Choose another shortcut.` };
    }
    if (!ok) return { ok: false, error: `${accel} is in use by another app. Choose another shortcut.` };
    this.release();
    this.active = accel;
    return { ok: true };
  }

  dispose(): void {
    this.release();
  }

  private press(): void {
    const at = this.now();
    const repeat = at - this.lastPress < PRESS_GAP_MS;
    this.lastPress = at;
    if (!repeat) this.onPress();
  }

  private release(): void {
    if (this.active) this.registry.unregister(this.active);
    this.active = '';
  }
}

/** The slice of `ipcMain` that `registerIpc` uses (matches its `IpcMainLike`). */
export interface IpcHandleLike<E = unknown> {
  handle(channel: string, listener: (event: E, ...args: unknown[]) => unknown): void;
}

/**
 * Wraps `ipc` so a `settings:set` naming a new `globalHotkey` registers it before anything is saved
 * (spec §3.7, §7 "Global hotkey taken"). On failure the old hotkey stays live and stored, nothing in
 * the patch is saved, and the call rejects with the readable sentence Settings → Shortcuts shows.
 * Untrusted senders never reach the hotkey: `registerIpc` refuses them, so this does too.
 */
export function guardHotkeySetting<E>(
  ipc: IpcHandleLike<E>,
  settingsChannel: string,
  hotkey: Pick<GlobalHotkey, 'register'>,
  isTrusted: (event: E) => boolean = () => true,
): IpcHandleLike<E> {
  return {
    handle(channel, listener) {
      if (channel !== settingsChannel) {
        ipc.handle(channel, listener);
        return;
      }
      ipc.handle(channel, (event, ...args) => {
        const patch = args[0];
        if (isTrusted(event) && typeof patch === 'object' && patch !== null && 'globalHotkey' in patch) {
          const accel = (patch as { globalHotkey: unknown }).globalHotkey;
          if (typeof accel === 'string' && accel.length <= 500) {
            const res = hotkey.register(accel);
            if (!res.ok) throw new Error(res.error);
          }
        }
        return listener(event, ...args);
      });
    },
  };
}
