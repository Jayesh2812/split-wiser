import { useEffect } from "react";

/**
 * Publishes the *visual* viewport as CSS custom properties on <html>.
 *
 * Why: on iOS the keyboard does not shrink the layout viewport. `position:
 * fixed` and `vh` keep resolving against the full-height layout viewport, and
 * Safari scroll-shifts that viewport to reveal the focused input — so fixed
 * overlays visibly slide off-screen. Tracking window.visualViewport lets the
 * overlays follow what the user can actually see.
 *
 *   --vvh      visible height
 *   --vv-top   how far the visual viewport has been shifted down
 *   --kb       keyboard inset at the bottom (0 when closed)
 */
export function useViewportVars(): void {
  useEffect(() => {
    const root = document.documentElement;
    const vv = window.visualViewport;

    const apply = () => {
      const height = vv?.height ?? window.innerHeight;
      const top = vv?.offsetTop ?? 0;
      // What the keyboard (or any other on-screen widget) covers at the bottom.
      const keyboard = Math.max(0, window.innerHeight - height - top);
      root.style.setProperty("--vvh", `${height}px`);
      root.style.setProperty("--vv-top", `${top}px`);
      root.style.setProperty("--kb", `${keyboard}px`);
    };

    apply();

    if (!vv) {
      window.addEventListener("resize", apply);
      return () => window.removeEventListener("resize", apply);
    }
    // `scroll` fires on the shift Safari performs to reveal a focused input.
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
    return () => {
      vv.removeEventListener("resize", apply);
      vv.removeEventListener("scroll", apply);
    };
  }, []);
}

/**
 * Stop the page behind an open overlay from scrolling. Without this iOS will
 * happily scroll the document under a modal while the keyboard is up.
 */
export function useScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const { body } = document;
    const previous = body.style.overflow;
    body.style.overflow = "hidden";
    return () => {
      body.style.overflow = previous;
    };
  }, [active]);
}
