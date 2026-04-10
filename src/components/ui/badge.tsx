import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

const TONE_CLASSES = {
  neutral:
    "border-zinc-200 bg-zinc-50/80 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900/50 dark:text-zinc-300",
  info: "border-sky-200 bg-sky-50/80 text-sky-700 dark:border-sky-700/60 dark:bg-sky-900/20 dark:text-sky-300",
  warning:
    "border-amber-300 bg-amber-50/80 text-amber-800 dark:border-amber-700/60 dark:bg-amber-900/30 dark:text-amber-200",
  success:
    "border-emerald-200 bg-emerald-50/80 text-emerald-700 dark:border-emerald-600/50 dark:bg-emerald-900/20 dark:text-emerald-300",
  danger:
    "border-rose-200 bg-rose-50/80 text-rose-700 dark:border-rose-700/60 dark:bg-rose-900/20 dark:text-rose-300",
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
