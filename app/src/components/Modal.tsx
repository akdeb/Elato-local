import React from "react";
import clsx from "clsx";
import { X } from "lucide-react";

type ModalProps = {
  open: boolean;
  title?: string | React.ReactNode;
  icon?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  overlayClassName?: string;
  panelClassName?: string;
};

export function Modal({ open, title, onClose, children, overlayClassName, panelClassName, icon }: ModalProps) {
  if (!open) return null;

  return (
    <div className={clsx("fixed inset-0 z-50 backdrop-blur-sm flex items-center justify-center p-6", overlayClassName)}>
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />
      <div className={clsx("relative w-full max-w-xl retro-card", panelClassName)}>
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="text-xl font-black flex flex-row items-center gap-2">{icon && <span className="mr-2">{icon}</span>} {title}</div>
          <button
            type="button"
            className="retro-icon-btn"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
