// src/components/Modal.tsx
//
// Shared modal shell: the backdrop + card surface plus the accessibility
// behaviour every dialog needs — role="dialog"/aria-modal, Escape to
// close, backdrop-click to close, focus moved into the dialog on open and
// restored on close, and Tab wrapped inside the dialog. The three dialogs
// (override amount, quick-add, rule editor) render their own content
// inside this so they stay consistent and keyboard-friendly.

import { useEffect, useRef, type ReactNode } from "react";
import { ui } from "./ui";

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export default function Modal({
  onClose,
  labelledBy,
  children,
}: {
  onClose: () => void;
  labelledBy?: string;
  children: ReactNode;
}) {
  const surfaceRef = useRef<HTMLDivElement>(null);

  // Escape closes from anywhere.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Move focus into the dialog on open; restore it to the trigger on close.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const surface = surfaceRef.current;
    const first = surface?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? surface)?.focus();
    return () => previouslyFocused?.focus?.();
  }, []);

  // Trap Tab within the dialog.
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "Tab") return;
    const surface = surfaceRef.current;
    if (!surface) return;
    const items = Array.from(surface.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      style={ui.modalBackdrop}
      // mousedown (not click) so a drag that starts inside and ends on the
      // backdrop doesn't count as a backdrop click.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={surfaceRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        style={ui.modalSurface}
        onKeyDown={onKeyDown}
      >
        {children}
      </div>
    </div>
  );
}
