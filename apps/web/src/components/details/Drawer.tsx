import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

const FOCUS_SELECTOR =
  'a[href], area[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])';

type DrawerProps = {
  open: boolean;
  onClose: () => void;
  labelledBy?: string;
  describedBy?: string;
  children: React.ReactNode;
};

const defaultContainerId = "game-details-title";
const defaultDescriptionId = "game-details-description";

export function Drawer({
  open,
  onClose,
  labelledBy = defaultContainerId,
  describedBy = defaultDescriptionId,
  children,
}: DrawerProps) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const prevActiveRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    prevActiveRef.current = document.activeElement as HTMLElement | null;
    const timeout = window.setTimeout(() => {
      closeButtonRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const container = panelRef.current;
      if (!container) return;
      const focusable = Array.from(container.querySelectorAll<HTMLElement>(FOCUS_SELECTOR)).filter((el) =>
        Boolean(el.offsetParent || el.getClientRects().length),
      );
      if (focusable.length === 0) {
        event.preventDefault();
        closeButtonRef.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (event.shiftKey) {
        if (active === first || !focusable.includes(active ?? null as any)) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open && prevActiveRef.current) {
      const node = prevActiveRef.current;
      prevActiveRef.current = null;
      if (node && typeof node.focus === "function") {
        node.focus();
      }
    }
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex justify-end bg-black/50"
      onClick={(event) => {
        if (event.target === overlayRef.current) {
          onClose();
        }
      }}
      role="presentation"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        className="relative h-full w-full max-w-3xl overflow-y-auto bg-white shadow-xl transition-transform duration-200"
      >
        <div className="sticky top-0 flex items-center justify-between border-b border-zinc-200 bg-white/90 px-6 py-4 backdrop-blur">
          <span className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Details</span>
          <button
            ref={closeButtonRef}
            type="button"
            className="btn-ghost px-3 py-1 text-sm"
            onClick={onClose}
          >
            Close
          </button>
        </div>
        <div className="px-6 py-4">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

export default Drawer;
