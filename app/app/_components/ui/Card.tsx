import { ReactNode } from "react";

interface CardProps {
  children: ReactNode;
  className?: string;
  as?: "div" | "section" | "article" | "li";
  interactive?: boolean;
}

export default function Card({
  children,
  className = "",
  as: Tag = "div",
  interactive = false,
}: CardProps) {
  const base =
    "rounded-[var(--radius-card)] border border-border bg-surface " +
    "shadow-[var(--shadow-sm)]";
  const hover = interactive
    ? "hover:border-border-strong hover:shadow-[var(--shadow-md)] cursor-pointer"
    : "";
  return (
    <Tag className={`${base} ${hover} ${className}`}>{children}</Tag>
  );
}
