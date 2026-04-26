import { ButtonHTMLAttributes, forwardRef } from "react";

type Variant = "primary" | "ghost" | "danger" | "outline";
type Size = "sm" | "md";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const variants: Record<Variant, string> = {
  primary:
    "bg-accent text-white hover:bg-accent-hover " +
    "active:translate-y-[1px] disabled:bg-border-strong disabled:cursor-not-allowed",
  ghost:
    "bg-transparent text-text hover:bg-surface-2 " +
    "active:translate-y-[1px] disabled:text-text-subtle disabled:cursor-not-allowed",
  outline:
    "bg-surface text-text border border-border hover:bg-surface-2 " +
    "hover:border-border-strong active:translate-y-[1px] " +
    "disabled:text-text-subtle disabled:cursor-not-allowed",
  danger:
    "bg-error text-white hover:opacity-90 " +
    "active:translate-y-[1px] disabled:opacity-50 disabled:cursor-not-allowed",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-[13px]",
  md: "h-10 px-4 text-[14px]",
};

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", className = "", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={
        `inline-flex items-center justify-center gap-2 rounded-[var(--radius-button)] ` +
        `font-medium transition-[background,color,box-shadow,transform] ` +
        `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ` +
        `focus-visible:ring-offset-2 focus-visible:ring-offset-bg ` +
        `${variants[variant]} ${sizes[size]} ${className}`
      }
      {...rest}
    />
  );
});

export default Button;
