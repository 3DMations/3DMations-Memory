import { ButtonHTMLAttributes, forwardRef, ReactNode } from "react";

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  label: string; // accessible label
  size?: "sm" | "md";
}

const sizeMap = { sm: "h-8 w-8", md: "h-10 w-10" } as const;

const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton({ children, label, size = "md", className = "", ...rest }, ref) {
    return (
      <button
        ref={ref}
        aria-label={label}
        title={label}
        className={
          `inline-flex items-center justify-center rounded-[var(--radius-button)] ` +
          `bg-transparent text-text-muted hover:text-text hover:bg-surface-2 ` +
          `active:translate-y-[1px] transition-[background,color,transform] ` +
          `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ` +
          `focus-visible:ring-offset-2 focus-visible:ring-offset-bg ` +
          `${sizeMap[size]} ${className}`
        }
        {...rest}
      >
        {children}
      </button>
    );
  },
);

export default IconButton;
