// Renderer-side image widgets (v1.1 spec §3.6, appplan §4.10). Main owns the rows and the files;
// this mirrors them for the shell's floating widgets and the "Add image…" dialog.
import { create } from 'zustand';
import type { ImageAddResult, ImagePatch, ImageWidget } from '../../shared/types';
import { logIpcError } from '../lib/ipcError';

/** Shown when the add call itself fails (main unreachable), rather than answering with a reason. */
export const ADD_FAILED = "Couldn't add that image.";

export interface ImagesState {
  images: ImageWidget[];
  /** The "Add image…" dialog is open. */
  adding: boolean;
  setAdding(open: boolean): void;
  load(): Promise<void>;
  /** Main shows the file dialog; a cancelled one answers `{ error: '' }`. */
  addFile(): Promise<ImageAddResult>;
  addUrl(url: string): Promise<ImageAddResult>;
  /** Optimistic, so a drag or a toggle shows at once; undone if main fails. */
  patch(id: number, p: ImagePatch): Promise<void>;
  remove(id: number): Promise<void>;
}

// The newest patch per image. A reply to an older one is dropped, so a quick drag then a toggle
// never jumps back to a state already left.
let patchSeq = new Map<number, number>();

const added = (result: ImageAddResult): result is ImageWidget => 'id' in result;

export const useImagesStore = create<ImagesState>((set, get) => {
  const add = async (call: () => Promise<ImageAddResult>): Promise<ImageAddResult> => {
    let result: ImageAddResult;
    try {
      result = await call();
    } catch (e) {
      logIpcError('Adding an image failed', e);
      return { error: ADD_FAILED };
    }
    if (added(result)) {
      set({ images: [...get().images.filter((i) => i.id !== result.id), result] });
    }
    return result;
  };

  return {
    images: [],
    adding: false,
    setAdding(adding) {
      set({ adding });
    },
    async load() {
      try {
        set({ images: await window.studyat.images.list() });
      } catch (e) {
        // Never rejects: the shell calls this unattended; the space is fine without its images.
        logIpcError('Loading images failed', e);
      }
    },
    addFile: () => add(() => window.studyat.images.addFile()),
    addUrl: (url) => add(() => window.studyat.images.addUrl(url)),
    async patch(id, p) {
      const before = get().images.find((i) => i.id === id);
      if (!before) return;
      const seq = (patchSeq.get(id) ?? 0) + 1;
      patchSeq.set(id, seq);
      const replace = (next: ImageWidget | null): void =>
        set({
          images: next
            ? get().images.map((i) => (i.id === id ? next : i))
            : get().images.filter((i) => i.id !== id),
        });
      replace({ ...before, ...p });
      try {
        const saved = await window.studyat.images.update(id, p);
        // null: main has no such image (removed elsewhere), so neither should the screen.
        if (patchSeq.get(id) === seq) replace(saved);
      } catch (e) {
        logIpcError('Saving an image failed', e);
        if (patchSeq.get(id) === seq && get().images.some((i) => i.id === id)) replace(before);
      }
    },
    async remove(id) {
      try {
        await window.studyat.images.remove(id);
        set({ images: get().images.filter((i) => i.id !== id) });
      } catch (e) {
        logIpcError('Removing an image failed', e);
      }
    },
  };
});

/** Back to an empty mirror (tests). */
export function resetImagesStore(): void {
  patchSeq = new Map();
  useImagesStore.setState({ images: [], adding: false });
}
