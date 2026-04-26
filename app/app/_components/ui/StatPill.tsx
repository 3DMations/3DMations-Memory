import { ReactNode } from "react";

type Tone = "neutral" | "accent" | "success" | "warning" | "error";

interface StatPillProps {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}

const tones: Record<Tone, string> = {
  neutral: "bg-surface-2 text-text-muted border-border",
  accent: "bg-accent-soft text-accent border-accent/30",
  success: "bg-success/10 text-success border-success/30",
  warning: "bg-warning/10 text-warning border-warning/30",
  error: "bg-error/10 text-error border-error/30",
};

export default function StatPill({
  children,
  tone = "neutral",
  className = "",
}: StatPillProps) {
  return (
    <span
      className={
        `inline-flex items-center gap-1 rounded-[var(--radius-pill)] border ` +
        `px-2.5 py-0.5 text-[12px] font-medium leading-none ` +
        `${tones[tone]} ${className}`
      }
    >
      {children}
    </span>
  );
}
