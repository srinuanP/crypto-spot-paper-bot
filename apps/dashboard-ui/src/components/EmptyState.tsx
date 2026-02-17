type EmptyStateProps = {
  title: string;
  message: string;
  command?: string;
};

export function EmptyState({ title, message, command }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <h3>{title}</h3>
      <p>{message}</p>
      {command ? <code>{command}</code> : null}
    </div>
  );
}
