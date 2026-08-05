import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

type Axis = "x" | "y";

interface Options {
  /** "x" closes on a leftward drag (drawer); "y" closes on a downward drag (sheet). */
  axis: Axis;
  onClose: () => void;
  /** Fraction of the panel's own size that must be dragged to dismiss. */
  threshold?: number;
}

/** Past this speed a short flick still dismisses, which is what fast swipes feel like. */
const FLICK_VELOCITY = 0.5; // px per ms
const SLOP = 8; // ignore taps and tiny jitters

/**
 * Drag-to-dismiss for the drawer and the bottom sheets. Follows the finger while
 * dragging and springs back if released short of the threshold.
 *
 * Returns props to spread onto the panel plus the live transform, so the caller
 * decides how to apply it.
 */
export function useSwipeDismiss({ axis, onClose, threshold = 0.25 }: Options) {
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; y: number; t: number; size: number } | null>(null);

  /**
   * A drag beginning inside a scrollable region belongs to that region, unless it
   * is already pinned at the edge the swipe would move away from — otherwise the
   * gesture fights the scroll.
   */
  const scrollBlocks = (target: EventTarget | null): boolean => {
    let el = target as HTMLElement | null;
    while (el && el !== document.body) {
      const style = getComputedStyle(el);
      const scrolls = /(auto|scroll)/.test(
        axis === "y" ? style.overflowY : style.overflowX,
      );
      if (scrolls) {
        if (axis === "y" ? el.scrollTop > 0 : el.scrollLeft > 0) return true;
      }
      el = el.parentElement;
    }
    return false;
  };

  const reset = () => {
    start.current = null;
    setDragging(false);
    setOffset(0);
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.pointerType === "mouse") return; // dragging with a mouse fights text selection
    if (scrollBlocks(e.target)) return;
    const el = e.currentTarget;
    start.current = {
      x: e.clientX,
      y: e.clientY,
      t: e.timeStamp,
      size: axis === "x" ? el.offsetWidth : el.offsetHeight,
    };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    const s = start.current;
    if (!s) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;

    if (!dragging) {
      // Commit to the gesture only once it is clearly along the closing axis.
      const along = axis === "x" ? -dx : dy;
      const across = axis === "x" ? Math.abs(dy) : Math.abs(dx);
      if (along < SLOP || along <= across) {
        if (across > SLOP * 2) start.current = null; // clearly a different gesture
        return;
      }
      setDragging(true);
    }

    // Only travel in the closing direction; resist the other way.
    const raw = axis === "x" ? Math.min(0, dx) : Math.max(0, dy);
    setOffset(raw);
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLElement>) => {
    const s = start.current;
    if (!s || !dragging) return reset();
    const travelled = Math.abs(offset);
    const elapsed = Math.max(1, e.timeStamp - s.t);
    const velocity = travelled / elapsed;
    if (travelled > s.size * threshold || velocity > FLICK_VELOCITY) {
      reset();
      onClose();
      return;
    }
    reset(); // springs back — the transform returns to 0
  };

  const transform = dragging
    ? axis === "x"
      ? `translateX(${offset}px)`
      : `translateY(${offset}px)`
    : undefined;

  return {
    dragging,
    transform,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: reset,
    },
  };
}
