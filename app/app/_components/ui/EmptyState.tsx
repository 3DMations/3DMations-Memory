import { ReactNode } from "react";

interface EmptyStateProps {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
}

export default function EmptyState({
  title,
  description,
  action,
  icon,
}: EmptyStateProps) {
  return (
    <div className="rounded-[var(--radius-card)] border border-dashed border-border bg-surface/40 p-12 text-center">
      {icon ? (
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-surface-2 text-text-muted">
          {icon}
        </div>
      ) : null}
      <p className="text-[15px] font-medium text-text">{title}</p>
      {description ? (
        <p className="mx-auto mt-1 max-w-md text-[13px] text-text-muted">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
