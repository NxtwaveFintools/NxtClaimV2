import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

const VARIANT_CLASSES = {
  primary: "bg-accent text-white shadow-none hover:bg-accent-hover",
  secondary:
    "border border-border bg-card text-foreground shadow-none hover:bg-background-secondary",
  danger: "border border-danger/30 bg-danger-muted text-danger shadow-none hover:bg-danger/10",
  success: "border border-success/30 bg-success text-white shadow-none hover:bg-success/90",
  ghost: "text-foreground hover:bg-background-secondary",
} as const;

const SIZE_CLASSES = {
  xs: "h-7 px-2.5 text-xs rounded-md",
  sm: "h-8 px-3 text-xs rounded-lg",
  md: "h-9 px-4 text-sm rounded-lg",
  lg: "h-11 px-5 text-sm rounded-lg",
} as const;

export type ButtonVariant = keyof typeof VARIANT_CLASSES;
export type ButtonSize = keyof typeof SIZE_CLASSES;

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  loadingText?: string;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    variant = "primary",
    size = "md",
    loading = false,
    loadingText,
    disabled,
    children,
    type = "button",
    ...props
  },
  ref,
) {
  const isDisabled = disabled || loading;

  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 disabled:cursor-not-allowed disabled:opacity-60",
        SIZE_CLASSES[size],
        VARIANT_CLASSES[variant],
        className,
      )}
      disabled={isDisabled}
      {...props}
    >
      {loading ? (
        <svg
          className="h-3.5 w-3.5 animate-spin"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
      ) : null}
      {loading ? (loadingText ?? children) : children}
    </button>
  );
});
