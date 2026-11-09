// Image and GIF widgets (v1.1 spec §3.6, appplan §4.10): each image floats in its own WidgetFrame,
// placed after the fixed widgets. Framed (`bare = false`) is the usual glass with the header
// title "Image", a background toggle and a close button that removes the image after asking.
// Bare is just the image, the frame's body being the drag handle (label "Image {n}"), with a
// small toolbar above its top-right corner: "Show background" and "Remove". Images never
// auto-hide; the toolbar and the resize corner fade with the chrome and in focus view.
//
// The body has an explicit size, the image fitted inside 240 × 240 keeping its aspect ratio: the
// frame's layout box is the unscaled size and it scales that box itself (spec §3.5), so a body
// that shrank to fit near the window edge would scale wrong.
import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import type { ImageWidget as ImageData } from '../../shared/types';
import { Icon } from '../shell/icons';
import shell from '../shell/shell.module.css';
import { type FramePatch, WidgetFrame } from '../shell/WidgetFrame';
import styles from './images.module.css';
import { useImagesStore } from './imagesStore';

/** The longest side of an image at scale 1 and layout scale 1, in px (spec §3.6). */
export const IMAGE_BASE_PX = 240;

/** The image fitted inside 240 × 240, keeping its aspect ratio, in whole px. */
export function baseSize(width: number, height: number): { w: number; h: number } {
  if (!(width > 0) || !(height > 0)) return { w: IMAGE_BASE_PX, h: IMAGE_BASE_PX };
  const k = IMAGE_BASE_PX / Math.max(width, height);
  return { w: Math.max(1, Math.round(width * k)), h: Math.max(1, Math.round(height * k)) };
}

/** Every image widget, numbered in the order main lists them (oldest first). */
export function ImageWidgets() {
  const images = useImagesStore((s) => s.images);
  return (
    <>
      {images.map((image, i) => (
        <ImageWidget key={image.id} image={image} n={i + 1} />
      ))}
    </>
  );
}

export function ImageWidget({ image, n }: { image: ImageData; n: number }) {
  const patch = useImagesStore((s) => s.patch);
  const remove = useImagesStore((s) => s.remove);
  // The file has gone from the images folder (the protocol answers 404): say so and offer Remove.
  const [missing, setMissing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const removeRef = useRef<HTMLButtonElement>(null);
  const reopened = useRef(false);

  // The safe choice has focus while asking; afterwards focus goes back where the question came from.
  useEffect(() => {
    if (confirming) cancelRef.current?.focus();
    else if (reopened.current) {
      reopened.current = false;
      // The bare toolbar's Remove was swapped for the question, so its new copy takes focus.
      const back = opener.current?.isConnected ? opener.current : removeRef.current;
      back?.focus();
    }
  }, [confirming]);

  const label = `Image ${n}`;
  // A missing image shows in the glass, so its message and Remove sit on something readable.
  const bare = image.bare && !missing;
  const size = baseSize(image.width, image.height);

  const ask = (): void => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setConfirming(true);
  };
  const cancel = (): void => {
    reopened.current = true;
    setConfirming(false);
  };
  const onConfirmKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'Escape') return;
    // Esc answers the question and goes no further (useShortcuts skips a handled key).
    e.preventDefault();
    cancel();
  };
  const onPatch = (p: FramePatch): void => void patch(image.id, p);

  const confirm = (
    <div className={styles.confirm} role="group" aria-label="Remove this image?" onKeyDown={onConfirmKey}>
      <span className={styles.confirmText}>Remove this image?</span>
      <button ref={cancelRef} type="button" className={styles.textButton} onClick={cancel}>
        Cancel
      </button>
      <button type="button" className={styles.dangerButton} onClick={() => void remove(image.id)}>
        Remove
      </button>
    </div>
  );

  const picture = (
    <div className={styles.picture} style={{ width: size.w, height: size.h }}>
      {missing ? (
        <div className={styles.missing}>
          <span>Image missing</span>
          <button type="button" className={styles.dangerButton} onClick={() => void remove(image.id)}>
            Remove
          </button>
        </div>
      ) : (
        <img
          className={styles.image}
          src={image.url}
          alt={label}
          draggable={false}
          onError={() => setMissing(true)}
        />
      )}
    </div>
  );

  const pos = { x: image.x, y: image.y, scale: image.scale, autoHide: false };

  if (bare) {
    return (
      <WidgetFrame
        title={label}
        bodyLabel={label}
        chrome="bare"
        pos={pos}
        onPatch={onPatch}
        headerExtra={
          confirming ? (
            confirm
          ) : (
            <>
              <button
                type="button"
                className={styles.textButton}
                onClick={() => void patch(image.id, { bare: false })}
              >
                Show background
              </button>
              <button ref={removeRef} type="button" className={styles.textButton} onClick={ask}>
                Remove
              </button>
            </>
          )
        }
      >
        {picture}
      </WidgetFrame>
    );
  }

  return (
    <WidgetFrame
      title="Image"
      pos={pos}
      onPatch={onPatch}
      onClose={ask}
      headerExtra={
        missing ? undefined : (
          <button
            type="button"
            className={`${shell.iconButton} ${shell.small}`}
            aria-label="Hide background"
            title="Hide background"
            onClick={() => void patch(image.id, { bare: true })}
          >
            <Icon name="eyeOff" />
          </button>
        )
      }
    >
      {picture}
      {confirming && confirm}
    </WidgetFrame>
  );
}
