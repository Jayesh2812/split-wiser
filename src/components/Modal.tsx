import { useEffect, type ReactNode } from "react";
import { Icon } from "./Icon";
import { useSwipeDismiss } from "../hooks/useSwipeDismiss";

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

export function Modal({ title, onClose, children }: ModalProps) {
  // The gesture lives on the header handle, NOT the sheet: the sheet is the scroll
  // container, and claiming its touch-action would stop it scrolling at all.
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
        ref={swipe.panelRef as React.Ref<HTMLDivElement>}
        style={swipe.transform ? { transform: swipe.transform } : undefined}
      >
        <div className="modal-drag" {...swipe.handlers}>
          <span className="modal-grabber" aria-hidden="true" />
          <div className="modal-header">
            <h3>{title}</h3>
            <button className="icon-btn" aria-label="Close" title="Close" onClick={onClose}>
              <Icon name="close" size={20} />
            </button>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}
