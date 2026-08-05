interface EmptyStateProps {
  onCreate: () => void;
}

export function EmptyState({ onCreate }: EmptyStateProps) {
  return (
    <section className="empty-state">
      <div className="empty-illustration">👋</div>
      <h2>Welcome to Splitwiser</h2>
      <p>
        Create a group, add the people in it, then start logging who paid for what. Everything
        stays on this device and works fully offline.
      </p>
      <button className="btn btn-primary btn-lg" onClick={onCreate}>
        Create your first group
      </button>
    </section>
  );
}
