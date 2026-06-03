import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

const TONE_CLASSES = {
  neutral: "border border-border bg-background-secondary text-muted-foreground",
  info: "border border-info bg-info-muted text-info",
  warning: "border border-warning bg-warning-muted text-warning",
  success: "border border-success bg-success-muted text-success",
  danger: "border border-danger bg-danger-muted text-danger",
} as const;

const SIZE_CLASSES = {
  sm: "px-2 py-0.5 text-[11px] font-medium",
  md: "px-2.5 py-1 text-xs font-semibold",
} as const;

export type BadgeTone = keyof typeof TONE_CLASSES;
export type BadgeSize = keyof typeof SIZE_CLASSES;

type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: BadgeTone;
  size?: BadgeSize;
};

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { className, tone = "neutral", size = "md", ...props },
  ref,
) {
  return (
    <span
      ref={ref}
      className={cn(
        "inline-flex items-center rounded-full border whitespace-nowrap",
        TONE_CLASSES[tone],
        SIZE_CLASSES[size],
        className,
      )}
      {...props}
    />
  );
});
