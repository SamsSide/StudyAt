// Stats widgets (v1.2 spec §3.12, appplan §4.7, §4.10): up to six live cards pinned on the space,
// each its own WidgetFrame instance after the fixed widgets, never auto-hiding. Framed is the
// glass with the card's name as the header handle, a range switch (Today · Week · Month), the
// "Stats widget menu" (change card, hide background, remove) and a close button that removes it.
// Bare drops the glass and the header: the card floats on its own, and the range switch and the
// menu move to the frame's toolbar, which fades in on hover or focus beside the keyboard move handle.
//
// Every number comes from main (`stats.card`); a card refetches on mount, on a range or card
// change, at each segment end, at each whole focus minute and on refreshStatCards() (a session
// edited or deleted in Stats). Between those, a Total card adds the focus time accrued since its
// fetch (the timer's today figure now, less what it was when the answer landed), and only while a
// focus segment runs, so it ticks every second then; breaks, pauses and an idle timer add nothing
// (appplan §5). Main already counts the live segment into each answer, so nothing counts twice,
// and a session deleted while the timer is still can't come back from a stale today figure.
import {
  type FocusEvent,
  type KeyboardEvent,
  type RefObject,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import type { CardData, StatCard, StatRange, StatWidget as StatWidgetData } from '../../shared/types';
import { isFocusMode } from '../../shared/modes';
import { logIpcError } from '../lib/ipcError';
import shell from '../shell/shell.module.css';
import { useStudyStore } from '../shell/store';
import { type FramePatch, WidgetFrame } from '../shell/WidgetFrame';
import { EstimatesCard, GoalCard, SubjectsCard, TotalCard } from './cards';
import styles from './statWidgets.module.css';
import { refreshStatCards, useStatWidgetsStore } from './statWidgetsStore';

export const CARD_NAMES: Record<StatCard, string> = {
  total: 'Total time',
  subjects: 'By subject',
  goal: 'Goal + streak',
  estimates: 'Estimates',
};

const CARDS: readonly StatCard[] = ['total', 'subjects', 'goal', 'estimates'];

const RANGES: readonly { value: StatRange; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
];

const MINUTE = 60_000;

/** Every stats widget, in the order main lists them; loads them and keeps their cards fresh. */
export function StatWidgets() {
  const widgets = useStatWidgetsStore((s) => s.widgets);

  useEffect(() => void useStatWidgetsStore.getState().load(), []);

  // A segment end and each whole focus minute refetch every card, as the top bar's ring does.
  useEffect(() => {
    let minute = Math.floor(useStudyStore.getState().timer.todayFocusMs / MINUTE);
    const stops = [
      window.studyat.timer.onSegmentEnd(() => refreshStatCards()),
      useStudyStore.subscribe((s) => {
        const now = Math.floor(s.timer.todayFocusMs / MINUTE);
        if (now === minute) return;
        minute = now;
        refreshStatCards();
      }),
    ];
    return () => {
      for (const stop of stops) stop();
    };
  }, []);

  return (
    <>
      {widgets.map((w) => (
        <StatWidget key={w.id} widget={w} />
      ))}
    </>
  );
}

/** `focusMsAtFetch`: the timer's today focus figure when this answer landed. */
type Load =
  { status: 'loading' } | { status: 'ready'; data: CardData; focusMsAtFetch: number } | { status: 'error' };

/** Main's answer for this card and range, asked again whenever `revision` or `retry` moves. */
function useCardData(card: StatCard, range: StatRange, retry: number): Load {
  const revision = useStatWidgetsStore((s) => s.revision);
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  useEffect(() => {
    let live = true;
    window.studyat.stats.card(card, range).then(
      (data) => {
        if (!live) return;
        const focusMsAtFetch = useStudyStore.getState().timer.todayFocusMs;
        setLoad({ status: 'ready', data, focusMsAtFetch });
      },
      (e: unknown) => {
        logIpcError('Loading a stats card failed', e);
        if (live) setLoad({ status: 'error' });
      },
    );
    return () => {
      live = false;
    };
  }, [card, range, revision, retry]);
  return load;
}

export function StatWidget({ widget }: { widget: StatWidgetData }) {
  const patch = useStatWidgetsStore((s) => s.patch);
  const remove = useStatWidgetsStore((s) => s.remove);
  // The timer's today figure while a focus segment runs; null when nothing is accruing.
  const runningFocusMs = useStudyStore((s) =>
    s.timer.status === 'running' && isFocusMode(s.timer.mode) ? s.timer.todayFocusMs : null,
  );
  const [retry, setRetry] = useState(0);
  const load = useCardData(widget.card, widget.range, retry);
  const menuButton = useRef<HTMLButtonElement>(null);
  // A background toggle swaps the frame's whole tree; the menu button keeps focus across it.
  const refocus = useRef(false);

  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    menuButton.current?.focus();
  }, [widget.bare]);

  const name = CARD_NAMES[widget.card];
  const onPatch = (p: FramePatch): void => void patch(widget.id, p);
  const pos = { x: widget.x, y: widget.y, scale: widget.scale, autoHide: false };

  const controls = (
    <>
      <RangeSwitch
        range={widget.range}
        bare={widget.bare}
        onChange={(range) => void patch(widget.id, { range })}
      />
      <StatMenu
        buttonRef={menuButton}
        card={widget.card}
        bare={widget.bare}
        onCard={(card) => void patch(widget.id, { card })}
        onBackground={() => {
          refocus.current = true;
          void patch(widget.id, { bare: !widget.bare });
        }}
        onRemove={() => void remove(widget.id)}
      />
    </>
  );

  // Data for another card or range is the last answer still showing while the new one comes.
  const data = load.status === 'ready' ? load.data : null;
  const liveMs =
    load.status === 'ready' && runningFocusMs !== null
      ? Math.max(0, runningFocusMs - load.focusMsAtFetch)
      : 0;
  const fits = data !== null && data.card === widget.card && data.range === widget.range;
  const body = (
    <div className={`${styles.card} ${widget.bare ? styles.bareCard : ''}`} aria-busy={!fits}>
      {load.status === 'error' ? (
        <div className={styles.error}>
          <p className={styles.muted}>Couldn’t load this card.</p>
          <button type="button" className={styles.textButton} onClick={() => setRetry((n) => n + 1)}>
            Try again
          </button>
        </div>
      ) : fits ? (
        <CardBody data={data} liveMs={liveMs} />
      ) : (
        <p className={styles.muted}>Loading…</p>
      )}
    </div>
  );

  if (widget.bare) {
    return (
      <WidgetFrame
        title={name}
        chrome="bare"
        interactiveBody
        pos={pos}
        onPatch={onPatch}
        headerExtra={controls}
      >
        {body}
      </WidgetFrame>
    );
  }
  return (
    <WidgetFrame
      title={name}
      pos={pos}
      onPatch={onPatch}
      onClose={() => void remove(widget.id)}
      closeLabel="Remove stats widget"
      headerExtra={controls}
    >
      {body}
    </WidgetFrame>
  );
}

function CardBody({ data, liveMs }: { data: CardData; liveMs: number }) {
  switch (data.card) {
    case 'total':
      return <TotalCard data={data} liveMs={liveMs} />;
    case 'subjects':
      return <SubjectsCard data={data} />;
    case 'goal':
      return <GoalCard data={data} />;
    case 'estimates':
      return <EstimatesCard data={data} />;
  }
}

function RangeSwitch({
  range,
  bare,
  onChange,
}: {
  range: StatRange;
  bare: boolean;
  onChange(range: StatRange): void;
}) {
  const name = useId();
  return (
    <div
      className={`${styles.segmented} ${bare ? styles.onSpace : ''}`}
      role="radiogroup"
      aria-label="Range"
      data-no-drag
    >
      {RANGES.map((r) => (
        <label key={r.value} className={styles.segment}>
          <input
            type="radio"
            name={name}
            value={r.value}
            checked={range === r.value}
            onChange={() => onChange(r.value)}
          />
          <span>{r.label}</span>
        </label>
      ))}
    </div>
  );
}

function MoreIcon() {
  return (
    <svg
      className={styles.moreIcon}
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="3.5" cy="8" r="1.3" />
      <circle cx="8" cy="8" r="1.3" />
      <circle cx="12.5" cy="8" r="1.3" />
    </svg>
  );
}

/** The ⋯ menu: the four cards (the current one checked), the background toggle and Remove. */
function StatMenu({
  buttonRef,
  card,
  bare,
  onCard,
  onBackground,
  onRemove,
}: {
  buttonRef: RefObject<HTMLButtonElement>;
  card: StatCard;
  bare: boolean;
  onCard(card: StatCard): void;
  onBackground(): void;
  onRemove(): void;
}) {
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLUListElement>(null);
  const menuId = useId();

  const items = (): HTMLElement[] =>
    Array.from(menu.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? []);

  // Opening moves focus to the first item.
  useEffect(() => {
    if (open) items()[0]?.focus();
  }, [open]);

  // A press anywhere outside the menu and its button closes it.
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent): void => {
      const t = e.target as Node | null;
      if (t && (menu.current?.contains(t) || buttonRef.current?.contains(t))) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open, buttonRef]);

  const close = (): void => {
    setOpen(false);
    buttonRef.current?.focus();
  };
  const choose = (action: () => void): void => {
    close();
    action();
  };

  const onKey = (e: KeyboardEvent<HTMLUListElement>): void => {
    const all = items();
    const at = all.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') {
      // Handled here, so the shell's own Escape doesn't also act.
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      all[(at + step + all.length) % all.length]?.focus();
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      (e.key === 'Home' ? all[0] : all[all.length - 1])?.focus();
    }
  };

  // Focus leaving the menu (Tab, or a click elsewhere) closes it; moving to the button is its toggle's.
  const onBlur = (e: FocusEvent<HTMLUListElement>): void => {
    const next = e.relatedTarget as Node | null;
    if (next && (menu.current?.contains(next) || buttonRef.current?.contains(next))) return;
    setOpen(false);
  };

  return (
    <span className={styles.menuWrap} data-no-drag>
      <button
        ref={buttonRef}
        type="button"
        className={`${shell.iconButton} ${shell.small} ${bare ? styles.onSpace : ''}`}
        aria-label="Stats widget menu"
        title="Stats widget menu"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <MoreIcon />
      </button>
      {open && (
        <ul
          ref={menu}
          id={menuId}
          role="menu"
          aria-label="Stats widget"
          className={styles.menu}
          onKeyDown={onKey}
          onBlur={onBlur}
        >
          {CARDS.map((c) => (
            <li key={c} role="none">
              <button
                type="button"
                role="menuitemradio"
                aria-checked={c === card}
                tabIndex={-1}
                onClick={() =>
                  choose(() => {
                    if (c !== card) onCard(c);
                  })
                }
              >
                {CARD_NAMES[c]}
              </button>
            </li>
          ))}
          <li role="separator" className={styles.separator} />
          <li role="none">
            <button type="button" role="menuitem" tabIndex={-1} onClick={() => choose(onBackground)}>
              {bare ? 'Show background' : 'Hide background'}
            </button>
          </li>
          <li role="none">
            <button type="button" role="menuitem" tabIndex={-1} onClick={() => choose(onRemove)}>
              Remove
            </button>
          </li>
        </ul>
      )}
    </span>
  );
}
