// The revision offer (v1.2 spec §3.9): "Schedule revision?" with the day chips, Add and Not now.
// It stays until answered, another task is ticked, or the view closes (the store clears it on a
// tick; PlannerWidget dismisses it on unmount). Mounted by the planner widget and the board.
import { Fragment, useRef, useState } from 'react';
import { DEFAULT_SETTINGS } from '../../shared/settings';
import { useStudyStore } from '../shell/store';
import { usePlannerStore } from './plannerStore';
import styles from './RevisionBar.module.css';

const FALLBACK_DAYS: readonly number[] = DEFAULT_SETTINGS.revisionDays;

export function RevisionBar() {
  const offer = usePlannerStore((s) => s.revisionOffer);
  const setOfferDays = usePlannerStore((s) => s.setOfferDays);
  const dismissOffer = usePlannerStore((s) => s.dismissOffer);
  const scheduleRevision = usePlannerStore((s) => s.scheduleRevision);
  const configured = useStudyStore((s) => s.settings?.revisionDays);

  const [pending, setPending] = useState(false);
  const locked = useRef(false);

  if (!offer) return null;
  // The chips are the settings' days; the offer holds which are on, so a chip turned off stays to turn back on.
  const chips = [...new Set([...(configured ?? FALLBACK_DAYS), ...offer.days])].sort((a, b) => a - b);

  const toggle = (day: number): void =>
    setOfferDays(
      offer.days.includes(day) ? offer.days.filter((d) => d !== day) : [...offer.days, day].sort((a, b) => a - b),
    );

  // One Add is one call: the ref locks synchronously (a double click lands before a re-render).
  const add = async (): Promise<void> => {
    if (locked.current) return;
    locked.current = true;
    setPending(true);
    try {
      await scheduleRevision(offer.taskId, offer.days);
    } finally {
      locked.current = false;
      setPending(false);
    }
  };

  return (
    <div role="group" aria-label="Schedule revision" className={styles.bar}>
      <span>Schedule revision?</span>
      <div className={styles.chips}>
        {chips.map((day, i) => (
          <Fragment key={day}>
            {i > 0 && <span aria-hidden="true">{' · '}</span>}
            <button
              type="button"
              className={styles.button}
              aria-label={`${day} ${day === 1 ? 'day' : 'days'}`}
              aria-pressed={offer.days.includes(day)}
              onClick={() => toggle(day)}
            >
              {day}
            </button>
          </Fragment>
        ))}
        <span>{chips.length === 1 && chips[0] === 1 ? ' day' : ' days'}</span>
      </div>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.button}
          disabled={offer.days.length === 0 || pending}
          onClick={() => void add()}
        >
          Add
        </button>
        <button type="button" className={styles.button} disabled={pending} onClick={dismissOffer}>
          Not now
        </button>
      </div>
    </div>
  );
}
