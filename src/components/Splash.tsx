/** Shown while the Firebase session is still being restored on first load. */
export function Splash() {
  return (
    <div className="splash" role="status" aria-live="polite">
      <div className="splash-mark">₹</div>
      <span className="spinner" />
      <p>Loading your groups…</p>
    </div>
  );
}
