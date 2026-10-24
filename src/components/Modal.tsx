/*
  The shared sheet/modal primitive.

  Before this, every overlay in the app was a hand-rolled copy of the same
  markup, and PeriodLogModal and SymptomLogModal were byte-identical in
  structure:

      <div className="fixed inset-0 ... p-4">
        <div className="... max-w-md overflow-hidden">

  Three faults compounded, and on a phone they produced the bug that swiping
  inside the sheet scrolled the page behind it:

  1. `overflow-hidden` on the panel with no max-height and no scrollable
     region, so a sheet taller than the viewport simply could not scroll —
     its own save/cancel buttons went off-screen and became unreachable.
  2. `inset-0` is the LAYOUT viewport. On Android that ignores the on-screen
     navigation bar, so the bottom of the sheet sat underneath it.
  3. Nothing anywhere in the codebase locked background scrolling, and nothing
     set `overscroll-behavior`, so a touch drag that the sheet could not consume
     chained straight through to the document.

  This component fixes all three in one place. The two behaviours that actually
  stop the bleed-through are the body scroll lock and `overscroll-contain` on
  the scrollable region — either alone is insufficient: the lock stops the
  document moving, and overscroll-contain stops the gesture being handed onward
  when the sheet hits its own scroll limit.
*/

import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { registerOverlay } from '../lib/overlayStack';
import { X } from 'lucide-react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Save/cancel row. Stays reachable regardless of how tall the body grows. */
  footer?: ReactNode;
  /** Adds the slide-up entrance SymptomLogModal already used. */
  animate?: boolean;
  /** A wider panel (max-w-2xl) for reading content; the default is max-w-md. */
  wide?: boolean;
}

export function Modal({ open, onClose, title, children, footer, animate = false, wide = false }: ModalProps) {
  useBodyScrollLock(open);
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  // The Android back button closes the top open sheet before it navigates (F067).
  useEffect(() => {
    if (!open) return;
    return registerOverlay(() => onCloseRef.current());
  }, [open]);

  // The portal leaves the app inert without disabling the dialog itself.
  // Keep this separate from onClose so inline callbacks do not reset focus.
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement;
    const app = document.getElementById('root');
    const wasInert = app?.hasAttribute('inert');
    app?.setAttribute('inert', '');
    panelRef.current?.focus();
    return () => {
      if (!wasInert) app?.removeAttribute('inert');
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, [open]);

  // Contain keyboard navigation even on WebViews without inert support.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(
        'a[href], button, input, select, textarea, [tabindex], [contenteditable="true"]',
      )).filter(element => element.tabIndex >= 0 && !element.matches(':disabled')
        && !element.closest('[inert], [hidden]') && element.getClientRects().length > 0);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) {
        e.preventDefault();
        panel.focus();
      } else if (!panel.contains(document.activeElement) || document.activeElement === panel) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey ? document.activeElement === first : document.activeElement === last) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const overlay = (
    /*
      dvh, not vh: on Android the browser chrome and the on-screen keyboard both
      change the visible height, and vh keeps reporting the largest value.

      The padding is max(1rem, inset), not `p-4 safe-top safe-bottom`: the
      safe-* helpers sit in @layer base, so the p-4 utility always beat them and
      the sheet was tucked under the Android navigation bar (review F071).
    */
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]"
      style={{ height: '100dvh' }}
      onClick={(e) => {
        // Backdrop click closes; clicks inside the panel must not.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className={`bg-theme-surface rounded-2xl shadow-xl w-full ${wide ? 'max-w-2xl' : 'max-w-md'} flex flex-col ${
          animate ? 'animate-slide-up' : ''
        }`}
        /*
          The panel is bounded so it can never exceed what is actually visible.
          It is a flex column, so the header and footer hold their size and the
          body is the only part that scrolls.
        */
        style={{ maxHeight: 'calc(100dvh - max(1rem, env(safe-area-inset-top)) - max(1rem, env(safe-area-inset-bottom)))' }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-theme-border flex-shrink-0">
          <h2 className="text-base text-theme-text">{title}</h2>
          {/* 44px tap area (D23); the negative margin keeps the header row its old height. */}
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-11 h-11 -my-1.5 -mr-1.5 flex shrink-0 items-center justify-center rounded-lg hover:bg-theme-surface-2 transition-colors"
          >
            <X className="w-4 h-4 text-theme-muted-text" />
          </button>
        </div>

        {/*
          overscroll-contain is the half of the fix that the scroll lock cannot
          do: without it, a drag that reaches the top or bottom of this region is
          handed to the document, which is exactly the "background scrolls"
          symptom.
        */}
        <div className="px-5 py-4 overflow-y-auto overscroll-contain flex-1 min-h-0">
          {children}
        </div>

        {footer && (
          <div className="px-5 py-4 border-t border-theme-border flex gap-3 flex-shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  );

  return typeof document === 'undefined' ? overlay : createPortal(overlay, document.body);
}
