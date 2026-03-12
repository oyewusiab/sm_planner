import React, { useEffect } from "react";
import { cn } from "../utils/cn";
import { Button } from "./ui";

export function Modal({
  open,
  title,
  children,
  onClose,
  footer,
  className,
}: {
  open: boolean;
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  footer?: React.ReactNode;
  className?: string;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    if (open) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="modal-root fixed inset-0 z-50">
      <div className="no-print absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div
          className={cn(
            "modal-shell w-full max-w-2xl overflow-hidden rounded-xl border border-[color:var(--border)] bg-white shadow-xl",
            className
          )}
          role="dialog"
          aria-modal="true"
        >
          <div className="no-print flex items-center justify-between gap-3 border-b border-[color:var(--border)] p-4">
            <div className="text-base font-semibold text-slate-900">{title}</div>
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
          </div>
          <div className="modal-body p-4">{children}</div>
          {footer ? (
            <div className="no-print flex items-center justify-end gap-2 border-t border-[color:var(--border)] p-4">
              {footer}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
