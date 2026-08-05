import { useEffect, type ReactNode } from "react";
import { Icon } from "./Icon";

interface ModalProps {
  title: string;
  onClose: () => void;
  /**
   * Optional control shown beside the close button — used to put the primary
   * action within reach on a small screen, where the footer needs scrolling to.
   */
  headerAction?: ReactNode;
  children: ReactNode;
}

export function Modal({ title, onClose, headerAction, children }: ModalProps) {
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
      <div className="modal">
        <div className="modal-header">
          <h3>{title}</h3>
          <div className="modal-header-actions">
            {headerAction}
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
