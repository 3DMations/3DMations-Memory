import { ReactNode } from "react";

interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  back?: ReactNode;
}

export default function PageHeader({
  title,
  description,
  actions,
  back,
}: PageHeaderProps) {
  return (
    <header className="mb-8">
      {back ? <div className="mb-3 text-[13px]">{back}</div> : null}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-[28px] font-semibold tracking-[-0.02em] text-text leading-tight">
            {title}
          </h1>
          {description ? (
            <p className="mt-1 text-[14px] text-text-muted">{description}</p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex items-center gap-2 shrink-0">{actions}</div>
        ) : null}
      </div>
    </header>
  );
}
