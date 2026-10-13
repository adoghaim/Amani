import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent, type MouseEvent } from 'react';
import { flushSync } from 'react-dom';
import { MoreHorizontal, type LucideIcon } from 'lucide-react';
import { Button } from './Button';

/**
 * A labelled "More" button that opens a short list of actions (D19; DESIGN.md
 * `more-menu`). It is a disclosure: the button says whether the list is
 * expanded, and the list holds ordinary buttons.
 *
 * - Opening moves focus to the first available action. Arrow keys, Home and
 *   End move between actions; Escape closes and returns focus to More; Tab out
 *   or a press outside closes.
 * - Choosing an action closes the list and returns focus to More before the
 *   action runs, so a confirmation it asks for is not drawn over an open list.
 * - Every action is at least 44px tall (D23). A destructive action reads in
 *   danger ink after a divider, and its caller keeps it last.
 *
 * The closed list stays in the document, hidden, so the actions keep their
 * place in the page's text; hidden, they cannot be seen, focused or reached.
 */

export interface MoreMenuItem {
  /** Stable key. */
  id: string;
  label: string;
  icon?: LucideIcon;
  onSelect: () => void;
  disabled?: boolean;
  /** The action is running: its icon turns, as the report header's always has. */
  busy?: boolean;
  tone?: 'danger';
}

export interface MoreMenuProps {
  items: readonly MoreMenuItem[];
  /** The button's visible label. */
  label?: string;
  /** What the list of actions is called, for assistive technology. */
  listLabel: string;
}

const enabledActions = (root: HTMLElement | null) =>
  Array.from(root?.querySelectorAll<HTMLButtonElement>('[data-more-item]:not(:disabled)') ?? []);

const ITEM =
  'flex min-h-[44px] w-full items-center gap-2 px-4 py-2 text-left text-sm ' +
  'hover:bg-theme-background-tint focus-visible:bg-theme-background-tint focus-visible:outline-none ' +
  'focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-theme-primary ' +
  'disabled:cursor-not-allowed disabled:opacity-50';

export function MoreMenu({ items, label = 'More', listLabel }: MoreMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  // Where focus goes when the list opens: the first action, or the last (ArrowUp).
  const focusOnOpen = useRef<'first' | 'last'>('first');
  const listId = useId();

  const trigger = () => rootRef.current?.querySelector<HTMLButtonElement>('[data-more-trigger]') ?? null;
  const actions = () => enabledActions(rootRef.current);

  useEffect(() => {
    if (!open) return;
    const enabled = enabledActions(rootRef.current);
    (focusOnOpen.current === 'last' ? enabled[enabled.length - 1] : enabled[0])?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const openList = (at: 'first' | 'last') => {
    focusOnOpen.current = at;
    setOpen(true);
  };

  const closeList = () => {
    flushSync(() => setOpen(false));
    trigger()?.focus();
  };

  const choose = (item: MoreMenuItem) => {
    closeList();
    item.onSelect();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      closeList();
      return;
    }
    const enabled = actions();
    if (event.target === trigger()) {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault();
      const at = event.key === 'ArrowDown' ? 'first' : 'last';
      if (!open) openList(at);
      else (at === 'first' ? enabled[0] : enabled[enabled.length - 1])?.focus();
      return;
    }
    const index = enabled.indexOf(document.activeElement as HTMLButtonElement);
    if (index === -1) return;
    const next = event.key === 'ArrowDown' ? enabled[(index + 1) % enabled.length]
      : event.key === 'ArrowUp' ? enabled[(index - 1 + enabled.length) % enabled.length]
        : event.key === 'Home' ? enabled[0]
          : event.key === 'End' ? enabled[enabled.length - 1]
            : undefined;
    if (next) {
      event.preventDefault();
      next.focus();
    }
  };

  // Tab, or anything else, taking focus outside closes the list.
  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (open && !rootRef.current?.contains(event.relatedTarget as Node | null)) setOpen(false);
  };

  /*
    A press inside never moves focus. Safari does not focus a button on click:
    a mousedown there blurs the focused action with nowhere to go, which would
    close the list before the click lands. Focus is managed here instead.
  */
  const onMouseDown = (event: MouseEvent<HTMLDivElement>) => event.preventDefault();

  return (
    <div ref={rootRef} className="relative" onKeyDown={onKeyDown} onBlur={onBlur} onMouseDown={onMouseDown}>
      <Button
        data-more-trigger=""
        variant="outline"
        size="sm"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => (open ? closeList() : openList('first'))}
      >
        <MoreHorizontal aria-hidden="true" className="mr-1.5 h-4 w-4" />
        {label}
      </Button>
      <ul
        id={listId}
        aria-label={listLabel}
        hidden={!open}
        className="absolute right-0 top-full z-40 mt-2 w-max min-w-[14rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-theme-border-subtle bg-theme-surface py-1 shadow-theme"
      >
        {items.map((item, index) => {
          const Icon = item.icon;
          const danger = item.tone === 'danger';
          return (
            <li key={item.id} className={danger && index > 0 ? 'mt-1 border-t border-theme-border-inner pt-1' : undefined}>
              <button
                type="button"
                data-more-item=""
                disabled={item.disabled}
                onClick={() => choose(item)}
                className={`${ITEM} ${danger ? 'text-theme-danger-dark' : 'text-theme-text'}`}
              >
                {Icon && <Icon aria-hidden="true" className={`h-4 w-4 shrink-0 ${item.busy ? 'animate-spin' : ''}`} />}
                {item.label}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
