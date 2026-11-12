// The many-of-a-kind floating widgets (v1.1 spec §3.6, v1.2 spec §3.2): each kind keeps its own
// store and renders its own WidgetFrame instances (own `pos`, `onPatch`, `onClose`), none of them
// auto-hiding. The shell draws them after the fixed widgets, in this order. A new kind (stats
// widgets next) adds its list component here and nothing else in the shell changes.
import type { ComponentType } from 'react';
import { ImageWidgets } from '../images/ImageWidget';
import { NoteStickies } from '../notes/NoteSticky';

/** Every kind of floating instance, drawn in this order (later ones on top). */
export const FLOATING_KINDS: readonly ComponentType[] = [ImageWidgets, NoteStickies];

export function FloatingInstances() {
  return (
    <>
      {FLOATING_KINDS.map((Kind, i) => (
        <Kind key={i} />
      ))}
    </>
  );
}
