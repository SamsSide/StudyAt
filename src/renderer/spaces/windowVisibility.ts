// Whether the app window is on screen (spec §3.8: the background pauses while the window is
// hidden or minimised). The window runs with `backgroundThrottling: false`, so Electron keeps
// `document.hidden` false when it is minimised or hidden to the tray; main reports visibility
// instead (`app.onVisibility`, wired to `setVisible` by the shell).
import { create } from 'zustand';

export interface WindowVisibilityState {
  visible: boolean;
  setVisible(visible: boolean): void;
}

export const useWindowVisibility = create<WindowVisibilityState>((set) => ({
  visible: true,
  setVisible(visible) {
    set({ visible });
  },
}));
