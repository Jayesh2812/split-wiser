import { useEffect, type ReactNode } from "react";
import { Icon } from "./Icon";
import { useSwipeDismiss } from "../hooks/useSwipeDismiss";

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

export function Modal({ title, onClose, children }: ModalProps) {
  // Sheets rise from the bottom, so a downward swipe dismisses them.
  const swipe = useSwipeDismiss({ axis: "y", onClose });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-host" role="dialog" aria-modal="true">
      <div className="modal-backdrop" onClick={onClose} />
      <div
        className={`modal${swipe.dragging ? " dragging" : ""}`}
        style={swipe.transform ? { transform: swipe.transform } : undefined}
        {...swipe.handlers}
      >
        <div className="modal-header">
          <h3>{title}</h3>
          <button className="icon-btn" aria-label="Close" title="Close" onClick={onClose}>
            <Icon name="close" size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
